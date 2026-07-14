package com.growthbuddy.reminder;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Records a WhatsApp send attempt for one reminder occurrence date so we don't
 * send duplicate reminders during repeated scheduler runs.
 */
@Entity
@Table(name = "reminder_dispatch_log", indexes = {
        @Index(name = "ux_rem_dispatch_unique", columnList = "reminder_id, occurrence_date", unique = true)
})
@Getter
@Setter
@NoArgsConstructor
public class ReminderDispatchLog {

    @Id
    private UUID id;

    @Column(name = "reminder_id", nullable = false)
    private UUID reminderId;

    @Column(name = "occurrence_date", nullable = false)
    private LocalDate occurrenceDate;

    @Column(name = "channel", nullable = false, length = 16)
    private String channel;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "error_message", length = 255)
    private String errorMessage;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
