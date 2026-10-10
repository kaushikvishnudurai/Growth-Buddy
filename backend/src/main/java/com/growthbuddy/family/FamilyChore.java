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

/**
 * A household chore, optionally given to one member. Owned by the family
 * (deleted with it — AuthService.FAMILY_OWNED_TABLES), not by whoever made it.
 *
 * <p>{@code repeat_rule} is none | daily | weekly ("repeat" is a MySQL
 * reserved word). A repeating chore is "done" only for the current day/week:
 * {@code done_at} is kept and compared against the viewer's today
 * ({@link FamilyService#choreDone}), so it comes back on its own.
 */
@Entity
@Table(name = "family_chores", indexes = {
        @Index(name = "ix_family_chores_family", columnList = "family_id, created_at")
})
@Getter
@Setter
@NoArgsConstructor
public class FamilyChore {

    @Id
    private UUID id;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    @Column(nullable = false, length = 120)
    private String title;

    /** A family_members row (mapped or not); null = anyone. */
    @Column(name = "assignee_member_id")
    private UUID assigneeMemberId;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @Column(name = "repeat_rule", nullable = false, length = 8)
    private String repeatRule = "none";

    @Column(name = "done_at")
    private Instant doneAt;

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
