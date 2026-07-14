package com.growthbuddy.score;

import com.growthbuddy.habit.HabitService;
import com.growthbuddy.task.TaskRepository;
import java.time.LocalDate;
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

    public ScoreService(TaskRepository tasks, HabitService habits, DailyScoreRepository scores) {
        this.tasks = tasks;
        this.habits = habits;
        this.scores = scores;
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

        double sum = 0;
        int parts = 0;
        if (taskTotal > 0) {
            sum += (double) taskDone / taskTotal;
            parts++;
        }
        if (hc.total() > 0) {
            sum += (double) hc.done() / hc.total();
            parts++;
        }
        int score = parts == 0 ? 0 : (int) Math.round((sum / parts) * 100);

        return new ScoreResponse(LocalDate.now(), score,
                (int) taskDone, (int) taskTotal, hc.done(), hc.total());
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
