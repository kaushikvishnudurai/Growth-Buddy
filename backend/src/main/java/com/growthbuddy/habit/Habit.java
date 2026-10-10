package com.growthbuddy.habit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@jakarta.persistence.EntityListeners(com.growthbuddy.common.DeliveryCache.Listener.class)
@Table(name = "habits", indexes = {
        @Index(name = "ix_habits_user", columnList = "user_id")
})
@Getter
@Setter
@NoArgsConstructor
public class Habit {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 120)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private HabitDomain domain = HabitDomain.habit;

    @Column(nullable = false, length = 64)
    private String icon;

    /** Optional accent color (hex or token name). Null = use domain default. */
    @Column(length = 16)
    private String color;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Cadence cadence = Cadence.daily;

    /** Optional time-of-day for a daily reminder. Null = no reminder. */
    @Column(name = "reminder_time")
    private LocalTime reminderTime;

    /** This habit's own notification tone — a chime key from the frontend's
     *  table, not a file. Null means "the user's default tone from Settings",
     *  mirroring {@code CalendarReminder.sound}. */
    @Column(length = 16)
    private String sound;

    @Column(name = "target_per_week", nullable = false)
    private int targetPerWeek = 7;

    /**
     * What ticking this habit records beyond "done" — distance, steps, minutes.
     * {@code none} is the plain tick every habit had before.
     */
    /*
     * columnDefinition is load-bearing. Left to itself, ddl-auto creates this as
     * enum('km','minutes','none','steps') with NO default — and MySQL's implicit
     * default for a NOT NULL enum is its FIRST member, so every habit that
     * existed before this column came out as "measures km". Spelling the column
     * out keeps dev identical to what migrations.sql gives prod.
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16,
            columnDefinition = "VARCHAR(16) NOT NULL DEFAULT 'none'")
    private HabitMetric metric = HabitMetric.none;

    @Column(nullable = false)
    private boolean active = true;

    /** The user's own position on the Habits screen; ties fall back to createdAt. */
    @Column(name = "sort_order", nullable = false,
            columnDefinition = "INT NOT NULL DEFAULT 0")
    private int sortOrder = 0;

    /**
     * build = tick it to do it; quit = "break a habit": clean unless a slip is
     * logged (for a quit habit, a check-in row with done = false and no freeze
     * is that day's slip). Spelled out for the same reason as {@code metric}.
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 8,
            columnDefinition = "VARCHAR(8) NOT NULL DEFAULT 'build'")
    private HabitKind kind = HabitKind.build;

    /**
     * A quit habit's clean days have been paid XP up to and including this day
     * (each once). Null on a build habit. Set to the day before creation when a
     * quit habit is made, so nothing before it is ever paid.
     */
    @Column(name = "clean_credited_through")
    private java.time.LocalDate cleanCreditedThrough;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

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
