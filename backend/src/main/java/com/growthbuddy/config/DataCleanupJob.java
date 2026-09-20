package com.growthbuddy.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Nightly purge of rows that only grow and are never read again:
 * expired/revoked sessions, spent auth tokens, and old read notifications.
 * Keeps the database inside a small hosting quota without touching user data.
 *
 * <p>Also drops abandoned signups — see {@link #purgeAbandonedSignups()}. That
 * one DOES remove a users row, so it is deliberately conservative.
 */
@Component
public class DataCleanupJob {

    private static final Logger log = LoggerFactory.getLogger(DataCleanupJob.class);

    /** Days an unverified account is kept before it counts as abandoned. */
    private static final int ABANDONED_SIGNUP_DAYS = 7;

    private final JdbcTemplate jdbc;

    public DataCleanupJob(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Scheduled(cron = "0 30 3 * * *")
    public void purgeExpiredRows() {
        int total = 0;
        total += jdbc.update("DELETE FROM sessions WHERE expires_at < NOW() OR revoked_at IS NOT NULL");
        total += jdbc.update("DELETE FROM email_verification_tokens WHERE expires_at < NOW()");
        total += jdbc.update("DELETE FROM password_reset_tokens WHERE expires_at < NOW()");
        total += jdbc.update("DELETE FROM whatsapp_otp_tokens WHERE expires_at < NOW()");
        total += jdbc.update("DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < NOW() - INTERVAL 90 DAY");
        // Dedupe guard only ever reads today's row; older ones are pure ballast.
        total += jdbc.update(
                "DELETE FROM reminder_dispatch_log WHERE occurrence_date < CURDATE() - INTERVAL 30 DAY");
        // Same dedupe-guard shape, habit side.
        total += jdbc.update(
                "DELETE FROM habit_reminder_dispatch_log WHERE occurrence_date < CURDATE() - INTERVAL 30 DAY");
        log.info("Data cleanup removed {} expired rows", total);
        purgeAbandonedSignups();
    }

    /**
     * Remove signups that never verified their email.
     *
     * <p>{@code signup()} writes the users row BEFORE the OTP is checked, so a
     * mistyped or abandoned signup leaves an account forever. It can never sign
     * in (sign-in rejects unverified accounts) but it still occupies the unique
     * email, and it used to surface in Circle/Family people search.
     *
     * <p>The OTP itself lives 15 minutes, so anything still unverified after
     * {@value #ABANDONED_SIGNUP_DAYS} days is abandoned by any reasonable
     * measure — the window is generous because "resend verification" stays open
     * indefinitely and deleting a row someone was about to claim is the one
     * mistake worth avoiding here.
     *
     * <p>Children are deleted explicitly rather than leaning on
     * {@code ON DELETE CASCADE}: TiDB only enforces foreign keys from v6.6, so
     * on an older cluster a cascade silently leaves orphans instead.
     */
    private void purgeAbandonedSignups() {
        // Every table below is one an account can hold rows in WITHOUT ever
        // signing in: the two created by signup itself, a forgot-password
        // attempt, and anything another user aimed at them (invites + the
        // notification that announces one).
        String stale = "SELECT id FROM users WHERE email_verified = 0"
                + " AND created_at < NOW() - INTERVAL " + ABANDONED_SIGNUP_DAYS + " DAY";
        int children = 0;
        children += jdbc.update("DELETE FROM email_verification_tokens WHERE user_id IN (" + stale + ")");
        children += jdbc.update("DELETE FROM password_reset_tokens WHERE user_id IN (" + stale + ")");
        children += jdbc.update("DELETE FROM password_credentials WHERE user_id IN (" + stale + ")");
        children += jdbc.update("DELETE FROM notifications WHERE user_id IN (" + stale + ")");
        children += jdbc.update("DELETE FROM mentorship_requests WHERE from_user_id IN (" + stale + ")"
                + " OR to_user_id IN (" + stale + ")");
        // Last: the child deletes above read `users` through `stale`.
        int accounts = jdbc.update("DELETE FROM users WHERE email_verified = 0"
                + " AND created_at < NOW() - INTERVAL " + ABANDONED_SIGNUP_DAYS + " DAY");
        if (accounts > 0) {
            log.info("Data cleanup removed {} abandoned signup(s) and {} related rows", accounts, children);
        }
    }
}
