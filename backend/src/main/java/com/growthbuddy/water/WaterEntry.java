package com.growthbuddy.water;

import com.growthbuddy.common.UserZone;
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

@Entity
// Only (user_id, log_date) is queried; the day's rows are then sorted by
// logged_at in memory. A (user_id, logged_at) index was dead weight on insert.
@Table(name = "water_entries", indexes = @Index(name = "ix_water_entry_user_date", columnList = "user_id, log_date"))
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
            // Defensive only: WaterService always sets logDate from the drinker's own zone
            // (UserClock), because an entity can't know whose day this belongs to. UTC to
            // match UserZone.FALLBACK, so the two never disagree.
            logDate = loggedAt.atZone(UserZone.FALLBACK).toLocalDate();
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
