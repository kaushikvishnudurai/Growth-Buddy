package com.growthbuddy.common;

import jakarta.persistence.PostPersist;
import jakarta.persistence.PostRemove;
import jakarta.persistence.PostUpdate;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Supplier;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Lets the per-minute delivery schedulers keep their candidate list in memory
 * instead of re-reading every timed reminder and habit, and their users, from
 * the database 2,880 times a day (that read was most of the TiDB RU bill).
 *
 * <p>Every write to an entity a tick reads (reminder, habit, user) records the
 * owning user under a new version; a scheduler's next tick re-reads only those
 * users' rows and merges them into its {@link Snapshot}. One global counter used
 * to throw the whole snapshot away on any user's edit, so with real traffic it
 * reloaded every reminder in the system nearly every minute. A change with no
 * known owner ({@link #changed()}) still forces a full reload. The record
 * repeats after commit, because the listener fires at flush, before the row is
 * visible: a reload in between would miss it.
 *
 * <p>Bulk SQL bypasses the listener. Today that is only deletes (account
 * deletion, unverified-user cleanup), which can never make something newly due,
 * and the schedulers re-read due rows fresh before sending, so a deleted one is
 * dropped there. ponytail: a new bulk UPDATE/INSERT on users, calendar_reminders
 * or habits must call {@link #changed(UUID)}, or it waits for {@link #MAX_AGE}.
 */
public final class DeliveryCache {

    /** Safety net: a full reload at least this often even if nothing signalled a change. */
    public static final Duration MAX_AGE = Duration.ofMinutes(15);

    // Guarded by the class lock: a version and its map entry must appear together,
    // or a reader could take version v and miss the user changed at v.
    private static long version;
    private static long fullVersion;
    private static final Map<UUID, Long> USER_VERSION = new HashMap<>();
    private static final Map<UUID, Instant> USER_AT = new HashMap<>();

    private DeliveryCache() {}

    public static synchronized long version() {
        return version;
    }

    /** Something changed for this user (null: unknown owner, reload everything). */
    public static void changed(UUID userId) {
        record(userId);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    record(userId);
                }
            });
        }
    }

    /** A change whose owner isn't known: every snapshot reloads in full. */
    public static void changed() {
        changed(null);
    }

    private static synchronized void record(UUID userId) {
        version++;
        if (userId == null) {
            fullVersion = version;
            return;
        }
        Instant now = Instant.now();
        USER_VERSION.put(userId, version);
        USER_AT.put(userId, now);
        // Every live snapshot reloads in full within MAX_AGE, so an entry older
        // than twice that is past anyone's loaded version.
        if (USER_AT.size() > 1024) {
            Instant cut = now.minus(MAX_AGE.multipliedBy(2));
            USER_AT.entrySet().removeIf(e -> {
                boolean old = e.getValue().isBefore(cut);
                if (old) {
                    USER_VERSION.remove(e.getKey());
                }
                return old;
            });
        }
    }

    /** Users changed after {@code since}; null when a full reload is due instead. */
    static synchronized Set<UUID> changedSince(long since, long[] nowVersion) {
        nowVersion[0] = version;
        if (fullVersion > since) {
            return null;
        }
        Set<UUID> out = new HashSet<>();
        USER_VERSION.forEach((id, v) -> {
            if (v > since) {
                out.add(id);
            }
        });
        return out;
    }

    /**
     * A scheduler's in-memory candidate list plus its owners, refreshed per tick.
     * Only the scheduler thread touches one, and Spring never overlaps two runs
     * of one cron task.
     */
    public static final class Snapshot<T, U> {
        private final Function<T, UUID> owner;
        private List<T> items = List.of();
        private Map<UUID, U> users = Map.of();
        private long loadedVersion;
        private Instant fullAt;

        public Snapshot(Function<T, UUID> owner) {
            this.owner = owner;
        }

        public List<T> items() {
            return items;
        }

        public Map<UUID, U> users() {
            return users;
        }

        /**
         * Bring the snapshot up to date: a full read on first use, after MAX_AGE
         * or an ownerless change; otherwise only the changed users' rows.
         * {@code usersOf} maps the owners of a list (and leaves out the ones that
         * count as nobody, such as an account pending deletion).
         */
        public void refresh(Instant now, Supplier<List<T>> all, Function<Collection<UUID>, List<T>> forUsers,
                            Function<List<T>, Map<UUID, U>> usersOf) {
            long[] v = {version()}; // read before the load, so a change during it isn't lost
            Set<UUID> dirty = fullAt == null || now.isAfter(fullAt.plus(MAX_AGE))
                    ? null : changedSince(loadedVersion, v);
            if (dirty == null) {
                items = all.get();
                users = usersOf.apply(items);
                fullAt = now;
            } else if (!dirty.isEmpty()) {
                List<T> fresh = forUsers.apply(dirty);
                List<T> merged = new ArrayList<>(items.size() + fresh.size());
                for (T t : items) {
                    if (!dirty.contains(owner.apply(t))) {
                        merged.add(t);
                    }
                }
                merged.addAll(fresh);
                Map<UUID, U> mergedUsers = new HashMap<>(users);
                mergedUsers.keySet().removeAll(dirty);
                mergedUsers.putAll(usersOf.apply(fresh));
                items = merged;
                users = mergedUsers;
            }
            loadedVersion = v[0];
        }
    }

    /** JPA listener on every entity a delivery tick reads. */
    public static class Listener {
        @PostPersist
        @PostUpdate
        @PostRemove
        void onChange(Object entity) {
            changed(ownerOf(entity));
        }

        static UUID ownerOf(Object entity) {
            if (entity instanceof com.growthbuddy.user.User u) {
                return u.getId();
            }
            if (entity instanceof com.growthbuddy.habit.Habit h) {
                return h.getUserId();
            }
            if (entity instanceof com.growthbuddy.reminder.CalendarReminder r) {
                return r.getUserId();
            }
            return null;
        }
    }
}
