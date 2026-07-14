package com.growthbuddy.family;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
 * A person within a {@link Family}. May be unmapped (a profile created by the
 * owner for a relative without an account) or mapped to a registered user via
 * {@code linkedUserId}. The food-profile list fields are stored as JSON-text
 * columns and (de)serialized in the service so mapping never loses data.
 */
@Entity
@Table(name = "family_members", indexes = {
        @Index(name = "ix_family_member_family", columnList = "family_id"),
        @Index(name = "ix_family_member_linked", columnList = "linked_user_id")
})
@Getter
@Setter
@NoArgsConstructor
public class FamilyMember {

    @Id
    private UUID id;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    /** Set when this member is mapped to a registered account; null when unmapped. */
    @Column(name = "linked_user_id")
    private UUID linkedUserId;

    @Column(nullable = false, length = 120)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Relationship relationship;

    @Column(name = "dob")
    private LocalDate dob;

    @Column(length = 20)
    private String gender;

    @Column(name = "height_cm")
    private Integer heightCm;

    @Column(name = "weight_kg")
    private Integer weightKg;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 12)
    private MemberStatus status = MemberStatus.unmapped;

    /**
     * True when this row was created solely to invite a registered account
     * (no pre-existing profile). Declining such an invite deletes the row,
     * rather than leaving an orphan unmapped profile behind.
     */
    @Column(name = "invite_only", nullable = false)
    private boolean inviteOnly = false;

    // --- Food profile (JSON-text columns) ---

    @Column(name = "favourite_dishes", columnDefinition = "TEXT")
    private String favouriteDishes;

    @Column(name = "favourite_ingredients", columnDefinition = "TEXT")
    private String favouriteIngredients;

    @Column(name = "diet_preference", length = 32)
    private String dietPreference;

    @Column(name = "allergies", columnDefinition = "TEXT")
    private String allergies;

    @Column(name = "ingredients_to_avoid", columnDefinition = "TEXT")
    private String ingredientsToAvoid;

    @Column(name = "medical_conditions", columnDefinition = "TEXT")
    private String medicalConditions;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Soft delete: non-null when the member has been removed from the family. */
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
        if (status == null) {
            status = MemberStatus.unmapped;
        }
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
