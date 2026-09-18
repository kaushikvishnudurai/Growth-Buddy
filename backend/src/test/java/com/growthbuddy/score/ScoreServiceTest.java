package com.growthbuddy.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.growthbuddy.habit.HabitService;
import com.growthbuddy.task.TaskRepository;
import com.growthbuddy.user.UserClock;
import java.time.LocalDate;
import java.time.ZoneOffset;
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

    private ScoreService service() {
        return new ScoreService(tasks, habits, scores, clock);
    }

    private void stub(long taskTotal, long taskDone, int habitDone, int habitTotal) {
        when(tasks.countByUserIdAndDeletedAtIsNull(USER)).thenReturn(taskTotal);
        when(tasks.countByUserIdAndDoneTrueAndDeletedAtIsNull(USER)).thenReturn(taskDone);
        when(habits.todayCounts(USER)).thenReturn(new HabitService.TodayCounts(habitDone, habitTotal));
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
        when(tasks.countByUserIdAndDeletedAtIsNull(USER)).thenReturn(2L);
        when(tasks.countByUserIdAndDoneTrueAndDeletedAtIsNull(USER)).thenReturn(0L);
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
        when(tasks.countByUserIdAndDeletedAtIsNull(USER)).thenReturn(0L);
        when(tasks.countByUserIdAndDoneTrueAndDeletedAtIsNull(USER)).thenReturn(0L);
        when(habits.countsOn(eq(USER), any())).thenReturn(new HabitService.TodayCounts(0, 0));

        ScoreService.ScoreResponse r = service().between(USER, to.minusDays(6), to);
        assertThat(r.tasksDone()).isEqualTo(7);
        assertThat(r.tasksTotal()).isEqualTo(7);
        assertThat(r.score()).isEqualTo(100);
    }
}
