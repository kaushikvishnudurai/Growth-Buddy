package com.growthbuddy.task;

import com.growthbuddy.common.UserZone;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.util.List;
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
 * <p>Runs hourly rather than at one fixed time because midnight is a local
 * event — the same pattern {@code DigestScheduler} uses. Re-running is
 * harmless: the second pass finds nothing left to clear.
 *
 * <p>ponytail: an hourly tick, not a per-user timer. In the handful of zones
 * that spring forward AT midnight, hour 0 doesn't exist that night and the
 * sweep is skipped — the next midnight clears both days. A per-user scheduled
 * job would fix that and is not worth it.
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
        List<UUID> candidates = tasks.findUserIdsWithCompletedTasks();
        if (candidates.isEmpty()) {
            return;
        }
        Instant now = Instant.now();
        int cleared = 0;
        for (User user : users.findAllById(candidates)) {
            if (!isLocalMidnightHour(user.getTimezone(), now)) {
                continue;
            }
            cleared += tasks.clearCompletedFor(user.getId(), now);
        }
        if (cleared > 0) {
            log.info("Midnight sweep cleared {} completed task(s)", cleared);
        }
    }

    /**
     * Is {@code at} inside the first hour of a new day for someone in this zone?
     * Zones on a :30 or :45 offset still match exactly one hourly tick.
     */
    static boolean isLocalMidnightHour(String timezone, Instant at) {
        return at.atZone(UserZone.of(timezone)).getHour() == 0;
    }
}
