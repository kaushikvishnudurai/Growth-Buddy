package com.growthbuddy.common;

import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Per-identity exponential backoff for guessable credentials — passwords and
 * the emailed OTPs, which mint a session just as a password does.
 *
 * <p>{@link RateLimitInterceptor} already caps auth calls per IP, but an IP is
 * free: a botnet spreads a guessing run across thousands of them and never
 * trips it. This counts failures against the <em>account</em>, so the attacker's
 * budget is the same whether they come from one address or ten thousand.
 *
 * <p>Five failures are free (people typo). Each one after that locks the
 * identity for twice as long as the last — 1, 2, 4, 8 minutes — capped at an
 * hour. The cap is deliberate: a permanent lock would hand any stranger a way
 * to keep the real owner out by guessing wrong on purpose. An hour at a time
 * still drags 6-digit-OTP brute force out past the code's own expiry, and
 * password guessing out past the heat death of the attacker's patience.
 *
 * <p>A success clears the counter, so a legitimate user who finally remembers
 * their password starts fresh.
 *
 * <p>State is in-memory, like {@link RateLimiter}. ponytail: a restart forgives
 * everyone. That is survivable while this runs as a single instance — move it
 * to the DB or Redis the day a second one starts up, or the lock is only ever
 * as strong as 1/N.
 */
@Component
public class LoginAttemptGuard {

    /** Failures allowed before any lock at all. */
    private static final int FREE_ATTEMPTS = 5;
    /** Lock after the first failure past the free ones; doubles from there. */
    private static final long BASE_LOCK_MS = 60_000L;
    private static final long MAX_LOCK_MS = 60 * 60_000L;
    /** Entries untouched for this long are dropped by the sweep. */
    private static final long IDLE_EVICT_MS = 2 * 60 * 60_000L;

    private record Attempt(int failures, long lockedUntil, long updatedAt) {}

    private final ConcurrentHashMap<String, Attempt> attempts = new ConcurrentHashMap<>();

    /**
     * Milliseconds the caller must wait before this identity may try again;
     * {@code 0} when it may try now.
     *
     * @param key identity being guessed at — an email or a user id, prefixed by
     *            the flow, e.g. {@code "login:ada@example.com"}
     */
    public long retryAfterMs(String key) {
        Attempt a = attempts.get(key);
        if (a == null) return 0;
        long left = a.lockedUntil() - System.currentTimeMillis();
        return left > 0 ? left : 0;
    }

    /** Throws 429 when {@code key} is locked out. Call before checking the secret. */
    public void check(String key) {
        long waitMs = retryAfterMs(key);
        if (waitMs <= 0) return;
        long mins = (waitMs + 59_999L) / 60_000L;
        throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                "Too many failed attempts. Try again in " + mins + (mins == 1 ? " minute." : " minutes."));
    }

    /** Record a wrong password/OTP and extend the lock if the free attempts are spent. */
    public void recordFailure(String key) {
        long now = System.currentTimeMillis();
        attempts.compute(key, (k, prev) -> {
            int failures = (prev == null ? 0 : prev.failures()) + 1;
            long lockedUntil = prev == null ? 0 : prev.lockedUntil();
            if (failures > FREE_ATTEMPTS) {
                // 6th failure → 1 min, 7th → 2, 8th → 4 … shift, not pow, and
                // clamped before it can overflow a long.
                int steps = Math.min(failures - FREE_ATTEMPTS - 1, 20);
                lockedUntil = now + Math.min(BASE_LOCK_MS << steps, MAX_LOCK_MS);
            }
            return new Attempt(failures, lockedUntil, now);
        });
    }

    /** Forget this identity's failures — called on a successful sign-in. */
    public void recordSuccess(String key) {
        attempts.remove(key);
    }

    @Scheduled(fixedDelay = IDLE_EVICT_MS)
    void sweep() {
        long cutoff = System.currentTimeMillis() - IDLE_EVICT_MS;
        for (Iterator<Map.Entry<String, Attempt>> it = attempts.entrySet().iterator(); it.hasNext();) {
            Attempt a = it.next().getValue();
            // Never evict a live lock, however stale it looks.
            if (a.updatedAt() < cutoff && a.lockedUntil() < System.currentTimeMillis()) {
                it.remove();
            }
        }
    }
}
