package com.growthbuddy.score;

import com.growthbuddy.habit.HabitService;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.task.TaskRepository;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Computes today's growth score as the average completion rate across the
 * categories the user actually has. With both tasks and habits it's a 50/50
 * split; with only one category it's that category's completion ratio.
 * (Avoids the prior bug where 1/1 tasks + 0 habits scored 50.)
 */
@Service
public class ScoreService {

    private final TaskRepository tasks;
    private final HabitService habits;
    private final DailyScoreRepository scores;
    private final UserClock clock;

    public ScoreService(TaskRepository tasks, HabitService habits, DailyScoreRepository scores,
                        UserClock clock) {
        this.tasks = tasks;
        this.habits = habits;
        this.scores = scores;
        this.clock = clock;
    }

    public record ScoreResponse(
            LocalDate date, int score,
            int tasksDone, int tasksTotal,
            int habitsDone, int habitsTotal) {
    }

    @Transactional(readOnly = true)
    public ScoreResponse today(UUID userId) {
        long taskTotal = tasks.countByUserIdAndDeletedAtIsNull(userId);
        long taskDone = tasks.countByUserIdAndDoneTrueAndDeletedAtIsNull(userId);
        HabitService.TodayCounts hc = habits.todayCounts(userId);
        return build(clock.today(userId), taskDone, taskTotal, hc.done(), hc.total());
    }

    /**
     * The score for a day that has already ended. {@link #today} can't answer this:
     * it reads the live rows, and by the time anything looks back at yesterday the
     * midnight sweep has soft-deleted every task ticked off then and the habit
     * check-ins belong to a new log date — so yesterday reads as a flat zero.
     *
     * <p>Completions come from {@code task_completion_history}, which the sweep
     * leaves alone. ponytail: the day's task <em>total</em> is reconstructed as
     * "finished then + still open now", because nothing stores it. A task created
     * since inflates it; snapshot into {@code daily_scores} at the sweep if that
     * ever matters.
     */
    @Transactional(readOnly = true)
    public ScoreResponse on(UUID userId, LocalDate day) {
        ZoneId zone = clock.zoneOf(userId);
        long done = tasks.countCompletedBetween(userId,
                day.atStartOfDay(zone).toInstant(),
                day.plusDays(1).atStartOfDay(zone).toInstant());
        long open = tasks.countByUserIdAndDeletedAtIsNull(userId)
                - tasks.countByUserIdAndDoneTrueAndDeletedAtIsNull(userId);
        HabitService.TodayCounts hc = habits.countsOn(userId, day);
        return build(day, done, done + open, hc.done(), hc.total());
    }

    /**
     * Totals across an inclusive range — what the weekly digest reports.
     * ponytail: a day at a time, so one rule decides a day everywhere. Seven
     * cheap reads once a week per user is not worth a bespoke range query.
     */
    @Transactional(readOnly = true)
    public ScoreResponse between(UUID userId, LocalDate from, LocalDate to) {
        long taskDone = 0;
        long taskTotal = 0;
        int habitDone = 0;
        int habitTotal = 0;
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            ScoreResponse s = on(userId, d);
            taskDone += s.tasksDone();
            taskTotal += s.tasksTotal();
            habitDone += s.habitsDone();
            habitTotal += s.habitsTotal();
        }
        return build(to, taskDone, taskTotal, habitDone, habitTotal);
    }

    private static ScoreResponse build(LocalDate date, long taskDone, long taskTotal,
                                       int habitDone, int habitTotal) {
        double sum = 0;
        int parts = 0;
        if (taskTotal > 0) {
            sum += (double) taskDone / taskTotal;
            parts++;
        }
        if (habitTotal > 0) {
            sum += (double) habitDone / habitTotal;
            parts++;
        }
        int score = parts == 0 ? 0 : (int) Math.round((sum / parts) * 100);
        return new ScoreResponse(date, score, (int) taskDone, (int) taskTotal, habitDone, habitTotal);
    }

    /** Persist today's score into {@code daily_scores} (idempotent upsert). */
    @Transactional
    public ScoreResponse snapshotToday(UUID userId) {
        ScoreResponse s = today(userId);
        DailyScore.Key key = new DailyScore.Key();
        key.setUserId(userId);
        key.setScoreDate(s.date());
        DailyScore row = scores.findById(key).orElseGet(() -> {
            DailyScore d = new DailyScore();
            d.setUserId(userId);
            d.setScoreDate(s.date());
            return d;
        });
        row.setScore(s.score());
        row.setTasksDone(s.tasksDone());
        row.setTasksTotal(s.tasksTotal());
        row.setHabitsDone(s.habitsDone());
        row.setHabitsTotal(s.habitsTotal());
        scores.save(row);
        return s;
    }
}
