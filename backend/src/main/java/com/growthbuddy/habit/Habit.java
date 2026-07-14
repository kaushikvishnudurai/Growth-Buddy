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

    @Column(name = "target_per_week", nullable = false)
    private int targetPerWeek = 7;

    @Column(nullable = false)
    private boolean active = true;

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
