package com.growthbuddy.task;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.goal.GoalService;
import com.growthbuddy.user.ProgressService;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** A task pays XP on its first completion only: tick / untick / tick must not farm it. */
class TaskXpOnceTest {

    private static final UUID USER = UUID.randomUUID();

    private final TaskRepository repo = mock(TaskRepository.class);
    private final TaskHistoryRepository history = mock(TaskHistoryRepository.class);
    private final ProgressService progress = mock(ProgressService.class);
    private final TaskService service = new TaskService(repo, history, progress, mock(GoalService.class));

    @Test
    void toggleLoopAwardsXpOnce() {
        Task t = new Task();
        t.setId(UUID.randomUUID());
        t.setUserId(USER);
        t.setTitle("Book the venue");
        when(repo.findByIdAndUserIdAndDeletedAtIsNull(t.getId(), USER)).thenReturn(Optional.of(t));
        when(repo.save(any(Task.class))).thenAnswer(inv -> inv.getArgument(0));
        AtomicLong rows = new AtomicLong();
        when(history.countByUserIdAndTaskId(USER, t.getId())).thenAnswer(inv -> rows.get());
        when(history.save(any(TaskHistory.class))).thenAnswer(inv -> {
            rows.incrementAndGet();
            return inv.getArgument(0);
        });

        for (int i = 0; i < 5; i++) {
            service.toggle(USER, t.getId()); // done
            service.toggle(USER, t.getId()); // undone
        }
        // And through update's done flag too.
        service.update(USER, t.getId(), new UpdateTaskRequest(null, null, null, null, null, true, null, null, null));

        verify(progress, times(1)).awardTaskCompletion(USER);
    }
}
