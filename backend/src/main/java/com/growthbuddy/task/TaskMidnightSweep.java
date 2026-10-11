package com.growthbuddy.task;

import com.growthbuddy.common.UserZone;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Clears finished tasks at each user's own midnight.
 *
 * <p>Tasks are a flat list with no day of their own, so anything ticked off on
 * Monday was still sitting in Tuesday's list — and still counting towards
 * Tuesday's score, which {@code ScoreService} computes from the live task rows.
 * A day that starts already scored is a day that can't be earned.
 *
 * <p>Only {@code done} tasks go. An unfinished task genuinely does carry
 * forward: it is still to do. History rows are untouched, so the report,
 * the completion count and the "done 3×" sub-line survive the sweep.
 *
 * <p>Runs hourly because midnight is a local event. Any tick may sweep a user
 * whose oldest tick predates their local today, not only the hour-0 one: a host
 * asleep through midnight (Render idles), or a zone springing forward AT
 * midnight, would otherwise leave yesterday's ticks in today's list. Only ticks
 * from before that midnight go, so re-running is harmless and today's survive.
 */
@Component
public class TaskMidnightSweep {

    private static final Logger log = LoggerFactory.getLogger(TaskMidnightSweep.class);

    private final UserRepository users;
    private final TaskRepository tasks;

    public TaskMidnightSweep(UserRepository users, TaskRepository tasks) {
        this.users = users;
        this.tasks = tasks;
    }

    @Scheduled(cron = "0 0 * * * *")
    @Transactional
    public void clearCompletedAtLocalMidnight() {
        Map<UUID, Instant> oldest = new HashMap<>();
        for (Object[] row : tasks.findOldestCompletedByUser()) {
            oldest.put((UUID) row[0], (Instant) row[1]);
        }
        if (oldest.isEmpty()) {
            return;
        }
        Instant now = Instant.now();
        int cleared = 0;
        for (User user : users.findAllById(oldest.keySet())) {
            Instant midnight = localMidnight(user.getTimezone(), now);
            Instant first = oldest.get(user.getId());
            if (first != null && !first.isBefore(midnight)) {
                continue; // everything ticked off today: nothing to sweep yet
            }
            cleared += tasks.clearCompletedFor(user.getId(), midnight, now);
        }
        if (cleared > 0) {
            log.info("Midnight sweep cleared {} completed task(s)", cleared);
        }
    }

    /** The instant today began for someone in this zone (DST-safe: atStartOfDay). */
    static Instant localMidnight(String timezone, Instant at) {
        return UserZone.today(timezone, at).atStartOfDay(UserZone.of(timezone)).toInstant();
    }
}
