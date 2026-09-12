package com.growthbuddy.common;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Fixed-window rate limiter backed by {@link ThrottleStore}, so the limit is the
 * limit across every instance rather than per process.
 *
 * <p>This was a sliding window held in a {@code ConcurrentHashMap}. Sliding is
 * the more precise shape, but it needs every timestamp kept, and keeping them in
 * a shared table costs a row per request. A fixed window needs one counter per
 * key per window, which an atomic {@code INSERT … ON DUPLICATE KEY UPDATE} does
 * in a single statement.
 *
 * <p>ponytail: the trade is the window boundary. A caller can spend its whole
 * allowance at the end of one window and again at the start of the next, so the
 * true worst case is 2x the limit over a straddling interval — 20 login attempts
 * in a moment rather than 10. That is well inside what the per-account
 * {@link LoginAttemptGuard} is there to stop, which is why it is acceptable
 * here. If a burst at the boundary ever matters, keep two adjacent counters and
 * weight the older one by how much of it the window still covers.
 */
@Component
public class RateLimiter {

    /** Windows that closed more than this long ago are dropped by the sweep. */
    private static final long RETAIN_MS = 60 * 60_000L;

    private final ThrottleStore store;

    public RateLimiter(ThrottleStore store) {
        this.store = store;
    }

    /**
     * Returns {@code true} when the request is within the allowed rate;
     * {@code false} when it should be rejected.
     *
     * @param key      discriminator — typically "IP:path"
     * @param limit    maximum calls allowed inside the window
     * @param windowMs sliding window width in milliseconds
     */
    public boolean allow(String key, int limit, long windowMs) {
        long windowStart = windowStartFor(System.currentTimeMillis(), windowMs);
        return store.countHit(key, windowStart) <= limit;
    }

    /** The window a moment falls in. Pure, so the bucketing is testable on its own. */
    static long windowStartFor(long nowMs, long windowMs) {
        return nowMs - Math.floorMod(nowMs, windowMs);
    }

    // initialDelay, not just fixedDelay: a scheduled task fires the moment the
    // context is up, which on a fresh database is BEFORE DataSeeder has created
    // the table — a stack trace at every first boot, sweeping nothing. There is
    // never anything to sweep at startup anyway.
    @Scheduled(fixedDelay = RETAIN_MS, initialDelay = RETAIN_MS)
    void sweep() {
        store.sweepCounters(System.currentTimeMillis() - RETAIN_MS);
    }
}
