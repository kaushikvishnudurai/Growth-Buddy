package com.growthbuddy.health;

import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface HealthReadingRepository extends JpaRepository<HealthReading, UUID> {
    List<HealthReading> findByUserIdAndDayBetween(UUID userId, LocalDate start, LocalDate end);

    /** A locking read: sync decides insert-or-update on it, so it must see the latest rows. */
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    List<HealthReading> findByUserIdAndSourceAndDayBetween(UUID userId, String source, LocalDate start, LocalDate end);

    Optional<HealthReading> findByIdAndUserId(UUID id, UUID userId);

    /** The newest day with a reading of a type: the profile's weight follows that day. */
    Optional<HealthReading> findFirstByUserIdAndTypeOrderByDayDesc(UUID userId, String type);
}

/* ---- Requests (day defaults to the user's today) ---- */

record CreateHealthReadingRequest(
        String type,
        @NotNull Double value,
        Double value2,
        LocalDate day,
        Instant measuredAt,
        String note) {
}

/** Null = unchanged; note "" clears it. */
record UpdateHealthReadingRequest(
        Double value,
        Double value2,
        LocalDate day,
        Instant measuredAt,
        String note) {
}

record SyncItem(String type, LocalDate day, Double value, Double value2, Instant measuredAt, String note) {
}

record SyncRequest(List<SyncItem> readings) {
}

/* ---- Responses ---- */

record HealthReadingResponse(
        UUID id,
        String type,
        double value,
        Double value2,
        LocalDate day,
        Instant measuredAt,
        String source,
        String note,
        Instant createdAt) {

    static HealthReadingResponse of(HealthReading r) {
        return new HealthReadingResponse(r.getId(), r.getType(), r.getValue(), r.getValue2(), r.getDay(),
                r.getMeasuredAt(), r.getSource(), r.getNote(), r.getCreatedAt());
    }
}

/** {@code profileChanged}: the sync moved the profile's weight, so the app re-reads the user. */
record SyncResponse(int saved, int skipped, boolean profileChanged) {
    SyncResponse(int saved, int skipped) {
        this(saved, skipped, false);
    }
}
