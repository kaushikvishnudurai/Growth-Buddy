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
        Instant dueAt) {
}

/** Update body. Null fields are left unchanged. */
record UpdateTaskRequest(
        @Size(max = 255) String title,
        String notes,
        Priority priority,
        Instant dueAt,
        Boolean done) {
}

record TaskResponse(
        UUID id,
        String title,
        String notes,
        Priority priority,
        Instant dueAt,
        boolean done,
                Instant doneAt,
                long completionCount,
                Instant lastCompletedAt) {

        static TaskResponse from(Task t, long completionCount, Instant lastCompletedAt) {
        return new TaskResponse(t.getId(), t.getTitle(), t.getNotes(), t.getPriority(),
                                t.getDueAt(), t.isDone(), t.getDoneAt(), completionCount, lastCompletedAt);
    }
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
