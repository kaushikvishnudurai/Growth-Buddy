package com.growthbuddy.family;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** A line on the family's shopping list, with an optional estimated cost. */
@Entity
@Table(name = "family_shopping_items", indexes = {
        @Index(name = "ix_family_shopping_family", columnList = "family_id, created_at")
})
@Getter
@Setter
@NoArgsConstructor
public class FamilyShoppingItem {

    @Id
    private UUID id;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(length = 60)
    private String quantity;

    /** Estimated cost in INR; null when unknown. */
    @Column(name = "estimated_cost")
    private Integer estimatedCost;

    @Column(nullable = false)
    private boolean checked = false;

    @Column(name = "created_by_user_id", nullable = false)
    private UUID createdByUserId;

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
