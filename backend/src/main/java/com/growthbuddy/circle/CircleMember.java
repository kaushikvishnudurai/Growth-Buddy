package com.growthbuddy.circle;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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

@Entity
@Table(name = "circle_members", indexes = {
        @Index(name = "ix_circle_member_user", columnList = "user_id")
})
@IdClass(CircleMember.Key.class)
@Getter
@Setter
@NoArgsConstructor
public class CircleMember {

    public enum Role {
        owner, member
    }

    @Id
    @Column(name = "circle_id")
    private UUID circleId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Role role = Role.member;

    @Column(name = "joined_at", nullable = false, updatable = false)
    private Instant joinedAt;

    @PrePersist
    void prePersist() {
        if (joinedAt == null) {
            joinedAt = Instant.now();
        }
    }

    /** Composite key holder for {@link CircleMember}. */
    @Getter
    @Setter
    @NoArgsConstructor
    public static class Key implements Serializable {
        private UUID circleId;
        private UUID userId;

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            if (!(o instanceof Key key)) {
                return false;
            }
            return Objects.equals(circleId, key.circleId) && Objects.equals(userId, key.userId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(circleId, userId);
        }
    }
}
