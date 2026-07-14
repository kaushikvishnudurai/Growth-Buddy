package com.growthbuddy.circle;

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

@Entity
@Table(name = "circle_posts", indexes = {
        @Index(name = "ix_circle_post_circle_time", columnList = "circle_id, created_at"),
        @Index(name = "ix_circle_post_user", columnList = "user_id")
})
@Getter
@Setter
@NoArgsConstructor
public class CirclePost {

    @Id
    private UUID id;

    @Column(name = "circle_id", nullable = false)
    private UUID circleId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String body;

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
