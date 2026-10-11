package com.growthbuddy.user;

import com.growthbuddy.common.CurrentUser;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * GET /api/auth/export — everything this account owns, as one JSON download.
 *
 * <p>Driven by {@link AuthService#USER_OWNED_TABLES}, the same list account
 * deletion purges (and {@code AccountDeletionCoverageTest} keeps complete), so a
 * new user-owned table reaches the export the moment it reaches deletion. Each
 * table is read generically with {@code WHERE user_id = ?}, plus
 * {@link #RELATED_QUERIES} for rows owned through a parent; the rows go out as
 * the database holds them.
 *
 * <p>Secrets stay home: password hashes, session token hashes and every OTP table
 * are skipped outright, and a push subscription's encryption keys are dropped
 * (the endpoint alone says which devices were subscribed). Per-IP rate-limited
 * by {@code RateLimitInterceptor} (WebConfig) — it reads every table, so it is
 * the most expensive GET there is.
 */
@RestController
public class DataExportController {

    private static final Logger log = LoggerFactory.getLogger(DataExportController.class);

    /** Credentials and one-time codes: never part of an export. */
    static final Set<String> SECRET_TABLES = Set.of(
            "password_credentials", "sessions",
            "email_verification_tokens", "password_reset_tokens", "whatsapp_otp_tokens",
            "email_change_tokens", "user_totp",
            // Not a secret, but not the user's data either: cached API answers kept
            // 48h for Idempotency-Key replays.
            "idempotency_keys");

    /** Columns dropped from rows that are otherwise exported. */
    private static final Set<String> SECRET_COLUMNS = Set.of(
            "p256dh", "auth", "auth_key", "p256dh_key", "password_hash", "token_hash", "code_hash");

    /**
     * Purged children that are other members' rows, not this account's: kudos and
     * replies others left under its posts. Its own kudos and replies go out with
     * USER_OWNED_TABLES.
     */
    static final Set<String> NOT_EXPORTED_CHILDREN = Set.of("circle_post_reactions", "circle_post_comments");

    /**
     * Rows this account owns through a parent or a relationship column, one bound
     * parameter each: the purge deletes them too, and a portability copy without
     * every Buddy chat message, mentorship thread or the account's own family
     * profile was missing the most personal data. Built from
     * {@link AuthService#CHILD_TABLES} so a new child reaches both at once;
     * {@code AccountDeletionCoverageTest} holds the two lists together.
     */
    static final Map<String, String> RELATED_QUERIES = relatedQueries();

    private static Map<String, String> relatedQueries() {
        Map<String, String> q = new LinkedHashMap<>();
        for (String[] cd : AuthService.CHILD_TABLES) {
            if (NOT_EXPORTED_CHILDREN.contains(cd[0])) continue;
            q.put(cd[0], "SELECT * FROM " + cd[0] + " WHERE " + cd[1]
                    + " IN (SELECT id FROM " + cd[2] + " WHERE user_id = ?)");
        }
        // Both ends of a mentorship own it (and its thread); the family row is the
        // account's own profile in a family, wherever that family's owner is.
        q.put("mentorship_requests", "SELECT * FROM mentorship_requests WHERE ? IN (from_user_id, to_user_id)");
        q.put("mentorship_messages", "SELECT * FROM mentorship_messages WHERE link_id IN"
                + " (SELECT id FROM mentorship_requests WHERE ? IN (from_user_id, to_user_id))");
        q.put("family_members", "SELECT * FROM family_members WHERE linked_user_id = ?");
        return q;
    }

    private final JdbcTemplate jdbc;

    public DataExportController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping(value = "/api/auth/export", produces = MediaType.APPLICATION_JSON_VALUE)
    @Transactional(readOnly = true)
    public ResponseEntity<Map<String, Object>> export() {
        UUID userId = CurrentUser.id();
        String id = userId.toString();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("exportedAt", Instant.now().toString());
        out.put("format", "growth-buddy-export/1");
        List<Map<String, Object>> me = jdbc.queryForList("SELECT * FROM users WHERE id = ?", id);
        out.put("account", me.isEmpty() ? null : scrub(me.get(0)));

        Map<String, Object> tables = new LinkedHashMap<>();
        for (String t : AuthService.USER_OWNED_TABLES) {
            if (SECRET_TABLES.contains(t)) continue;
            put(tables, t, "SELECT * FROM " + t + " WHERE user_id = ?", id);
        }
        RELATED_QUERIES.forEach((t, sql) -> put(tables, t, sql, id));
        out.put("tables", tables);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"growth-buddy-export.json\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(out);
    }

    private void put(Map<String, Object> tables, String t, String sql, String id) {
        try {
            tables.put(t, jdbc.queryForList(sql, id).stream().map(DataExportController::scrub).toList());
        } catch (RuntimeException e) {
            // A table missing from this database (a legacy schema) must not sink
            // the whole export; say which one rather than pretend it was empty.
            log.warn("export: skipped {} for {}: {}", t, id, e.getMessage());
            tables.put(t, Map.of("error", "unavailable"));
        }
    }

    private static Map<String, Object> scrub(Map<String, Object> row) {
        Map<String, Object> copy = new LinkedHashMap<>(row);
        copy.keySet().removeIf(k -> SECRET_COLUMNS.contains(k.toLowerCase()));
        return copy;
    }
}
