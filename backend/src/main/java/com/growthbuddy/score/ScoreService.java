package com.growthbuddy.score;

import com.growthbuddy.habit.HabitService;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import com.growthbuddy.task.TaskRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Computes today's growth score as the average completion rate across the
 * categories the user actually has. With both tasks and habits it's a 50/50
 * split; with only one category it's that category's completion ratio.
 * (Avoids the prior bug where 1/1 tasks + 0 habits scored 50.)
 * Habits switched off in Settings count as none: the user can't see or tick
 * them, so they mustn't hold the score at half.
 */
@Service
public class ScoreService {

    private final TaskRepository tasks;
    private final HabitService habits;
    private final DailyScoreRepository scores;
    private final UserClock clock;
    private final UserRepository users;

    private static final HabitService.TodayCounts NO_HABITS = new HabitService.TodayCounts(0, 0);

    public ScoreService(TaskRepository tasks, HabitService habits, DailyScoreRepository scores,
                        UserClock clock, UserRepository users) {
        this.tasks = tasks;
        this.habits = habits;
        this.scores = scores;
        this.clock = clock;
        this.users = users;
    }

    /** Same rule as the client's featureOn: only an explicit false turns it off. */
    private boolean habitsOn(UUID userId) {
        return users.findById(userId)
                .map(u -> u.getFeaturePrefs() == null
                        || !Boolean.FALSE.equals(u.getFeaturePrefs().get("habits")))
                .orElse(true);
    }

    public record ScoreResponse(
            LocalDate date, int score,
            int tasksDone, int tasksTotal,
            int habitsDone, int habitsTotal) {
    }

    /**
     * Tasks: "x/N" is the day's tasks, not the whole list. N = open tasks due by the
     * end of today (overdue included) + tasks ticked off today (any due date, or
     * none); x = the latter. An open undated task, or one due tomorrow, is not
     * today's, so it neither counts nor drags the score.
     */
    @Transactional(readOnly = true)
    public ScoreResponse today(UUID userId) {
        LocalDate today = clock.today(userId);
        ZoneId zone = clock.zoneOf(userId);
        Instant start = today.atStartOfDay(zone).toInstant();
        Instant end = today.plusDays(1).atStartOfDay(zone).toInstant();
        long taskDone = tasks.countDoneBetween(userId, start, end);
        long taskTotal = taskDone + tasks.countOpenDueBefore(userId, end);
        HabitService.TodayCounts hc = habitsOn(userId) ? habits.todayCounts(userId) : NO_HABITS;
        return build(today, taskDone, taskTotal, hc.done(), hc.total());
    }

    /**
     * The score for a day that has already ended. {@link #today} can't answer this:
     * it reads the live rows, and by the time anything looks back at yesterday the
     * midnight sweep has soft-deleted every task ticked off then and the habit
     * check-ins belong to a new log date — so yesterday reads as a flat zero.
     *
     * <p>Completions come from {@code task_completion_history}, which the sweep
     * leaves alone. ponytail: the day's task <em>total</em> is reconstructed as
     * "finished then + still open now and due by that day's end" (the same due
     * rule as {@link #today}), because nothing stores it. A task created since
     * inflates it; snapshot into {@code daily_scores} at the sweep if that ever
     * matters.
     */
    @Transactional(readOnly = true)
    public ScoreResponse on(UUID userId, LocalDate day) {
        ZoneId zone = clock.zoneOf(userId);
        Instant end = day.plusDays(1).atStartOfDay(zone).toInstant();
        long done = tasks.countCompletedBetween(userId, day.atStartOfDay(zone).toInstant(), end);
        long open = tasks.countOpenDueBefore(userId, end);
        HabitService.TodayCounts hc = habitsOn(userId) ? habits.countsOn(userId, day) : NO_HABITS;
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

    /** Longest {@link #range} asked for in one go: a year and a bit, the Report's widest view. */
    static final int RANGE_MAX_DAYS = 400;

    public record DayScore(LocalDate date, int score) {
    }

    /**
     * Finished days' scores in {@code [from, to]}, oldest first, by the same rule
     * as {@link #on}: Report's trend and pixels and Achievements' "On a Roll" had
     * only the ~2 days {@code daily_scores} held. Today is never included (it is
     * not finished; {@code to} is pulled back to yesterday). A day with nothing to
     * score (no task due or done, no habit owed) is left out rather than sent as 0.
     * Four reads for the whole range, not four per day.
     */
    @Transactional(readOnly = true)
    public List<DayScore> range(UUID userId, LocalDate from, LocalDate to) {
        LocalDate yesterday = clock.today(userId).minusDays(1);
        if (to.isAfter(yesterday)) {
            to = yesterday;
        }
        if (from.isAfter(to)) {
            return List.of();
        }
        ZoneId zone = clock.zoneOf(userId);
        Instant end = to.plusDays(1).atStartOfDay(zone).toInstant();
        Map<LocalDate, Set<Object>> doneBy = new HashMap<>();
        for (Object[] row : tasks.completionsBetween(userId, from.atStartOfDay(zone).toInstant(), end)) {
            doneBy.computeIfAbsent(LocalDate.ofInstant((Instant) row[1], zone), k -> new HashSet<>()).add(row[0]);
        }
        List<Instant> due = new ArrayList<>(tasks.openDueBefore(userId, end));
        Collections.sort(due);
        Map<LocalDate, HabitService.TodayCounts> hc = habitsOn(userId) ? habits.countsBetween(userId, from, to) : Map.of();
        List<DayScore> out = new ArrayList<>();
        int open = 0;
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            Instant dayEnd = d.plusDays(1).atStartOfDay(zone).toInstant();
            while (open < due.size() && due.get(open).isBefore(dayEnd)) {
                open++; // due is sorted: the count of open tasks due by this day's end only grows
            }
            long done = doneBy.getOrDefault(d, Set.of()).size();
            HabitService.TodayCounts h = hc.getOrDefault(d, NO_HABITS);
            ScoreResponse s = build(d, done, done + open, h.done(), h.total());
            if (s.tasksTotal() > 0 || s.habitsTotal() > 0) {
                out.add(new DayScore(d, s.score()));
            }
        }
        return out;
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
