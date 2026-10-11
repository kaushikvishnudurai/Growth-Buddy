package com.growthbuddy.health;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.UserClock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Manual health readings (CRUD) and the phone's per-day upsert. */
@Service
public class HealthReadingService {

    static final String MANUAL = "manual";
    static final String PHONE = "phone";
    static final int MAX_SYNC = 200;
    static final int MAX_DAYS_BACK = 400;
    static final int SYNC_DAYS = 14;
    private static final String PHONE_LOCKED = "Phone readings update from the phone";

    /** Inclusive {min, max} per type; mirrors HEALTH_METRICS in scripts/health-logic.js. */
    static final Map<String, double[]> LIMITS = Map.ofEntries(
            Map.entry("steps", new double[] {1, 100000}),
            Map.entry("distance", new double[] {0.1, 300}),
            Map.entry("calories", new double[] {1, 10000}),
            Map.entry("floors", new double[] {1, 1000}),
            Map.entry("workout", new double[] {1, 1440}),
            Map.entry("restingHeartRate", new double[] {20, 250}),
            Map.entry("bloodPressure", new double[] {40, 260}),
            Map.entry("oxygenSaturation", new double[] {50, 100}),
            Map.entry("heartRateVariability", new double[] {1, 300}),
            Map.entry("respiratoryRate", new double[] {4, 60}),
            Map.entry("weight", new double[] {2, 500}),
            Map.entry("bodyFat", new double[] {1, 75}),
            Map.entry("height", new double[] {40, 260}));
    /** Diastolic limits for bloodPressure's value2. */
    static final double[] DIASTOLIC = {20, 200};

    private final HealthReadingRepository readings;
    private final UserClock clock;

    public HealthReadingService(HealthReadingRepository readings, UserClock clock) {
        this.readings = readings;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<HealthReadingResponse> list(UUID userId, int days) {
        int span = Math.max(1, Math.min(MAX_DAYS_BACK, days));
        LocalDate end = clock.today(userId);
        return readings.findByUserIdAndDayBetween(userId, end.minusDays(span - 1L), end).stream()
                .sorted(Comparator.comparing(HealthReading::getDay)
                        .thenComparing(HealthReading::getMeasuredAt, Comparator.nullsFirst(Comparator.naturalOrder()))
                        .reversed())
                .map(HealthReadingResponse::of)
                .toList();
    }

    @Transactional
    public HealthReadingResponse create(UUID userId, CreateHealthReadingRequest req) {
        LocalDate today = clock.today(userId);
        LocalDate day = req.day() != null ? req.day() : today;
        checkManualDay(day, today);
        HealthReading r = new HealthReading();
        r.setUserId(userId);
        r.setSource(MANUAL);
        fill(r, req.type(), req.value(), req.value2(), day, req.measuredAt(), cleanNote(req.note()));
        return HealthReadingResponse.of(readings.save(r));
    }

    @Transactional
    public HealthReadingResponse update(UUID userId, UUID id, UpdateHealthReadingRequest req) {
        HealthReading r = ownManual(userId, id);
        LocalDate day = req.day() != null ? req.day() : r.getDay();
        if (req.day() != null) {
            checkManualDay(day, clock.today(userId));
        }
        fill(r, r.getType(),
                req.value() != null ? req.value() : r.getValue(),
                req.value2() != null ? req.value2() : r.getValue2(),
                day,
                req.measuredAt() != null ? req.measuredAt() : r.getMeasuredAt(),
                req.note() != null ? cleanNote(req.note()) : r.getNote());
        r.setUpdatedAt(Instant.now());
        return HealthReadingResponse.of(readings.save(r));
    }

    @Transactional
    public void delete(UUID userId, UUID id) {
        readings.delete(ownManual(userId, id));
    }

    /**
     * One phone row per (user, type, day): updated in place if there, else inserted.
     * Manual rows are never read or written here. An invalid item is skipped, not fatal.
     */
    @Transactional
    public SyncResponse sync(UUID userId, SyncRequest req) {
        List<SyncItem> items = req == null || req.readings() == null ? List.of() : req.readings();
        if (items.size() > MAX_SYNC) {
            throw ApiException.badRequest("At most " + MAX_SYNC + " readings per sync");
        }
        LocalDate today = clock.today(userId);
        LocalDate from = today.minusDays(SYNC_DAYS - 1L);
        LocalDate to = today.plusDays(1); // a phone ahead of the account's timezone
        Map<String, HealthReading> existing = new HashMap<>();
        for (HealthReading r : readings.findByUserIdAndSourceAndDayBetween(userId, PHONE, from, to)) {
            existing.putIfAbsent(r.getType() + "|" + r.getDay(), r);
        }
        int saved = 0;
        int skipped = 0;
        for (SyncItem it : items) {
            if (it == null || it.day() == null || it.day().isBefore(from) || it.day().isAfter(to)) {
                skipped++;
                continue;
            }
            String key = it.type() + "|" + it.day();
            HealthReading r = existing.get(key);
            HealthReading row = r != null ? r : new HealthReading();
            try {
                // Validate into a scratch row first so a bad item can't half-overwrite a good one.
                fill(new HealthReading(), it.type(), it.value(), it.value2(), it.day(), it.measuredAt(),
                        cleanNote(it.note()));
            } catch (ApiException e) {
                skipped++;
                continue;
            }
            row.setUserId(userId);
            row.setSource(PHONE);
            fill(row, it.type(), it.value(), it.value2(), it.day(), it.measuredAt(), cleanNote(it.note()));
            if (r != null) {
                row.setUpdatedAt(Instant.now());
            }
            existing.put(key, readings.save(row));
            saved++;
        }
        return new SyncResponse(saved, skipped);
    }

    /* ---- helpers ---- */

    private HealthReading ownManual(UUID userId, UUID id) {
        HealthReading r = readings.findByIdAndUserId(id, userId)
                .orElseThrow(() -> ApiException.notFound("that reading"));
        if (PHONE.equals(r.getSource())) {
            throw ApiException.badRequest(PHONE_LOCKED);
        }
        return r;
    }

    private static void checkManualDay(LocalDate day, LocalDate today) {
        if (day.isAfter(today)) {
            throw ApiException.badRequest("A reading can't be on a future day");
        }
        if (day.isBefore(today.minusDays(MAX_DAYS_BACK))) {
            throw ApiException.badRequest("A reading can be at most " + MAX_DAYS_BACK + " days old");
        }
    }

    /** Validates type, value and value2, then writes them onto {@code r}. */
    private static void fill(HealthReading r, String type, Double value, Double value2,
            LocalDate day, Instant measuredAt, String note) {
        double[] lim = type == null ? null : LIMITS.get(type);
        if (lim == null) {
            throw ApiException.badRequest("Unknown health reading type");
        }
        if (!within(value, lim)) {
            throw ApiException.badRequest(type + " must be between " + fmt(lim[0]) + " and " + fmt(lim[1]));
        }
        Double second = null;
        if ("bloodPressure".equals(type)) {
            if (!within(value2, DIASTOLIC)) {
                throw ApiException.badRequest("Diastolic must be between " + fmt(DIASTOLIC[0])
                        + " and " + fmt(DIASTOLIC[1]));
            }
            if (value2 >= value) {
                throw ApiException.badRequest("Diastolic must be lower than systolic");
            }
            second = value2;
        }
        r.setType(type);
        r.setValue(value);
        r.setValue2(second);
        r.setDay(day);
        r.setMeasuredAt(measuredAt);
        r.setNote(note);
    }

    private static boolean within(Double v, double[] lim) {
        return v != null && Double.isFinite(v) && v >= lim[0] && v <= lim[1];
    }

    private static String fmt(double d) {
        return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
    }

    /** Trimmed; blank is null; over 280 is a 400. */
    private static String cleanNote(String note) {
        if (note == null || note.isBlank()) {
            return null;
        }
        String t = note.trim();
        if (t.length() > 280) {
            throw ApiException.badRequest("A note can be at most 280 characters");
        }
        return t;
    }
}
