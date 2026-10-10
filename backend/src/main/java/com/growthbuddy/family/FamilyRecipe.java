package com.growthbuddy.family;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * The family's own recipe for a dish, keyed by {@code dish_key}
 * ({@link FamilyService#shoppingKey} of the name), so "Sambar" in Monday's
 * plan and "sambar " in Friday's share one recipe. {@code ingredients} is one
 * per line ("Toor dal: 200 g"); Build shopping list reads it before the
 * built-in DISH_INGREDIENTS map or the AI.
 */
@Entity
@Table(name = "family_recipes",
        uniqueConstraints = @UniqueConstraint(name = "uq_family_recipe", columnNames = {"family_id", "dish_key"}),
        indexes = { @Index(name = "ix_family_recipes_family", columnList = "family_id") })
@Getter
@Setter
@NoArgsConstructor
public class FamilyRecipe {

    @Id
    private UUID id;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    @Column(name = "dish_key", nullable = false, length = 160)
    private String dishKey;

    @Column(name = "dish_name", nullable = false, length = 160)
    private String dishName;

    @Column(columnDefinition = "TEXT")
    private String ingredients;

    @Column(columnDefinition = "TEXT")
    private String steps;

    @Column(name = "cook_minutes")
    private Integer cookMinutes;

    @Column(name = "updated_by_user_id", nullable = false)
    private UUID updatedByUserId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
