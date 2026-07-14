package com.growthbuddy.family;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** A grocery the family has on hand. Covers pantry inventory, expiry tracking and leftovers. */
@Entity
@Table(name = "family_pantry_items", indexes = {
        @Index(name = "ix_family_pantry_family", columnList = "family_id")
})
@Getter
@Setter
@NoArgsConstructor
public class FamilyPantryItem {

    @Id
    private UUID id;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(length = 32)
    private String category;

    @Column(length = 60)
    private String quantity;

    @Column(name = "expiry_date")
    private LocalDate expiryDate;

    @Column(name = "is_leftover", nullable = false)
    private boolean leftover = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

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
