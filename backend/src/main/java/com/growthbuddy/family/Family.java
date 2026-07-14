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

/**
 * A household / family group. Multiple registered accounts can resolve into the
 * same family (the "shared family graph"): a user belongs to the family whose
 * {@link FamilyMember} row has {@code linkedUserId} equal to their id.
 */
@Entity
@Table(name = "families", indexes = {
        @Index(name = "ix_family_owner", columnList = "owner_user_id")
})
@Getter
@Setter
@NoArgsConstructor
public class Family {

    @Id
    private UUID id;

    /** The account that created the family and manages membership. */
    @Column(name = "owner_user_id", nullable = false)
    private UUID ownerUserId;

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
