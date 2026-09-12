package com.growthbuddy.common;

/**
 * Where the two throttles keep their counters.
 *
 * <p>Both {@link RateLimiter} and {@link LoginAttemptGuard} used to hold state in
 * a {@code ConcurrentHashMap}, which is correct for exactly one instance and
 * quietly wrong for two: a limit of 10 becomes 10 <em>per instance</em>, and a
 * restart forgives every lockout mid-attack. The counters live in the database
 * now, so the limit is the limit however many processes are serving.
 *
 * <p>The interface exists so the backoff policy stays testable without a
 * database — {@code JdbcThrottleStore} is the only implementation that ships,
 * and the tests drive the guard through an in-memory fake. That is the whole
 * reason for the seam; don't add a third implementation looking for a use.
 *
 * <p>Keys are hashed before they reach the store (see
 * {@link JdbcThrottleStore#hash}), so a fixed-width column can hold an identity
 * of any length and a throttle table never accumulates raw email addresses.
 */
public interface ThrottleStore {

    /** One identity's failure history. */
    record Attempt(int failures, long lockedUntilMs, long updatedAtMs) {
        static final Attempt NONE = new Attempt(0, 0, 0);
    }

    /**
     * Count one hit against a fixed window and return the running total,
     * <em>including</em> this hit. Atomic: two instances hitting the same window
     * cannot both read the same number.
     */
    int countHit(String bucketKey, long windowStart);

    /** Drop counters for windows that closed before {@code cutoffWindowStart}. */
    void sweepCounters(long cutoffWindowStart);

    /** This identity's current state, or {@link Attempt#NONE} when it has none. */
    Attempt attempt(String key);

    /**
     * Add one failure and apply {@code policy} to the resulting count to get the
     * new lock expiry. Read-modify-write, so it has to be atomic against other
     * instances — and it must commit even when the caller is inside a
     * transaction that is about to roll back, which is exactly what a rejected
     * sign-in does.
     */
    void recordFailure(String key, java.util.function.IntUnaryOperator lockMsForFailures);

    /** Forget this identity — a successful sign-in. */
    void clearAttempt(String key);

    /** Drop identities idle since before {@code cutoffMs} that are not locked now. */
    void sweepAttempts(long cutoffMs);
}
