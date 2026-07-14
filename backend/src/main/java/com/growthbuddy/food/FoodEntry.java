package com.growthbuddy.food;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "food_entries", indexes = {
        @Index(name = "ix_food_entry_user_date", columnList = "user_id, log_date"),
        @Index(name = "ix_food_entry_user_time", columnList = "user_id, logged_at")
})
@Getter
@Setter
@NoArgsConstructor
public class FoodEntry {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "food_name", nullable = false, length = 255)
    private String foodName;

    @Column(name = "quantity_grams", nullable = false)
    private int quantityGrams;

    @Enumerated(EnumType.STRING)
    @Column(name = "meal_type", nullable = false, length = 12)
    private MealType mealType;

    @Column(name = "kcal_estimated", nullable = false)
    private int kcalEstimated;

    @Column(name = "kcal_per_100g", nullable = false)
    private int kcalPer100g;

    @Column(name = "estimate_source", nullable = false, length = 20)
    private String estimateSource;

    @Column(length = 255)
    private String note;

    @Column(name = "logged_at", nullable = false)
    private Instant loggedAt;

    @Column(name = "log_date", nullable = false)
    private LocalDate logDate;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (loggedAt == null) {
            loggedAt = Instant.now();
        }
        if (logDate == null) {
            logDate = loggedAt.atZone(ZoneOffset.UTC).toLocalDate();
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (mealType == null) {
            mealType = MealType.home;
        }
    }
}
