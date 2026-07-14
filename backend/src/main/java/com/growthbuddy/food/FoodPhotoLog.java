package com.growthbuddy.food;

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

/** A lightweight log of past food-photo analyses (the "recent scans" list). */
@Entity
@Table(name = "food_photo_logs", indexes = {
        @Index(name = "ix_food_photo_user_time", columnList = "user_id, created_at")
})
@Getter
@Setter
@NoArgsConstructor
public class FoodPhotoLog {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "log_date", nullable = false)
    private LocalDate logDate;

    @Column(name = "food_name", nullable = false, length = 255)
    private String foodName;

    @Column(name = "meal_type", length = 32)
    private String mealType;

    /** Detection confidence 0–100, null when unknown. */
    private Integer confidence;

    @Column(name = "fallback_needed", nullable = false)
    private boolean fallbackNeeded = false;

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
