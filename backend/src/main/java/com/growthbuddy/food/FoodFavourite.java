package com.growthbuddy.food;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A starred food: a copy of one entry's name, portion and figures, re-logged from
 * the "Log food" chips as typed calories (no estimate). A copy, not a link, so
 * deleting or editing the entry it came from leaves the favourite as it was.
 */
@Entity
@Table(name = "food_favourites", indexes = @Index(name = "ix_food_fav_user", columnList = "user_id"))
@Getter
@Setter
@NoArgsConstructor
public class FoodFavourite {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "food_name", nullable = false, length = 255)
    private String foodName;

    @Column(name = "quantity_grams", nullable = false)
    private int quantityGrams;

    @Column(name = "kcal", nullable = false)
    private int kcal;

    @Column(name = "protein_g")
    private Integer proteinG;

    @Column(name = "carbs_g")
    private Integer carbsG;

    @Column(name = "fat_g")
    private Integer fatG;

    @Column(name = "fiber_g")
    private Integer fiberG;

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
