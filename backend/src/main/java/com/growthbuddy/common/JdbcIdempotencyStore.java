package com.growthbuddy.common;

import java.sql.Timestamp;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * {@link IdempotencyStore} on the shared database ({@code idempotency_keys}).
 *
 * <p>Plain JDBC, autocommit, outside any request transaction: the reservation
 * has to be visible to a concurrent retry the moment it is made, and has to
 * survive the handler's transaction rolling back. The primary key
 * {@code (user_id, idem_key)} is the lock — the INSERT either wins or hits
 * the duplicate, so two instances cannot both run the same keyed write.
 * Rows older than 48h are purged by {@code DataCleanupJob}.
 */
@Component
public class JdbcIdempotencyStore implements IdempotencyStore {

    private final JdbcTemplate jdbc;

    public JdbcIdempotencyStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private record Row(String method, String path, Integer status, String contentType, String body) {
    }

    @Override
    public Outcome reserve(UUID userId, String key, String method, String path, long staleMs) {
        String uid = userId.toString();
        // Twice at most: a row released (5xx) between our INSERT and SELECT is gone,
        // and the second INSERT then claims it like a first request.
        for (int attempt = 0; attempt < 2; attempt++) {
            long now = System.currentTimeMillis();
            try {
                jdbc.update("INSERT INTO idempotency_keys (user_id, idem_key, method, path, created_at) "
                        + "VALUES (?, ?, ?, ?, ?)", uid, key, method, path, new Timestamp(now));
                return Outcome.RESERVED;
            } catch (DuplicateKeyException taken) {
                // fall through: read what holds it
            }
            List<Row> rows = jdbc.query(
                    "SELECT method, path, status, content_type, response_body FROM idempotency_keys "
                            + "WHERE user_id = ? AND idem_key = ?",
                    (rs, i) -> new Row(rs.getString(1), rs.getString(2),
                            (Integer) rs.getObject(3, Integer.class), rs.getString(4), rs.getString(5)),
                    uid, key);
            if (rows.isEmpty()) {
                continue;
            }
            Row row = rows.get(0);
            if (!row.method().equals(method) || !row.path().equals(path)) {
                return Outcome.MISMATCH;
            }
            if (row.status() != null) {
                return Outcome.replay(row.status(), row.contentType(), row.body());
            }
            // In progress. Take it over only if it is stale; the WHERE makes that a
            // compare-and-set, so exactly one retry wins it.
            int took = jdbc.update("UPDATE idempotency_keys SET created_at = ? "
                            + "WHERE user_id = ? AND idem_key = ? AND status IS NULL AND created_at < ?",
                    new Timestamp(now), uid, key, new Timestamp(now - staleMs));
            return took == 1 ? Outcome.RESERVED : Outcome.IN_PROGRESS;
        }
        return Outcome.IN_PROGRESS;
    }

    @Override
    public void complete(UUID userId, String key, int status, String contentType, String body) {
        jdbc.update("UPDATE idempotency_keys SET status = ?, content_type = ?, response_body = ? "
                + "WHERE user_id = ? AND idem_key = ?", status, contentType, body, userId.toString(), key);
    }

    @Override
    public void release(UUID userId, String key) {
        jdbc.update("DELETE FROM idempotency_keys WHERE user_id = ? AND idem_key = ? AND status IS NULL",
                userId.toString(), key);
    }
}
