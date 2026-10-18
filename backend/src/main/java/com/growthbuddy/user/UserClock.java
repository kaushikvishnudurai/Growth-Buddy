package com.growthbuddy.user;

import com.growthbuddy.common.UserZone;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Answers "what day is it for this user?" — the only sanctioned source of today for
 * anything a user sees dated: habit check-ins and streaks, the daily score, wellness
 * logs, water totals.
 *
 * <p>Takes the user id explicitly rather than reading {@code CurrentUser}, because the
 * schedulers (digest, reminders) reach these same services outside any request and
 * would otherwise blow up with "no current user".
 *
 * <p>Resolve today <em>once</em> per operation and pass it down. Calling this in a loop
 * costs a lookup each time, and a request that straddles midnight would compute
 * different rows against different days.
 */
@Component
public class UserClock {

    private final UserRepository users;

    public UserClock(UserRepository users) {
        this.users = users;
    }

    /**
     * Zones already looked up. Asked on nearly every dated request (often more than
     * once), and each miss loads the whole user row. {@link Forget} drops an entry
     * the moment the user is written on this instance; the TTL bounds how long
     * another instance can lag behind a timezone change.
     */
    private record CachedZone(ZoneId zone, long atMs) {}

    private static final java.util.Map<UUID, CachedZone> ZONES = new java.util.concurrent.ConcurrentHashMap<>();
    static final long ZONE_TTL_MS = 10 * 60_000L;

    /** The user's zone; UTC when the user is unknown or has nothing usable stored. */
    public ZoneId zoneOf(UUID userId) {
        if (userId == null) {
            return UserZone.FALLBACK;
        }
        long now = System.currentTimeMillis();
        CachedZone c = ZONES.get(userId);
        if (c != null && now - c.atMs() < ZONE_TTL_MS) {
            return c.zone();
        }
        ZoneId zone = users.findById(userId)
                .map(User::getTimezone)
                .map(UserZone::of)
                .orElse(UserZone.FALLBACK);
        if (ZONES.size() > 50_000) {
            ZONES.clear(); // ponytail: crude bound, an LRU if the user count ever nears it
        }
        ZONES.put(userId, new CachedZone(zone, now));
        return zone;
    }

    /**
     * JPA listener on {@link User}: forget its cached zone. Again after commit, because
     * the listener fires at flush and a read before commit would cache the old zone.
     */
    public static class Forget {
        @jakarta.persistence.PostPersist
        @jakarta.persistence.PostUpdate
        @jakarta.persistence.PostRemove
        void onChange(User u) {
            UUID id = u.getId();
            ZONES.remove(id);
            if (org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
                org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                        new org.springframework.transaction.support.TransactionSynchronization() {
                            @Override
                            public void afterCommit() {
                                ZONES.remove(id);
                            }
                        });
            }
        }
    }

    /** The user's ui_prefs (null when unknown): what OnBreak reads, alongside today. */
    public java.util.Map<String, Object> prefsOf(UUID userId) {
        return userId == null ? null : users.findById(userId).map(User::getUiPrefs).orElse(null);
    }

    /** The calendar day it currently is where this user lives. */
    public LocalDate today(UUID userId) {
        return LocalDate.now(zoneOf(userId));
    }
}
