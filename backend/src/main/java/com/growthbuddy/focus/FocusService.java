package com.growthbuddy.focus;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Records completed focus sessions and reports simple stats. Storage is bounded:
 * we keep at most {@link #MAX_PER_USER} sessions per user and prune the oldest
 * on insert, so the table stays flat no matter how long someone uses the app.
 */
@Service
public class FocusService {

    /** Hard cap on stored sessions per user — plenty for stats, never unbounded. */
    private static final int MAX_PER_USER = 500;

    private final FocusSessionRepository repo;

    @PersistenceContext
    private EntityManager em;

    public FocusService(FocusSessionRepository repo) {
        this.repo = repo;
    }

    public record FocusStats(int todayMinutes, int todaySessions, int weekMinutes, long totalSessions) {}

    @Transactional
    public FocusStats record(UUID userId, String mode, int durationSec) {
        FocusSession s = new FocusSession();
        s.setUserId(userId);
        s.setMode("break".equals(mode) ? "break" : "focus");
        s.setDurationSec(Math.max(0, Math.min(durationSec, 6 * 3600))); // clamp 0..6h
        repo.save(s);
        prune(userId);
        return stats(userId);
    }

    /** Keep only the newest MAX_PER_USER rows for the user; delete the rest. */
    private void prune(UUID userId) {
        long n = repo.countByUserId(userId);
        if (n <= MAX_PER_USER) return;
        int excess = (int) (n - MAX_PER_USER);
        em.createNativeQuery(
                "DELETE FROM focus_sessions WHERE user_id = ?1 ORDER BY completed_at ASC LIMIT ?2")
                .setParameter(1, userId)
                .setParameter(2, excess)
                .executeUpdate();
    }

    @Transactional(readOnly = true)
    public FocusStats stats(UUID userId) {
        Instant now = Instant.now();
        Instant dayAgo = now.minus(1, ChronoUnit.DAYS);
        Instant weekAgo = now.minus(7, ChronoUnit.DAYS);
        // Focus-mode sessions only for the "focus time" numbers.
        List<FocusSession> recent = repo.findByUserIdAndModeAndCompletedAtAfter(userId, "focus", weekAgo);
        int todaySec = 0;
        int todayCount = 0;
        int weekSec = 0;
        for (FocusSession s : recent) {
            weekSec += s.getDurationSec();
            if (s.getCompletedAt().isAfter(dayAgo)) {
                todaySec += s.getDurationSec();
                todayCount++;
            }
        }
        return new FocusStats(
                (int) Duration.ofSeconds(todaySec).toMinutes(),
                todayCount,
                (int) Duration.ofSeconds(weekSec).toMinutes(),
                repo.countByUserId(userId));
    }
}
