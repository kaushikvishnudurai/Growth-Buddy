package com.growthbuddy.common;

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
 * <p>State lives in {@link ThrottleStore} — the shared database — not in this
 * process. It used to be a {@code ConcurrentHashMap}, which made the lock only
 * ever as strong as 1/N across N instances and forgave everyone on restart.
 * A lockout that a deploy clears is not a lockout.
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

    private final ThrottleStore store;

    public LoginAttemptGuard(ThrottleStore store) {
        this.store = store;
    }

    /**
     * The whole policy, as one pure function: how long failure number {@code n}
     * locks the identity for. Zero while the free attempts last.
     *
     * <p>Kept separate from the storage so the escalation and the cap — the two
     * things an attacker cares about — can be tested without a database.
     */
    static long lockMsForFailures(int failures) {
        if (failures <= FREE_ATTEMPTS) {
            return 0;
        }
        // 6th failure -> 1 min, 7th -> 2, 8th -> 4 ... shift, not pow, and
        // clamped before it can overflow a long.
        int steps = Math.min(failures - FREE_ATTEMPTS - 1, 20);
        return Math.min(BASE_LOCK_MS << steps, MAX_LOCK_MS);
    }

    /**
     * Milliseconds the caller must wait before this identity may try again;
     * {@code 0} when it may try now.
     *
     * @param key identity being guessed at — an email or a user id, prefixed by
     *            the flow, e.g. {@code "login:ada@example.com"}
     */
    public long retryAfterMs(String key) {
        long left = store.attempt(key).lockedUntilMs() - System.currentTimeMillis();
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
        store.recordFailure(key, n -> (int) Math.min(lockMsForFailures(n), Integer.MAX_VALUE));
    }

    /** Forget this identity's failures — called on a successful sign-in. */
    public void recordSuccess(String key) {
        store.clearAttempt(key);
    }

    // initialDelay, not just fixedDelay: a scheduled task fires the moment the
    // context is up, which on a fresh database is BEFORE DataSeeder has created
    // the table — a stack trace at every first boot, sweeping nothing. There is
    // never anything to sweep at startup anyway.
    @Scheduled(fixedDelay = IDLE_EVICT_MS, initialDelay = IDLE_EVICT_MS)
    void sweep() {
        store.sweepAttempts(System.currentTimeMillis() - IDLE_EVICT_MS);
    }
}
