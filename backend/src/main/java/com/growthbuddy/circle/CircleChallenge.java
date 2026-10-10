package com.growthbuddy.circle;

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
 * A time-boxed challenge for a circle. Members are ranked by {@link #metric}
 * (habit check-ins, focus minutes or water-goal days) during [startDate, endDate].
 * The start may be a future day — an upcoming challenge shows an empty board.
 */
@Entity
@Table(name = "circle_challenges", indexes = {
        @Index(name = "ix_circle_challenge_circle", columnList = "circle_id")
})
@Getter
@Setter
@NoArgsConstructor
public class CircleChallenge {

    @Id
    private UUID id;

    @Column(name = "circle_id", nullable = false)
    private UUID circleId;

    @Column(nullable = false, length = 120)
    private String title;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    @Column(name = "end_date", nullable = false)
    private LocalDate endDate;

    /**
     * What the board counts — a {@link ChallengeMetrics.Metric} name:
     * {@code habit_checkins} (every row from before the column),
     * {@code focus_minutes} or {@code water_days}.
     */
    @Column(nullable = false, length = 16)
    private String metric = "habit_checkins";

    @Column(name = "created_by", nullable = false)
    private UUID createdBy;

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
