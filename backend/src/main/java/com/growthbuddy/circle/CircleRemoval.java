package com.growthbuddy.circle;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Someone an owner removed. A public circle has no code to rotate, so without
 * this row the removed member re-joined from Browse with one tap.
 */
@Entity
@Table(name = "circle_removals", indexes = {
        @Index(name = "ix_circle_removal_user", columnList = "user_id")
})
@IdClass(CircleMember.Key.class)
@Getter
@Setter
@NoArgsConstructor
public class CircleRemoval {

    @Id
    @Column(name = "circle_id")
    private UUID circleId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "removed_at", nullable = false, updatable = false)
    private Instant removedAt;

    @PrePersist
    void prePersist() {
        if (removedAt == null) {
            removedAt = Instant.now();
        }
    }
}
