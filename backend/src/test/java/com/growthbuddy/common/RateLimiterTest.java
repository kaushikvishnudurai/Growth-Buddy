package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/**
 * The limiter counts fixed windows in the database and decides on a sliding
 * estimate over the current and previous one. What has to stay true: the limit
 * still bites at exactly the limit, unrelated keys don't share a budget, the
 * boundary no longer hands out a second full allowance, and a quiet stretch
 * long enough to slide the old hits out of view starts fresh.
 */
class RateLimiterTest {

    @Test
    void allowsUpToTheLimitAndThenRefuses() {
        RateLimiter limiter = new RateLimiter(new FakeThrottleStore());
        for (int i = 1; i <= 10; i++) {
            assertThat(limiter.allow("ip:1.2.3.4", 10, 60_000L)).as("call %d of 10", i).isTrue();
        }
        assertThat(limiter.allow("ip:1.2.3.4", 10, 60_000L)).as("the 11th").isFalse();
    }

    @Test
    void oneKeysBudgetIsNotAnothers() {
        RateLimiter limiter = new RateLimiter(new FakeThrottleStore());
        for (int i = 0; i < 10; i++) limiter.allow("ip:1.2.3.4", 10, 60_000L);
        assertThat(limiter.allow("ip:5.6.7.8", 10, 60_000L)).isTrue();
    }

    /* peek + record: a cap that counts only what happened. Peeking never
       spends, so refused attempts can't keep the door shut. */
    @Test
    void peekDecidesWithoutCountingAndRecordCounts() {
        RateLimiter limiter = new RateLimiter(new FakeThrottleStore());
        for (int i = 0; i < 100; i++) assertThat(limiter.peek("k", 2, 60_000L)).isTrue();
        limiter.record("k", 60_000L);
        assertThat(limiter.peek("k", 2, 60_000L)).isTrue();
        limiter.record("k", 60_000L);
        assertThat(limiter.peek("k", 2, 60_000L)).as("two recorded, limit 2").isFalse();
        assertThat(limiter.allow("k", 2, 60_000L)).as("same counters as allow").isFalse();
    }

    private static final long W = 60_000L;

    /* The hole a fixed window had: spend 10 in the last second of one window,
       then 10 more in the first second of the next. With the previous window
       still ~100% in view, the second burst gets nothing. */
    @Test
    void theBoundaryNoLongerGrantsASecondFullAllowance() {
        AtomicLong now = new AtomicLong(10 * W - 1_000);
        RateLimiter limiter = new RateLimiter(new FakeThrottleStore(), now::get);
        for (int i = 0; i < 10; i++) assertThat(limiter.allow("k", 10, W)).isTrue();

        now.set(10 * W + 1_000);
        assertThat(limiter.allow("k", 10, W)).as("first call across the boundary").isFalse();
    }

    /* Halfway through the next window, half the old hits are still in view:
       10 × 0.5 = 5, so 5 more fit and the 6th does not. */
    @Test
    void theOldWindowFadesInProportionToElapsedTime() {
        AtomicLong now = new AtomicLong(10 * W + 100);
        RateLimiter limiter = new RateLimiter(new FakeThrottleStore(), now::get);
        for (int i = 0; i < 10; i++) limiter.allow("k", 10, W);

        now.set(11 * W + W / 2);
        for (int i = 1; i <= 5; i++) {
            assertThat(limiter.allow("k", 10, W)).as("call %d at the half-way point", i).isTrue();
        }
        assertThat(limiter.allow("k", 10, W)).isFalse();
    }

    /* Two windows on, the old hits are out of view entirely. */
    @Test
    void aFullWindowOfQuietStartsFresh() {
        AtomicLong now = new AtomicLong(10 * W);
        RateLimiter limiter = new RateLimiter(new FakeThrottleStore(), now::get);
        for (int i = 0; i < 15; i++) limiter.allow("k", 10, W);

        now.set(12 * W);
        for (int i = 0; i < 10; i++) assertThat(limiter.allow("k", 10, W)).isTrue();
        assertThat(limiter.allow("k", 10, W)).isFalse();
    }

    @Test
    void theEstimateWeighsThePreviousWindowByOverlap() {
        assertThat(RateLimiter.estimate(10, 1, 0, W)).isEqualTo(11.0);
        assertThat(RateLimiter.estimate(10, 1, W / 4, W)).isEqualTo(8.5);
        assertThat(RateLimiter.estimate(10, 1, W - 1, W)).isCloseTo(1.0, org.assertj.core.data.Offset.offset(0.001));
    }

    /* The sweep must not delete the previous window of the widest (1h) limit,
       or that limiter silently reverts to a fixed window. */
    @Test
    void theSweepKeepsThePreviousWindowOfAnHourLimit() {
        long hour = 60 * 60_000L;
        AtomicLong now = new AtomicLong(5 * hour + hour - 1);
        FakeThrottleStore store = new FakeThrottleStore();
        RateLimiter limiter = new RateLimiter(store, now::get);
        store.countHit("k", 4 * hour);
        limiter.sweep();
        assertThat(store.hits("k", 4 * hour)).isEqualTo(1);
    }

    /* Same for the widest window in use, AuthService's daily OTP-mail cap. */
    @Test
    void theSweepKeepsThePreviousWindowOfADayLimit() {
        long day = 24 * 60 * 60_000L;
        AtomicLong now = new AtomicLong(5 * day + day - 1);
        FakeThrottleStore store = new FakeThrottleStore();
        RateLimiter limiter = new RateLimiter(store, now::get);
        store.countHit("k", 4 * day);
        limiter.sweep();
        assertThat(store.hits("k", 4 * day)).isEqualTo(1);
    }

    /* Windows have to tile the timeline with no gap and no overlap, or a caller
       either gets a free window or is billed to two at once. */
    @Test
    void windowsTileCleanly() {
        long w = 60_000L;
        assertThat(RateLimiter.windowStartFor(0L, w)).isZero();
        assertThat(RateLimiter.windowStartFor(59_999L, w)).isZero();
        assertThat(RateLimiter.windowStartFor(60_000L, w)).isEqualTo(60_000L);
        assertThat(RateLimiter.windowStartFor(1_756_000_123_456L, w))
                .isEqualTo(1_756_000_123_456L - (1_756_000_123_456L % w));
    }

    /* The backoff policy, pinned away from any store: free attempts, doubling,
       and the cap that stops a stranger locking someone out forever. */
    @Test
    void theLockoutCurveIsFreeThenDoublingThenCapped() {
        assertThat(LoginAttemptGuard.lockMsForFailures(5)).isZero();
        assertThat(LoginAttemptGuard.lockMsForFailures(6)).isEqualTo(60_000L);
        assertThat(LoginAttemptGuard.lockMsForFailures(7)).isEqualTo(120_000L);
        assertThat(LoginAttemptGuard.lockMsForFailures(8)).isEqualTo(240_000L);
        assertThat(LoginAttemptGuard.lockMsForFailures(99)).isEqualTo(60 * 60_000L);
    }
}
