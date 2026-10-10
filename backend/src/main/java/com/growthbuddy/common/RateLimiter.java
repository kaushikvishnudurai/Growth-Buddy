package com.growthbuddy.common;

import java.util.function.LongSupplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Sliding-window rate limiter backed by {@link ThrottleStore}, so the limit is
 * the limit across every instance rather than per process.
 *
 * <p>The store keeps one counter per key per fixed window — an atomic
 * {@code INSERT … ON DUPLICATE KEY UPDATE}, one row per key per window, not a
 * row per request. A bare fixed window has a boundary hole: a caller can spend
 * its whole allowance at the end of one window and again at the start of the
 * next, 2x the limit over a straddling interval. So the decision reads two
 * adjacent counters and weights the previous one by how much of it a window
 * ending now still covers:
 *
 * <pre>estimate = previous × (1 − elapsed/window) + current</pre>
 *
 * <p>ponytail: an approximation — it assumes the previous window's hits were
 * spread evenly across it. A burst late in the previous window is undercounted
 * a little, one early in it overcounted, but the 2x boundary burst is gone: a
 * full previous window still weighs ~100% at the boundary. Exact sliding needs
 * every timestamp, which in a shared table is a row per request — upgrade only
 * if a limit ever has to be precise to the hit.
 */
@Component
public class RateLimiter {

    /**
     * Counters whose window began more than this long ago are dropped by the
     * sweep. Two of the widest window in use (24h, AuthService's daily OTP-mail
     * cap): the previous window of a 24h limit starts up to 48h back, and
     * sweeping it would quietly turn the limiter back into a fixed window — or,
     * swept inside the window itself, forget the count entirely. Widen this
     * before adding a longer window.
     */
    private static final long RETAIN_MS = 48 * 60 * 60_000L;
    private static final long SWEEP_EVERY_MS = 60 * 60_000L;

    private final ThrottleStore store;
    private final LongSupplier clock;

    @Autowired
    public RateLimiter(ThrottleStore store) {
        this(store, System::currentTimeMillis);
    }

    /** Tests drive the clock so a window boundary can be crossed on purpose. */
    RateLimiter(ThrottleStore store, LongSupplier clock) {
        this.store = store;
        this.clock = clock;
    }

    /**
     * Returns {@code true} when the request is within the allowed rate;
     * {@code false} when it should be rejected. Every call counts, refused or
     * not — hammering a closed door keeps it closed.
     *
     * @param key      discriminator — typically "IP:path"
     * @param limit    maximum calls allowed inside any window-wide span
     * @param windowMs sliding window width in milliseconds
     */
    public boolean allow(String key, int limit, long windowMs) {
        long now = clock.getAsLong();
        long windowStart = windowStartFor(now, windowMs);
        int previous = store.hits(key, windowStart - windowMs);
        int current = store.countHit(key, windowStart);
        return estimate(previous, current, now - windowStart, windowMs) <= limit;
    }

    /**
     * {@link #allow}'s decision without counting anything: would one more hit
     * still be within the limit? Pair with {@link #record} for a cap that counts
     * only what actually happened, so refused attempts never extend the block.
     * ponytail: peek-then-record is not atomic; concurrent callers can overshoot
     * by a hit or two. Fine for a mail cap; use {@link #allow} where it isn't.
     */
    public boolean peek(String key, int limit, long windowMs) {
        long now = clock.getAsLong();
        long windowStart = windowStartFor(now, windowMs);
        int previous = store.hits(key, windowStart - windowMs);
        int current = store.hits(key, windowStart);
        return estimate(previous, current + 1, now - windowStart, windowMs) <= limit;
    }

    /** Count one hit against {@code key} with no decision attached (see {@link #peek}). */
    public void record(String key, long windowMs) {
        store.countHit(key, windowStartFor(clock.getAsLong(), windowMs));
    }

    /** The window a moment falls in. Pure, so the bucketing is testable on its own. */
    static long windowStartFor(long nowMs, long windowMs) {
        return nowMs - Math.floorMod(nowMs, windowMs);
    }

    /** The sliding estimate. Pure: previous weighted by the share of it still in view. */
    static double estimate(int previous, int current, long elapsedMs, long windowMs) {
        double stillCovered = (double) (windowMs - elapsedMs) / windowMs;
        return previous * stillCovered + current;
    }

    // initialDelay, not just fixedDelay: a scheduled task fires the moment the
    // context is up, which on a fresh database is BEFORE DataSeeder has created
    // the table — a stack trace at every first boot, sweeping nothing. There is
    // never anything to sweep at startup anyway.
    @Scheduled(fixedDelay = SWEEP_EVERY_MS, initialDelay = SWEEP_EVERY_MS)
    void sweep() {
        store.sweepCounters(clock.getAsLong() - RETAIN_MS);
    }
}
