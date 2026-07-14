package com.growthbuddy.water;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "water_entries", indexes = {
        @Index(name = "ix_water_entry_user_date", columnList = "user_id, log_date"),
        @Index(name = "ix_water_entry_user_time", columnList = "user_id, logged_at")
})
@Getter
@Setter
@NoArgsConstructor
public class WaterEntry {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "amount_ml", nullable = false)
    private int amountMl;

    @Column(length = 255)
    private String note;

    @Column(name = "logged_at", nullable = false)
    private Instant loggedAt;

    @Column(name = "log_date", nullable = false)
    private LocalDate logDate;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (loggedAt == null) {
            loggedAt = Instant.now();
        }
        if (logDate == null) {
            logDate = loggedAt.atZone(ZoneOffset.UTC).toLocalDate();
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
