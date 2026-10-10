package com.growthbuddy.task;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.goal.GoalService;
import com.growthbuddy.user.ProgressService;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * A task can sit on a goal, but only on one of its owner's goals: the id comes
 * from the client, so someone else's goal id must be refused, on create and on
 * every edit, and refused the way a missing goal is.
 */
class TaskGoalLinkTest {

    private static final UUID USER = UUID.randomUUID();
    private static final UUID MY_GOAL = UUID.randomUUID();
    private static final UUID THEIR_GOAL = UUID.randomUUID();

    private final TaskRepository repo = mock(TaskRepository.class);
    private final TaskHistoryRepository history = mock(TaskHistoryRepository.class);
    private final ProgressService progress = mock(ProgressService.class);
    private final GoalService goals = mock(GoalService.class);
    private final TaskService service = new TaskService(repo, history, progress, goals);

    @BeforeEach
    void setUp() {
        when(goals.ownsGoal(USER, MY_GOAL)).thenReturn(true);
        when(goals.ownsGoal(USER, THEIR_GOAL)).thenReturn(false);
        when(repo.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private Task existing(UUID goalId) {
        Task t = new Task();
        t.setId(UUID.randomUUID());
        t.setUserId(USER);
        t.setTitle("Book the venue");
        t.setGoalId(goalId);
        when(repo.findByIdAndUserIdAndDeletedAtIsNull(t.getId(), USER)).thenReturn(Optional.of(t));
        return t;
    }

    private static UpdateTaskRequest goalChange(UUID goalId, Boolean clearGoal) {
        return new UpdateTaskRequest(null, null, null, null, null, null, null, goalId, clearGoal);
    }

    @Test
    void aNewTaskCanGoOnTheUsersOwnGoal() {
        TaskResponse r = service.create(USER, new CreateTaskRequest("Book the venue", null, null, null, MY_GOAL));
        assertThat(r.goalId()).isEqualTo(MY_GOAL);
    }

    @Test
    void aNewTaskOnSomeoneElsesGoalIsRefusedAndNotSaved() {
        assertThatThrownBy(() -> service.create(USER,
                new CreateTaskRequest("Book the venue", null, null, null, THEIR_GOAL)))
                .isInstanceOf(ApiException.class);
        verify(repo, never()).save(any());
    }

    @Test
    void aNewTaskWithNoGoalAsksNothing() {
        TaskResponse r = service.create(USER, new CreateTaskRequest("Book the venue", null, null, null, null));
        assertThat(r.goalId()).isNull();
        verify(goals, never()).ownsGoal(any(), any());
    }

    @Test
    void anEditCannotMoveATaskOntoSomeoneElsesGoal() {
        Task t = existing(MY_GOAL);
        assertThatThrownBy(() -> service.update(USER, t.getId(), goalChange(THEIR_GOAL, null)))
                .isInstanceOf(ApiException.class);
        assertThat(t.getGoalId()).isEqualTo(MY_GOAL);
    }

    @Test
    void anEditLeavesTheGoalAloneUnlessAsked() {
        Task t = existing(MY_GOAL);
        assertThat(service.update(USER, t.getId(), goalChange(null, null)).goalId()).isEqualTo(MY_GOAL);
        assertThat(service.update(USER, t.getId(), goalChange(null, true)).goalId()).isNull();
    }

    @Test
    void deletingATaskTakesItOffItsGoal() {
        Task t = existing(MY_GOAL);
        service.delete(USER, t.getId());
        assertThat(t.getGoalId()).isNull();
        assertThat(t.getDeletedAt()).isNotNull();
    }
}
