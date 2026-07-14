package com.growthbuddy.family;

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
 * A generated meal plan for a family. The latest row per family is the
 * "current" plan, reloaded when the Family tab opens. Stored as JSON text so
 * the structured AI output (meals + nutrition summary + suggestions) and the
 * groceries it was based on round-trip without a rigid column schema.
 */
@Entity
@Table(name = "family_meal_plans", indexes = {
        @Index(name = "ix_family_meal_plan_family", columnList = "family_id, created_at")
})
@Getter
@Setter
@NoArgsConstructor
public class FamilyMealPlan {

    @Id
    private UUID id;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    @Column(name = "plan_json", nullable = false, columnDefinition = "TEXT")
    private String planJson;

    @Column(name = "grocery_items_json", columnDefinition = "TEXT")
    private String groceryItemsJson;

    @Column(name = "generated_by_user_id", nullable = false)
    private UUID generatedByUserId;

    @Column(name = "source", length = 24)
    private String source;

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
