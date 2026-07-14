package com.growthbuddy.task;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "task_completion_history", indexes = {
        @Index(name = "ix_task_hist_user_task_time", columnList = "user_id, task_id, changed_at")
})
@Getter
@Setter
@NoArgsConstructor
public class TaskHistory {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "task_id", nullable = false)
    private UUID taskId;

    @Column(name = "changed_at", nullable = false)
    private Instant changedAt;

    @Column(name = "priority", nullable = false, length = 8)
    private String priority;

    @Column(name = "due_at")
    private Instant dueAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (changedAt == null) {
            changedAt = Instant.now();
        }
    }
}