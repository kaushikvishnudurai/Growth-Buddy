package com.growthbuddy.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.growthbuddy.habit.HabitService;
import com.growthbuddy.task.TaskRepository;
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

    private ScoreService service() {
        return new ScoreService(tasks, habits, scores);
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
}
