package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * The limiter moved from a sliding window in memory to a fixed window in the
 * database. What has to stay true: the limit still bites at exactly the limit,
 * unrelated keys don't share a budget, and a new window starts fresh.
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
