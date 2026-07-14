package com.growthbuddy.family;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A multi-day (weekly / monthly) meal plan, optionally themed for an occasion
 * (normal / festival / fasting). The latest row per family is the current one.
 */
@Entity
@Table(name = "family_multi_day_plans", indexes = {
        @Index(name = "ix_family_multiday_family", columnList = "family_id, created_at")
})
@Getter
@Setter
@NoArgsConstructor
public class FamilyMultiDayPlan {

    @Id
    private UUID id;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(nullable = false)
    private int days;

    @Column(length = 16)
    private String occasion;

    @Column(name = "plan_json", nullable = false, columnDefinition = "TEXT")
    private String planJson;

    @Column(name = "generated_by_user_id", nullable = false)
    private UUID generatedByUserId;

    @Column(length = 24)
    private String source;

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
