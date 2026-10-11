package com.growthbuddy.task;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.goal.GoalService;
import com.growthbuddy.user.ProgressService;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

class TaskListTest {

    private static final UUID USER = UUID.randomUUID();
    private final TaskRepository repo = mock(TaskRepository.class);
    private final TaskHistoryRepository history = mock(TaskHistoryRepository.class);
    private final TaskService service = new TaskService(repo, history, mock(ProgressService.class),
            mock(GoalService.class));

    private static Task task() {
        Task t = new Task();
        t.setId(UUID.randomUUID());
        t.setUserId(USER);
        t.setTitle("t");
        t.setPriority(Priority.Low);
        return t;
    }

    /* CRB-5: a read-only transaction never flushed the overdue escalation. */
    @Test
    void listRunsReadWriteSoTheEscalationIsSaved() throws Exception {
        Transactional tx = TaskService.class.getMethod("list", UUID.class).getAnnotation(Transactional.class);
        assertThat(tx).isNotNull();
        assertThat(tx.readOnly()).isFalse();
    }

    /* CRB-6: one grouped history read for the whole list, not one per task. */
    @Test
    void listReadsHistoryOnceForAllTasks() {
        Task a = task();
        Task b = task();
        Task overdue = task();
        overdue.setDueAt(Instant.now().minusSeconds(3600));
        Instant last = Instant.parse("2026-10-01T09:00:00Z");
        when(repo.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(USER)).thenReturn(List.of(a, b, overdue));
        when(history.statsByTask(USER)).thenReturn(List.<Object[]>of(new Object[] {a.getId(), 3L, last}));

        List<TaskResponse> out = service.list(USER);

        verify(history, never()).findByUserIdAndTaskIdOrderByChangedAtDesc(any(), any());
        assertThat(out.get(0).completionCount()).isEqualTo(3);
        assertThat(out.get(0).lastCompletedAt()).isEqualTo(last);
        assertThat(out.get(1).completionCount()).isZero();
        assertThat(out.get(1).lastCompletedAt()).isNull();
        assertThat(out.get(2).priority()).isEqualTo(Priority.High);
    }
}
