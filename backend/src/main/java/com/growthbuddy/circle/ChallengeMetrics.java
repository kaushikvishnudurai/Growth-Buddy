package com.growthbuddy.circle;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.UserZone;
import com.growthbuddy.water.WaterService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a circle challenge counts, per member, over [from, to] (local days).
 *
 * <ul>
 *   <li>{@code habit_checkins} — completed habit check-ins (HabitService; the original metric)</li>
 *   <li>{@code focus_minutes} — minutes of completed FOCUS sessions (breaks don't count)</li>
 *   <li>{@code water_days} — days the member reached their own water goal</li>
 * </ul>
 *
 * <p>Focus sessions are stored as instants, so each is bucketed into its
 * member's OWN local day: a 23:30 session in Chennai belongs to that day, not
 * to UTC's tomorrow. Water rows already carry the drinker's local date.
 */
@Component
public class ChallengeMetrics {

    public enum Metric {
        habit_checkins, focus_minutes, water_days;

        /** Absent → the original metric; anything unknown is refused rather than guessed. */
        static Metric parse(String raw) {
            if (raw == null || raw.isBlank()) {
                return habit_checkins;
            }
            try {
                return valueOf(raw.trim().toLowerCase(Locale.ROOT));
            } catch (IllegalArgumentException e) {
                throw ApiException.badRequest("Unknown challenge metric: " + raw);
            }
        }

        /** Stored rows predate the column or were written by a newer build: read leniently. */
        static Metric stored(String raw) {
            try {
                return raw == null ? habit_checkins : valueOf(raw);
            } catch (IllegalArgumentException e) {
                return habit_checkins;
            }
        }
    }

    /** Widest offset either side of UTC (Kiribati +14, Baker Island -12) — rounded up to 14. */
    private static final Duration ZONE_SLACK = Duration.ofHours(14);

    private final WaterService water;

    @PersistenceContext
    private EntityManager em;

    public ChallengeMetrics(WaterService water) {
        this.water = water;
    }

    /** Focus minutes per member, each session on its member's local day. */
    @Transactional(readOnly = true)
    public Map<UUID, Long> focusMinutes(Collection<UUID> ids, Map<UUID, ZoneId> zones,
                                        LocalDate from, LocalDate to) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        Instant a = from.atStartOfDay(ZoneOffset.UTC).toInstant().minus(ZONE_SLACK);
        Instant b = to.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().plus(ZONE_SLACK);
        List<Object[]> rows = em.createQuery(
                        "select s.userId, s.completedAt, s.durationSec from FocusSession s"
                                + " where s.userId in :ids and s.mode = 'focus'"
                                + " and s.completedAt >= :a and s.completedAt < :b", Object[].class)
                .setParameter("ids", ids)
                .setParameter("a", a)
                .setParameter("b", b)
                .getResultList();
        return sumFocusMinutes(rows, zones, from, to);
    }

    /** rows: [userId, completedAt, durationSec]. Seconds are summed first, then floored to minutes. */
    static Map<UUID, Long> sumFocusMinutes(List<Object[]> rows, Map<UUID, ZoneId> zones,
                                           LocalDate from, LocalDate to) {
        Map<UUID, Long> secs = new HashMap<>();
        for (Object[] r : rows) {
            UUID uid = (UUID) r[0];
            Instant at = (Instant) r[1];
            long sec = ((Number) r[2]).longValue();
            LocalDate day = at.atZone(zones.getOrDefault(uid, UserZone.FALLBACK)).toLocalDate();
            if (!day.isBefore(from) && !day.isAfter(to) && sec > 0) {
                secs.merge(uid, sec, Long::sum);
            }
        }
        Map<UUID, Long> out = new HashMap<>();
        secs.forEach((uid, s) -> out.put(uid, s / 60));
        return out;
    }

    /**
     * Days each member reached their own water goal.
     *
     * <p>ponytail: two small queries per member (their totals, their goal). A
     * circle's roster is small and the challenge list is capped; batch it with a
     * grouped query if circles ever get big.
     */
    @Transactional(readOnly = true)
    public Map<UUID, Long> waterGoalDays(Collection<UUID> ids, LocalDate from, LocalDate to) {
        Map<UUID, Long> out = new HashMap<>();
        for (UUID id : ids) {
            long days = goalDays(water.totalsByDay(id, from, to), water.goalMl(id));
            if (days > 0) {
                out.put(id, days);
            }
        }
        return out;
    }

    /** A day counts when its effective total reaches the goal (any water at all, with no usable goal). */
    static long goalDays(Map<LocalDate, Integer> totals, int goalMl) {
        return totals.values().stream()
                .filter(ml -> ml != null && (goalMl > 0 ? ml >= goalMl : ml > 0))
                .count();
    }
}
