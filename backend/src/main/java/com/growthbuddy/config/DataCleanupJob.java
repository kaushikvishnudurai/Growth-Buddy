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
 */
@Component
public class DataCleanupJob {

    private static final Logger log = LoggerFactory.getLogger(DataCleanupJob.class);

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
        log.info("Data cleanup removed {} expired rows", total);
    }
}
