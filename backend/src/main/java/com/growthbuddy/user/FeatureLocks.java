package com.growthbuddy.user;

import com.growthbuddy.common.ApiException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Features an operator has switched off, for one account or for everyone
 * ({@code feature_locks}, {@code user_id = '*'}). A lock beats the user's own
 * switch in {@code users.feature_prefs}: {@link #effective} reports the feature
 * as off, so every client {@code featureOn} gate and server reader hides it, and
 * {@code FeatureLockInterceptor} refuses writes to its API.
 *
 * <p>Plain JDBC, no entity, like {@code idempotency_keys}. The whole table is held
 * in memory and re-read every 30 s, so another instance's change lands within that.
 * ponytail: static snapshot, because {@code AuthUserResponse.from} is static and
 * called from everywhere; a bean lookup per response if this ever needs mocking.
 */
@Component
public class FeatureLocks {

    private static final Logger log = LoggerFactory.getLogger(FeatureLocks.class);

    /** The lock row's user_id meaning every account. */
    static final String EVERYONE = "*";

    /** The client's FEATURE_DEFS keys; a lock on anything else would hide nothing. */
    public static final Set<String> FEATURES = Set.of("report", "habits", "food", "water", "health", "goals",
            "notes", "money", "focus", "calendar", "mentor", "circle", "family");

    public record Lock(String feature, String userId, String reason) {}

    private record Snapshot(Set<String> everyone, Map<String, Set<String>> perUser) {}

    private static volatile Snapshot snapshot = new Snapshot(Set.of(), Map.of());

    private final JdbcTemplate jdbc;

    public FeatureLocks(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Locked feature keys for this user (global locks included), sorted. */
    public static Set<String> lockedFor(UUID userId) {
        Snapshot s = snapshot;
        Set<String> out = new TreeSet<>(s.everyone());
        if (userId != null) {
            out.addAll(s.perUser().getOrDefault(userId.toString(), Set.of()));
        }
        return out;
    }

    public static boolean isLocked(UUID userId, String feature) {
        Snapshot s = snapshot;
        return s.everyone().contains(feature)
                || (userId != null && s.perUser().getOrDefault(userId.toString(), Set.of()).contains(feature));
    }

    /** For a route with no signed-in user (a push's Done link, a webhook): 403 when the owner's feature is locked. */
    public static void refuseIfLocked(UUID userId, String feature) {
        if (isLocked(userId, feature)) {
            throw ApiException.forbidden("This feature is turned off for your account.");
        }
    }

    /** The user's own switches with every locked feature forced to false. Never null. */
    public static Map<String, Boolean> effective(UUID userId, Map<String, Boolean> prefs) {
        Map<String, Boolean> out = prefs == null ? new HashMap<>() : new HashMap<>(prefs);
        lockedFor(userId).forEach(f -> out.put(f, false));
        return out;
    }

    public static Map<String, Boolean> effective(User user) {
        return effective(user.getId(), user.getFeaturePrefs());
    }

    /** True when the user hasn't switched it off and no lock covers it (the client's featureOn). */
    public static boolean on(User user, String feature) {
        Map<String, Boolean> prefs = user.getFeaturePrefs();
        return !isLocked(user.getId(), feature) && (prefs == null || !Boolean.FALSE.equals(prefs.get(feature)));
    }

    // Once the app is ready (after DataSeeder has created the table), then every 30 s.
    @EventListener(ApplicationReadyEvent.class)
    @Scheduled(initialDelay = 30_000, fixedDelay = 30_000)
    public void reload() {
        try {
            snapshot = build(jdbc.query("SELECT feature, user_id, reason FROM feature_locks",
                    (rs, i) -> new Lock(rs.getString(1), rs.getString(2), rs.getString(3))));
        } catch (RuntimeException e) {
            // Table not migrated yet (prod is ddl-auto: none): keep the last snapshot, lock nothing new.
            log.warn("feature_locks unreadable, keeping {} cached locks: {}", count(snapshot), e.getMessage());
        }
    }

    static Snapshot build(List<Lock> rows) {
        Set<String> everyone = new HashSet<>();
        Map<String, Set<String>> perUser = new HashMap<>();
        for (Lock l : rows) {
            if (EVERYONE.equals(l.userId())) {
                everyone.add(l.feature());
            } else {
                perUser.computeIfAbsent(l.userId(), k -> new HashSet<>()).add(l.feature());
            }
        }
        return new Snapshot(everyone, perUser);
    }

    /** For tests: replace the snapshot directly. */
    public static void use(List<Lock> rows) {
        snapshot = build(rows);
    }

    private static int count(Snapshot s) {
        return s.everyone().size() + s.perUser().values().stream().mapToInt(Set::size).sum();
    }

    public List<Lock> list() {
        return jdbc.query("SELECT feature, user_id, reason FROM feature_locks ORDER BY feature, user_id",
                (rs, i) -> new Lock(rs.getString(1), rs.getString(2), rs.getString(3)));
    }

    /** userId null = everyone. Re-locking replaces the reason. */
    public void lock(String feature, UUID userId, String reason) {
        String who = userId == null ? EVERYONE : userId.toString();
        jdbc.update("INSERT INTO feature_locks (feature, user_id, reason, created_at) VALUES (?, ?, ?, NOW(6)) "
                + "ON DUPLICATE KEY UPDATE reason = VALUES(reason)", feature, who, reason);
        reload();
    }

    /** userId null = the everyone lock only; a per-account lock stays. True when a row went. */
    public boolean unlock(String feature, UUID userId) {
        String who = userId == null ? EVERYONE : userId.toString();
        int n = jdbc.update("DELETE FROM feature_locks WHERE feature = ? AND user_id = ?", feature, who);
        reload();
        return n > 0;
    }
}
