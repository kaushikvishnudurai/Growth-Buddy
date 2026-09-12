package com.growthbuddy.common;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.function.IntUnaryOperator;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link ThrottleStore} on the database every instance already shares.
 *
 * <p>Plain JDBC rather than JPA: these are counters, not domain rows, and the
 * two operations that matter — an atomic increment and a locked
 * read-modify-write — are clearer said in SQL than coaxed out of an entity.
 */
@Component
public class JdbcThrottleStore implements ThrottleStore {

    private final JdbcTemplate jdbc;

    public JdbcThrottleStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Identities are arbitrary length ("login:" plus an email can run past 250
     * characters) and a utf8mb4 index caps a key column around 191. A SHA-256
     * hex digest is fixed at 64, never collides in practice, and keeps raw email
     * addresses out of a table that exists only to count.
     */
    static String hash(String key) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(key.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the JDK", e);
        }
    }

    @Override
    public int countHit(String bucketKey, long windowStart) {
        String k = hash(bucketKey);
        // The increment is atomic. The read after it can see a HIGHER number if
        // another instance incremented in between — which makes us stricter, never
        // looser, so the limit can never be overshot by racing.
        jdbc.update("INSERT INTO rate_limit_counters (bucket_key, window_start, hits) VALUES (?, ?, 1) "
                + "ON DUPLICATE KEY UPDATE hits = hits + 1", k, windowStart);
        Integer hits = jdbc.queryForObject(
                "SELECT hits FROM rate_limit_counters WHERE bucket_key = ? AND window_start = ?",
                Integer.class, k, windowStart);
        return hits == null ? 1 : hits;
    }

    @Override
    public void sweepCounters(long cutoffWindowStart) {
        jdbc.update("DELETE FROM rate_limit_counters WHERE window_start < ?", cutoffWindowStart);
    }

    @Override
    public Attempt attempt(String key) {
        List<Attempt> rows = jdbc.query(
                "SELECT failures, locked_until_ms, updated_at_ms FROM login_attempts WHERE attempt_key = ?",
                (rs, i) -> new Attempt(rs.getInt(1), rs.getLong(2), rs.getLong(3)),
                hash(key));
        return rows.isEmpty() ? Attempt.NONE : rows.get(0);
    }

    /**
     * REQUIRES_NEW is load-bearing, not decoration. {@code AuthService.login} is
     * {@code @Transactional} and records the failure immediately before throwing
     * — so on the caller's transaction this write would roll back with the
     * rejection it exists to count, and the lockout would never engage at all.
     * Its own transaction commits regardless of what the caller does next.
     */
    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordFailure(String key, IntUnaryOperator lockMsForFailures) {
        String k = hash(key);
        long now = System.currentTimeMillis();
        // Make sure the row exists before locking it: SELECT ... FOR UPDATE takes
        // no lock on a row that isn't there, so two instances could both miss and
        // both insert.
        jdbc.update("INSERT IGNORE INTO login_attempts "
                + "(attempt_key, failures, locked_until_ms, updated_at_ms) VALUES (?, 0, 0, ?)", k, now);
        List<Attempt> rows = jdbc.query(
                "SELECT failures, locked_until_ms, updated_at_ms FROM login_attempts "
                        + "WHERE attempt_key = ? FOR UPDATE",
                (rs, i) -> new Attempt(rs.getInt(1), rs.getLong(2), rs.getLong(3)), k);
        Attempt prev = rows.isEmpty() ? Attempt.NONE : rows.get(0);

        int failures = prev.failures() + 1;
        long lockMs = lockMsForFailures.applyAsInt(failures);
        long lockedUntil = lockMs > 0 ? now + lockMs : prev.lockedUntilMs();
        jdbc.update("UPDATE login_attempts SET failures = ?, locked_until_ms = ?, updated_at_ms = ? "
                + "WHERE attempt_key = ?", failures, lockedUntil, now, k);
    }

    @Override
    public void clearAttempt(String key) {
        jdbc.update("DELETE FROM login_attempts WHERE attempt_key = ?", hash(key));
    }

    @Override
    public void sweepAttempts(long cutoffMs) {
        // Never evict a live lock, however stale the row looks.
        jdbc.update("DELETE FROM login_attempts WHERE updated_at_ms < ? AND locked_until_ms < ?",
                cutoffMs, System.currentTimeMillis());
    }
}
