package com.growthbuddy.family;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Learned preference signal: how often a dish has been accepted/cooked/favourited
 * by a family. Top-scoring dishes are fed back into future meal-plan prompts so
 * recommendations get more personal over time.
 */
@Entity
@Table(name = "family_dish_preferences",
        uniqueConstraints = @UniqueConstraint(name = "uq_family_dish", columnNames = {"family_id", "dish_name"}),
        indexes = { @Index(name = "ix_family_dish_family", columnList = "family_id") })
@Getter
@Setter
@NoArgsConstructor
public class FamilyDishPreference {

    @Id
    private UUID id;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    @Column(name = "dish_name", nullable = false, length = 160)
    private String dishName;

    @Column(nullable = false)
    private int score = 0;

    @Column(name = "last_seen", nullable = false)
    private Instant lastSeen;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (lastSeen == null) {
            lastSeen = Instant.now();
        }
    }
}
