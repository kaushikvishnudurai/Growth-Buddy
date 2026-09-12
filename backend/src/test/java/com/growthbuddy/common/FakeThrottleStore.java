package com.growthbuddy.common;

import java.util.HashMap;
import java.util.Map;
import java.util.function.IntUnaryOperator;

/**
 * In-memory {@link ThrottleStore} for the tests.
 *
 * <p>A hand-written fake rather than a mock: the guard's whole job is
 * read-modify-write arithmetic over this state, and stubbing it call by call
 * would assert that the test knows the implementation, not that the lockout
 * works. This is the old ConcurrentHashMap, kept alive for exactly that.
 */
class FakeThrottleStore implements ThrottleStore {

    private final Map<String, Attempt> attempts = new HashMap<>();
    private final Map<String, Integer> counters = new HashMap<>();

    @Override
    public int countHit(String bucketKey, long windowStart) {
        return counters.merge(bucketKey + "@" + windowStart, 1, Integer::sum);
    }

    @Override
    public void sweepCounters(long cutoffWindowStart) {
        counters.keySet().removeIf(k -> Long.parseLong(k.substring(k.lastIndexOf('@') + 1)) < cutoffWindowStart);
    }

    @Override
    public Attempt attempt(String key) {
        return attempts.getOrDefault(key, Attempt.NONE);
    }

    @Override
    public void recordFailure(String key, IntUnaryOperator lockMsForFailures) {
        long now = System.currentTimeMillis();
        Attempt prev = attempt(key);
        int failures = prev.failures() + 1;
        long lockMs = lockMsForFailures.applyAsInt(failures);
        attempts.put(key, new Attempt(failures, lockMs > 0 ? now + lockMs : prev.lockedUntilMs(), now));
    }

    @Override
    public void clearAttempt(String key) {
        attempts.remove(key);
    }

    @Override
    public void sweepAttempts(long cutoffMs) {
        long now = System.currentTimeMillis();
        attempts.values().removeIf(a -> a.updatedAtMs() < cutoffMs && a.lockedUntilMs() < now);
    }
}
