package com.growthbuddy.reminder;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A user-created calendar reminder with an optional color tag and recurrence.
 *
 * <p>This backs the calendar feature in the frontend. Recurrence is expanded on
 * read (see {@link ReminderService#occursOn}); a single row can therefore surface
 * on many days. Scoped deletes are modeled with {@code fromDate} / {@code untilDate}
 * bounds and a set of {@code skipDays} (single-occurrence removals).
 */
@Entity
@Table(name = "calendar_reminders", indexes = {
        @Index(name = "ix_cal_rem_user_date", columnList = "user_id, anchor_date")
})
@Getter
@Setter
@NoArgsConstructor
public class CalendarReminder {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 255)
    private String text;

    /** The day the reminder was created for / first occurs (recurrence anchor). */
    @Column(name = "anchor_date", nullable = false)
    private LocalDate anchorDate;

    /** Optional time-of-day; null when no time was given. */
    @Column(name = "time_of_day")
    private LocalTime time;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ReminderTag tag = ReminderTag.personal;

    @Enumerated(EnumType.STRING)
    @Column(name = "repeat_freq", nullable = false, length = 16)
    private RepeatFreq repeat = RepeatFreq.none;

    /** Lower bound for occurrences (used by "delete all before"). */
    @Column(name = "from_date")
    private LocalDate fromDate;

    /** Upper bound for occurrences (used by "delete this & future"). */
    @Column(name = "until_date")
    private LocalDate untilDate;

    /** Individual days removed from the series ("delete only this day"). */
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "calendar_reminder_skips",
            joinColumns = @JoinColumn(name = "reminder_id"))
    @Column(name = "skip_date", nullable = false)
    private Set<LocalDate> skipDays = new HashSet<>();

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
