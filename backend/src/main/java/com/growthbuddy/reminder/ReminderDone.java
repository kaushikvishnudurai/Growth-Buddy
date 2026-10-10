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
 * One occurrence of a reminder checked off. A done occurrence is not delivered
 * (the scheduler skips it) and its device alarm is not queued (push.js reads
 * {@code doneDates} off the list DTO). Per occurrence, not per reminder: ticking
 * off today's "Take vitamins" must not silence tomorrow's.
 */
@Entity
@Table(name = "reminder_done", indexes = {
        @Index(name = "ux_reminder_done", columnList = "reminder_id, occurrence_date", unique = true),
        @Index(name = "ix_reminder_done_user", columnList = "user_id, occurrence_date")
})
@Getter
@Setter
@NoArgsConstructor
public class ReminderDone {

    @Id
    private UUID id;

    @Column(name = "reminder_id", nullable = false)
    private UUID reminderId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "occurrence_date", nullable = false)
    private LocalDate occurrenceDate;

    @Column(name = "done_at", nullable = false)
    private Instant doneAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (doneAt == null) {
            doneAt = Instant.now();
        }
    }
}
