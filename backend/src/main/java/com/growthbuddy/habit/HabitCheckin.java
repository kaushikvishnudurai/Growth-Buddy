package com.growthbuddy.habit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One check-in per habit per day; composite primary key (habit_id, log_date). */
@Entity
@Table(name = "habit_checkins", indexes = {
        @Index(name = "ix_habit_checkin_user_date", columnList = "user_id, log_date")
})
@IdClass(HabitCheckin.Key.class)
@Getter
@Setter
@NoArgsConstructor
public class HabitCheckin {

    @Id
    @Column(name = "habit_id")
    private UUID habitId;

    @Id
    @Column(name = "log_date")
    private LocalDate logDate;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    private boolean done = true;

    /**
     * A protected ("rest" / "freeze") day: not done, but bridges the streak gap
     * instead of breaking it. Costs one weekly freeze token to set.
     */
    @Column(name = "protected_day", nullable = false)
    private boolean protectedDay = false;

    /**
     * The habit's metric for this day — km, steps, whichever it measures. Null
     * for a plain habit, and null for a measured one ticked without a number:
     * the tick still counts for the streak, there is just nothing to plot.
     */
    @Column(name = "metric_value")
    private Double metricValue;

    /** Minutes it took, when the habit records both a distance and a duration. */
    @Column(name = "duration_min")
    private Integer durationMin;

    @Column(columnDefinition = "TEXT")
    private String note;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    /** Composite key holder for {@link HabitCheckin}. Mutable for JPA IdClass use. */
    @Getter
    @Setter
    @NoArgsConstructor
    public static class Key implements Serializable {
        private UUID habitId;
        private LocalDate logDate;

        public Key(UUID habitId, LocalDate logDate) {
            this.habitId = habitId;
            this.logDate = logDate;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            if (!(o instanceof Key key)) {
                return false;
            }
            return Objects.equals(habitId, key.habitId) && Objects.equals(logDate, key.logDate);
        }

        @Override
        public int hashCode() {
            return Objects.hash(habitId, logDate);
        }
    }
}
