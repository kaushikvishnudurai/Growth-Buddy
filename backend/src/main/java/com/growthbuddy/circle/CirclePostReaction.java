package com.growthbuddy.circle;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One member's kudos on a circle post. The key IS (post, user), so a second
 * kudos from the same person cannot exist — toggling deletes the row instead
 * ({@code CircleService.toggleKudos}).
 */
@Entity
@Table(name = "circle_post_reactions", indexes = {
        @Index(name = "ix_circle_post_reaction_user", columnList = "user_id")
})
@IdClass(CirclePostReaction.Key.class)
@Getter
@Setter
@NoArgsConstructor
public class CirclePostReaction {

    @Id
    @Column(name = "post_id")
    private UUID postId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    /** Composite key holder for {@link CirclePostReaction}. */
    @Getter
    @Setter
    @NoArgsConstructor
    public static class Key implements Serializable {
        private UUID postId;
        private UUID userId;

        public Key(UUID postId, UUID userId) {
            this.postId = postId;
            this.userId = userId;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            if (!(o instanceof Key key)) {
                return false;
            }
            return Objects.equals(postId, key.postId) && Objects.equals(userId, key.userId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(postId, userId);
        }
    }
}
