package com.growthbuddy.weekly;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One weekly review a user saved: wins + a single focus, keyed by ISO week start. */
@Entity
@Table(name = "weekly_reviews",
        uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "week_start"}))
@Getter
@Setter
@NoArgsConstructor
public class WeeklyReview {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "week_start", nullable = false)
    private LocalDate weekStart;

    @Column(name = "wins", columnDefinition = "TEXT")
    private String wins;

    @Column(name = "focus", length = 255)
    private String focus;

    @Column(name = "saved_at", nullable = false)
    private Instant savedAt;

    @PrePersist
    @PreUpdate
    void stamp() {
        if (id == null) id = UUID.randomUUID();
        savedAt = Instant.now();
    }
}
