package com.growthbuddy.goal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.task.TaskRepository;
import com.growthbuddy.user.UserClock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class GoalServiceTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 10);
    private static final UUID USER = UUID.randomUUID();
    private static final ObjectMapper JSON = new ObjectMapper();

    private final GoalRepository goals = mock(GoalRepository.class);
    private final GoalActionRepository actions = mock(GoalActionRepository.class);
    private final UserClock clock = mock(UserClock.class);
    private final TaskRepository tasks = mock(TaskRepository.class);
    private final GoalService service = new GoalService(goals, actions, clock, tasks);

    @BeforeEach
    void setUp() {
        when(clock.today(USER)).thenReturn(TODAY);
    }

    private static Goal goal() {
        Goal g = new Goal();
        g.setId(UUID.randomUUID());
        g.setUserId(USER);
        g.setTitle("Run a 10k");
        g.setHorizon(GoalHorizon.short_term);
        return g;
    }

    @Test
    void anActionCanBeDatedTodayOrEarlierButNotTomorrow() {
        assertThat(service.pastOrToday(USER, TODAY)).isEqualTo(TODAY);
        assertThat(service.pastOrToday(USER, TODAY.minusDays(3))).isEqualTo(TODAY.minusDays(3));
        assertThat(service.pastOrToday(USER, null)).isNull();
        assertThatThrownBy(() -> service.pastOrToday(USER, TODAY.plusDays(1)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void anActionFromAnotherGoalIsNotFound() {
        UUID goalA = UUID.randomUUID();
        GoalAction onB = new GoalAction();
        onB.setId(UUID.randomUUID());
        onB.setGoalId(UUID.randomUUID());
        onB.setUserId(USER);
        when(actions.findByIdAndUserId(onB.getId(), USER)).thenReturn(Optional.of(onB));
        assertThatThrownBy(() -> service.requireAction(USER, goalA, onB.getId()))
                .isInstanceOf(ApiException.class);
        assertThat(service.requireAction(USER, onB.getGoalId(), onB.getId())).isSameAs(onB);
    }

    @Test
    void toggleStampsAndClearsCompletedAt() {
        Goal g = goal();
        Instant now = Instant.parse("2026-10-10T08:00:00Z");
        GoalService.applyToggle(g, now);
        assertThat(g.isCompleted()).isTrue();
        assertThat(g.getCompletedAt()).isEqualTo(now);
        GoalService.applyToggle(g, now.plusSeconds(60));
        assertThat(g.isCompleted()).isFalse();
        assertThat(g.getCompletedAt()).isNull();
    }

    @Test
    void progressMustBeAnObjectOfBoundedSize() throws Exception {
        assertThat(GoalService.progressJson(null)).isNull();
        assertThat(GoalService.progressJson(JSON.readTree("{\"durationDays\":50}")))
                .isEqualTo("{\"durationDays\":50}");
        assertThatThrownBy(() -> GoalService.progressJson(JSON.readTree("[1,2,3]")))
                .isInstanceOf(ApiException.class);
        ObjectNode huge = JSON.createObjectNode();
        huge.put("pad", "x".repeat(GoalService.MAX_PROGRESS_BYTES));
        assertThatThrownBy(() -> GoalService.progressJson(huge)).isInstanceOf(ApiException.class);
    }

    @Test
    void listCountsActionsInOneQueryAndNeverLoadsTheFullHistory() {
        Goal g = goal();
        when(goals.findByUserIdOrderByCreatedAtDesc(USER)).thenReturn(List.of(g));
        when(actions.countByGoalIds(anyCollection())).thenReturn(List.<Object[]>of(new Object[] {g.getId(), 7L}));
        GoalAction latest = new GoalAction();
        latest.setId(UUID.randomUUID());
        latest.setGoalId(g.getId());
        latest.setNote("Ran 5k");
        latest.setCreatedAt(Instant.parse("2026-10-09T07:00:00Z"));
        when(actions.findTop3ByGoalIdOrderByCreatedAtDesc(g.getId())).thenReturn(List.of(latest));

        GoalResponse r = service.list(USER).get(0).goals().get(0);
        assertThat(r.actionCount()).isEqualTo(7);
        assertThat(r.latestActionAt()).isEqualTo(latest.getCreatedAt());
        verify(actions, never()).findByGoalIdOrderByCreatedAtDesc(any());
        verify(actions, never()).countByGoalId(any());
    }

    @Test
    void updateChangesOnlyWhatWasSentAndClearsTheDateOnlyWhenAsked() {
        Goal g = goal();
        g.setDescription("for health");
        g.setTargetDate(TODAY.plusDays(30));
        when(goals.findByIdAndUserId(g.getId(), USER)).thenReturn(Optional.of(g));
        when(goals.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.update(USER, g.getId(), new UpdateGoalRequest("Run a half", null, null, null, null));
        assertThat(g.getTitle()).isEqualTo("Run a half");
        assertThat(g.getDescription()).isEqualTo("for health");
        assertThat(g.getTargetDate()).isEqualTo(TODAY.plusDays(30));

        service.update(USER, g.getId(), new UpdateGoalRequest(null, "", GoalHorizon.mid_term, null, true));
        assertThat(g.getDescription()).isNull();
        assertThat(g.getHorizon()).isEqualTo(GoalHorizon.mid_term);
        assertThat(g.getTargetDate()).isNull();

        assertThatThrownBy(() -> service.update(USER, g.getId(),
                new UpdateGoalRequest("  ", null, null, null, null))).isInstanceOf(ApiException.class);
    }

    @Test
    void deletingAGoalTakesItsTasksOffIt() {
        Goal g = goal();
        when(goals.findByIdAndUserId(g.getId(), USER)).thenReturn(Optional.of(g));
        service.delete(USER, g.getId());
        verify(tasks).clearGoal(USER, g.getId());
        verify(goals).delete(g);
    }

    @Test
    void deletingSomeoneElsesGoalClearsNoTasks() {
        UUID other = UUID.randomUUID();
        when(goals.findByIdAndUserId(other, USER)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.delete(USER, other)).isInstanceOf(ApiException.class);
        verify(tasks, never()).clearGoal(any(), any());
    }

    @Test
    void onlyTheUsersOwnGoalCanTakeATask() {
        UUID mine = UUID.randomUUID();
        UUID theirs = UUID.randomUUID();
        when(goals.existsByIdAndUserId(mine, USER)).thenReturn(true);
        when(goals.existsByIdAndUserId(theirs, USER)).thenReturn(false);
        assertThat(service.ownsGoal(USER, mine)).isTrue();
        assertThat(service.ownsGoal(USER, theirs)).isFalse();
        assertThat(service.ownsGoal(USER, null)).isFalse();
    }

    @Test
    void aGoalCarriesItsSweptFinishedTaskCount() {
        Goal g = goal();
        when(goals.findByIdAndUserId(g.getId(), USER)).thenReturn(Optional.of(g));
        when(goals.save(g)).thenReturn(g);
        when(tasks.countClearedByGoalIds(USER, List.of(g.getId())))
                .thenReturn(List.<Object[]>of(new Object[] {g.getId(), 2L}));
        assertThat(service.toggleComplete(USER, g.getId()).clearedTaskCount()).isEqualTo(2);
    }
}
