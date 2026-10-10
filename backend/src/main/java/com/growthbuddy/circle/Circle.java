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
@Table(name = "circles", indexes = {
        @Index(name = "ix_circles_created_by", columnList = "created_by")
})
@Getter
@Setter
@NoArgsConstructor
public class Circle {

    @Id
    private UUID id;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String goal;

    /**
     * The OWNER, despite the column name: ownership can be transferred
     * ({@code CircleService.transfer}) and handed on when the owner deletes their
     * account, and both rewrite this alongside the members' {@code role}.
     */
    @Column(name = "created_by", nullable = false)
    private UUID createdBy;

    /**
     * {@code public} (listed under Browse, anyone can join) or {@code private}
     * (unlisted; joining takes {@link #joinCode}).
     */
    @Column(nullable = false, length = 16)
    private String visibility = "public";

    /** Set only on private circles; shown to members so they can pass it on. */
    @Column(name = "join_code", length = 12)
    private String joinCode;

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
