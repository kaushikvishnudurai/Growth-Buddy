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
@jakarta.persistence.EntityListeners(com.growthbuddy.common.DeliveryCache.Listener.class)
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

    /** Optional end of a time block ("Meeting 15:00-16:00"); null for a point reminder. */
    @Column(name = "end_time_of_day")
    private LocalTime endTime;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ReminderTag tag = ReminderTag.personal;

    @Enumerated(EnumType.STRING)
    @Column(name = "repeat_freq", nullable = false, length = 16)
    private RepeatFreq repeat = RepeatFreq.none;

    /*
     * The richer rule, read by ReminderService.occursOn and scripts/recurrence.js
     * alike (recurrence.cases.json holds both to it). Each is only meaningful for
     * some repeats and ReminderService.normalizeRule clears it everywhere else.
     */

    /** Every N days/weeks/months/years; 1 = every. Ignored by {@code weekdays}. */
    @Column(name = "repeat_interval", nullable = false)
    private int repeatInterval = 1;

    /** A weekly reminder's days, "MO,WE,FR"; null = the anchor's weekday. */
    @Column(name = "repeat_days", length = 32)
    private String repeatDays;

    /** Monthly on the nth (1..5, -1 = last) anchor-weekday instead of the date; null = by date. */
    @Column(name = "repeat_nth")
    private Integer repeatNth;

    /** End after this many occurrences of the rule, counted from the anchor; null = no count. */
    @Column(name = "repeat_count")
    private Integer repeatCount;

    /** Free-text details under the title; null = none. */
    @Column(length = 1000)
    private String notes;

    /**
     * A second alert, minutes ahead of {@link #time}; null = none. Unlike
     * {@link #notifyBefore} it has no default to fall back on.
     */
    @Column(name = "notify_before2")
    private Integer notifyBefore2;

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

    /**
     * This reminder's own notification tone — a chime key from the frontend's
     * table, not a file. Null means "whatever tone the user has set in Settings",
     * which is what every reminder made before this column existed wants.
     */
    @Column(length = 16)
    private String sound;

    /**
     * Minutes ahead of {@link #time} to notify. Null means the user's default
     * ({@code ui_prefs.reminderLead}, see {@link ReminderPrefs}), so a reminder
     * nobody tuned keeps following that setting when it changes.
     */
    @Column(name = "notify_before")
    private Integer notifyBefore;

    /**
     * When a snoozed reminder rings again; null when it isn't snoozed. One per
     * reminder: snoozing again moves it. The scheduler clears it as it delivers.
     */
    @Column(name = "snoozed_until")
    private Instant snoozedUntil;

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
