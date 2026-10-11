package com.growthbuddy.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.growthbuddy.habit.HabitService;
import com.growthbuddy.task.TaskRepository;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Unit tests for the daily-score math. The score is the average completion
 * ratio across the categories the user actually has — a 50/50 split when both
 * tasks and habits exist, otherwise just the present category's ratio.
 */
@ExtendWith(MockitoExtension.class)
class ScoreServiceTest {

    private static final UUID USER = UUID.randomUUID();

    @Mock TaskRepository tasks;
    @Mock HabitService habits;
    @Mock DailyScoreRepository scores;
    @Mock UserClock clock;
    @Mock UserRepository users;

    private ScoreService service() {
        return new ScoreService(tasks, habits, scores, clock, users);
    }

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 11);

    /** taskTotal = done today + open and due by today's end; the stubs take it apart again. */
    private void stub(long taskTotal, long taskDone, int habitDone, int habitTotal) {
        stubTasks(taskDone, taskTotal - taskDone);
        when(habits.todayCounts(USER)).thenReturn(new HabitService.TodayCounts(habitDone, habitTotal));
    }

    private void stubTasks(long doneToday, long openDue) {
        when(clock.today(USER)).thenReturn(TODAY);
        when(clock.zoneOf(USER)).thenReturn(ZoneOffset.UTC);
        Instant start = TODAY.atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant end = TODAY.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
        when(tasks.countDoneBetween(USER, start, end)).thenReturn(doneToday);
        when(tasks.countOpenDueBefore(USER, end)).thenReturn(openDue);
    }

    /**
     * The QA case: one task due today and ticked, one due tomorrow, one undated.
     * Only today's counts: 1/1, not 1/3. The repository's bound is the end of
     * today, so tomorrow's and the undated one never reach countOpenDueBefore.
     */
    @Test
    void onlyTodaysTasksCount() {
        stub(1, 1, 0, 0);
        ScoreService.ScoreResponse r = service().today(USER);
        assertThat(r.tasksDone()).isEqualTo(1);
        assertThat(r.tasksTotal()).isEqualTo(1);
        assertThat(r.date()).isEqualTo(TODAY);
    }

    @Test
    void noTasksOrHabitsScoresZero() {
        stub(0, 0, 0, 0);
        assertThat(service().today(USER).score()).isZero();
    }

    @Test
    void allTasksDoneNoHabitsScores100_notHalf() {
        // Regression guard: 1/1 tasks with 0 habits must be 100, never 50.
        stub(1, 1, 0, 0);
        ScoreService.ScoreResponse r = service().today(USER);
        assertThat(r.score()).isEqualTo(100);
        assertThat(r.tasksDone()).isEqualTo(1);
        assertThat(r.tasksTotal()).isEqualTo(1);
    }

    @Test
    void habitsOnlyUsesHabitRatio() {
        stub(0, 0, 2, 4);
        assertThat(service().today(USER).score()).isEqualTo(50);
    }

    @Test
    void bothCategoriesAverageEvenly() {
        // tasks 1/2 = 0.5, habits 3/3 = 1.0  ->  avg 0.75  ->  75
        stub(2, 1, 3, 3);
        assertThat(service().today(USER).score()).isEqualTo(75);
    }

    /** Habits switched off in Settings: 1/1 tasks is 100, not held at 50 by unseen habits. */
    @Test
    void habitsFeatureOffIgnoresHabits() {
        User u = new User();
        u.setFeaturePrefs(Map.of("habits", false));
        when(users.findById(USER)).thenReturn(Optional.of(u));
        stubTasks(1, 0);
        ScoreService.ScoreResponse r = service().today(USER);
        assertThat(r.score()).isEqualTo(100);
        assertThat(r.habitsTotal()).isZero();
    }

    @Test
    void roundsToNearestPercent() {
        // tasks only, 1/3 = 0.3333…  ->  33
        stub(3, 1, 0, 0);
        assertThat(service().today(USER).score()).isEqualTo(33);
    }

    /**
     * The digest bug: by the time a digest fires, the midnight sweep has cleared
     * every task ticked off yesterday and the habit check-ins belong to a new log
     * date, so the live rows say 0. `on()` must read yesterday out of history
     * instead — 2 tasks finished then, 2 still open now (2/4), habits 2/2 -> 75%.
     */
    @Test
    void pastDayComesFromHistoryNotLiveRows() {
        LocalDate day = LocalDate.of(2026, 9, 17);
        when(clock.zoneOf(USER)).thenReturn(ZoneOffset.UTC);
        when(tasks.countCompletedBetween(eq(USER), any(), any())).thenReturn(2L);
        when(tasks.countOpenDueBefore(USER, day.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant())).thenReturn(2L);
        when(habits.countsOn(USER, day)).thenReturn(new HabitService.TodayCounts(2, 2));

        ScoreService.ScoreResponse r = service().on(USER, day);
        assertThat(r.date()).isEqualTo(day);
        assertThat(r.tasksDone()).isEqualTo(2);
        assertThat(r.tasksTotal()).isEqualTo(4);
        assertThat(r.score()).isEqualTo(75);
    }

    /** The weekly digest adds the days up rather than reading one live moment. */
    @Test
    void weeklyRangeSumsEachDay() {
        LocalDate to = LocalDate.of(2026, 9, 17);
        when(clock.zoneOf(USER)).thenReturn(ZoneOffset.UTC);
        when(tasks.countCompletedBetween(eq(USER), any(), any())).thenReturn(1L);
        when(tasks.countOpenDueBefore(eq(USER), any())).thenReturn(0L);
        when(habits.countsOn(eq(USER), any())).thenReturn(new HabitService.TodayCounts(0, 0));

        ScoreService.ScoreResponse r = service().between(USER, to.minusDays(6), to);
        assertThat(r.tasksDone()).isEqualTo(7);
        assertThat(r.tasksTotal()).isEqualTo(7);
        assertThat(r.score()).isEqualTo(100);
    }

    /**
     * Report's history: one read each for completions, open due tasks and habits,
     * bucketed by the user's local day. Today is dropped, a day with nothing to
     * score is left out, and each day matches what on() would say for it.
     */
    @Test
    void rangeScoresFinishedDaysFromOnePass() {
        java.time.ZoneId ist = java.time.ZoneId.of("Asia/Kolkata");
        when(clock.today(USER)).thenReturn(TODAY);
        when(clock.zoneOf(USER)).thenReturn(ist);
        LocalDate d1 = TODAY.minusDays(3);
        LocalDate d2 = TODAY.minusDays(2);
        UUID a = UUID.randomUUID();
        // 00:30 IST on d2 is still d1 in UTC: the bucket must be the user's day.
        Instant d2Early = d2.atTime(0, 30).atZone(ist).toInstant();
        when(tasks.completionsBetween(eq(USER), any(), any())).thenReturn(java.util.List.of(
                new Object[] {a, d1.atTime(10, 0).atZone(ist).toInstant()},
                new Object[] {a, d1.atTime(11, 0).atZone(ist).toInstant()}, // the same task twice: once
                new Object[] {UUID.randomUUID(), d2Early}));
        // One open task, due on d2: counted from d2 on, not on d1.
        when(tasks.openDueBefore(eq(USER), any())).thenReturn(java.util.List.of(d2.atTime(18, 0).atZone(ist).toInstant()));
        java.util.Map<LocalDate, HabitService.TodayCounts> hc = new java.util.HashMap<>();
        hc.put(d1, new HabitService.TodayCounts(1, 2));
        when(habits.countsBetween(USER, d1.minusDays(1), TODAY.minusDays(1))).thenReturn(hc);

        var r = service().range(USER, d1.minusDays(1), TODAY);

        assertThat(r).containsExactly(
                new ScoreService.DayScore(d1, 75),  // tasks 1/1, habits 1/2
                new ScoreService.DayScore(d2, 50),  // tasks 1/2
                new ScoreService.DayScore(TODAY.minusDays(1), 0)); // the open task, overdue
    }
}
