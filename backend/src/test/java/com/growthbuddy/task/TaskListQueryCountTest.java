package com.growthbuddy.task;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.goal.GoalService;
import com.growthbuddy.user.ProgressService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** GET /api/tasks reads every task's history stats in one grouped query, not one per task. */
class TaskListQueryCountTest {

    private static final UUID USER = UUID.randomUUID();

    private final TaskRepository repo = mock(TaskRepository.class);
    private final TaskHistoryRepository history = mock(TaskHistoryRepository.class);
    private final TaskService service =
            new TaskService(repo, history, mock(ProgressService.class), mock(GoalService.class));

    @Test
    void fortyTasksCostOneHistoryQuery() {
        List<Task> tasks = new ArrayList<>();
        for (int i = 0; i < 40; i++) {
            Task t = new Task();
            t.setId(UUID.randomUUID());
            t.setUserId(USER);
            t.setTitle("Task " + i);
            tasks.add(t);
        }
        Instant last = Instant.parse("2026-10-10T08:00:00Z");
        List<Object[]> rows = new ArrayList<>();
        rows.add(new Object[] {tasks.get(3).getId(), 2L, last});
        when(repo.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(USER)).thenReturn(tasks);
        when(history.summarize(eq(USER), anyCollection())).thenReturn(rows);

        List<TaskResponse> out = service.list(USER);

        verify(history, times(1)).summarize(eq(USER), anyCollection());
        verify(history, never()).findByUserIdAndTaskIdOrderByChangedAtDesc(any(), any());
        assertEquals(40, out.size());
        assertEquals(tasks.get(0).getId(), out.get(0).id());
        assertEquals(2L, out.get(3).completionCount());
        assertEquals(last, out.get(3).lastCompletedAt());
        assertEquals(0L, out.get(4).completionCount());
        assertNull(out.get(4).lastCompletedAt());
    }
}
