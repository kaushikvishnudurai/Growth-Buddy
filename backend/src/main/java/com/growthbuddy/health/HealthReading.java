package com.growthbuddy.health;

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
 * One health reading: typed by hand (source 'manual', any number per day) or a
 * phone daily total / latest value (source 'phone', one per user + type + day,
 * upserted by {@link HealthReadingService#sync}).
 */
@Entity
@Table(name = "health_readings", indexes = {
    @Index(name = "ix_health_user_day", columnList = "user_id, day"),
    @Index(name = "ix_health_user_type_day", columnList = "user_id, type, day")
})
@Getter
@Setter
@NoArgsConstructor
public class HealthReading {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 24)
    private String type;

    @Column(nullable = false)
    private double value;

    /** Diastolic, for bloodPressure only. */
    private Double value2;

    /** The user's local day. */
    @Column(nullable = false)
    private LocalDate day;

    @Column(name = "measured_at")
    private Instant measuredAt;

    @Column(nullable = false, length = 8)
    private String source = HealthReadingService.MANUAL;

    @Column(length = 280)
    private String note;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

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
