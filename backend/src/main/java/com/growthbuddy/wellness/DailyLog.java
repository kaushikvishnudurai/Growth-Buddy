package com.growthbuddy.wellness;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One per (user, day). Holds the user-entered wellness check-ins (sleep + mood)
 * and a snapshot of the day's headline metrics (score / water / calories) used
 * by the Report trends and the insights engine. Every field is nullable — a row
 * may carry only sleep, only mood, only the metric snapshot, or any mix.
 */
@Entity
@Table(name = "daily_logs")
@IdClass(DailyLog.Key.class)
@Getter
@Setter
@NoArgsConstructor
public class DailyLog {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Id
    @Column(name = "log_date")
    private LocalDate logDate;

    // ---- Sleep ----
    @Column(length = 5)
    private String bedtime; // "HH:MM"

    @Column(name = "wake_time", length = 5)
    private String wakeTime;

    @Column(name = "sleep_quality", length = 16)
    private String sleepQuality; // low | okay | good | great

    @Column(name = "sleep_note", columnDefinition = "TEXT")
    private String sleepNote;

    // ---- Mood ----
    @Column(length = 16)
    private String mood; // low | okay | good | great

    @Column(length = 16)
    private String energy; // low | medium | high

    @Column(length = 16)
    private String stress; // calm | normal | high

    @Column(name = "mood_note", columnDefinition = "TEXT")
    private String moodNote;

    // ---- Daily metric snapshot (null until snapshotted that day) ----
    private Integer score;

    @Column(name = "water_ml")
    private Integer waterMl;

    @Column(name = "water_goal_ml")
    private Integer waterGoalMl;

    private Integer kcal;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }

    /** Composite key (user_id, log_date). */
    @Getter
    @Setter
    @NoArgsConstructor
    public static class Key implements Serializable {
        private UUID userId;
        private LocalDate logDate;

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            if (!(o instanceof Key key)) {
                return false;
            }
            return Objects.equals(userId, key.userId) && Objects.equals(logDate, key.logDate);
        }

        @Override
        public int hashCode() {
            return Objects.hash(userId, logDate);
        }
    }
}
