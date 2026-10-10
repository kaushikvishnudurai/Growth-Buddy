package com.growthbuddy.task;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

/** Create body. Only {@code title} is required. */
record CreateTaskRequest(
        @NotBlank @Size(max = 255) String title,
        String notes,
        Priority priority,
        Instant dueAt,
        /** One of the user's own goals, or null for none. */
        UUID goalId) {
}

/** Update body. Null fields are left unchanged. */
record UpdateTaskRequest(
        @Size(max = 255) String title,
        String notes,
        Priority priority,
        Instant dueAt,
        /**
         * Remove the due date. A null {@code dueAt} already means "leave it
         * alone" here, like every other field in this record, so there was no
         * way to say "make it empty" — clearing the field in the edit dialog
         * saved with the old date still on it, silently.
         */
        Boolean clearDueAt,
        Boolean done,
        Boolean paused,
        /** Move the task to this goal (the user's own). Null = unchanged. */
        UUID goalId,
        /** Take the task off its goal; the same reason as {@code clearDueAt}. */
        Boolean clearGoal) {
}

record TaskResponse(
        UUID id,
        String title,
        String notes,
        Priority priority,
        Instant dueAt,
        boolean done,
        boolean paused,
                Instant doneAt,
                long completionCount,
                Instant lastCompletedAt,
                int pushCount,
                UUID goalId) {

        static TaskResponse from(Task t, long completionCount, Instant lastCompletedAt) {
        return new TaskResponse(t.getId(), t.getTitle(), t.getNotes(), t.getPriority(),
                                t.getDueAt(), t.isDone(), t.isPaused(), t.getDoneAt(), completionCount, lastCompletedAt,
                                t.getPushCount(), t.getGoalId());
    }
}

/** A task that was ticked off, for Insights' "how long do they take". */
record FinishedTask(Priority priority, Instant createdAt, Instant doneAt) {
}

record TaskHistoryResponse(
                UUID id,
                Instant changedAt,
                Priority priority,
                Instant dueAt) {

        static TaskHistoryResponse from(TaskHistory h) {
                Priority p = Priority.valueOf(h.getPriority());
                return new TaskHistoryResponse(h.getId(), h.getChangedAt(), p, h.getDueAt());
        }
}
