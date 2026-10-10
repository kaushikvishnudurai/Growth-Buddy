package com.growthbuddy.common;

import jakarta.persistence.PostPersist;
import jakarta.persistence.PostRemove;
import jakarta.persistence.PostUpdate;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Lets the per-minute delivery schedulers keep their candidate list in memory
 * instead of re-reading every timed reminder and habit, and their users, from
 * the database 2,880 times a day (that read was most of the TiDB RU bill).
 *
 * <p>Every write to an entity a tick reads (reminder, habit, user) bumps one
 * counter; a scheduler reloads on its next tick when the counter moved, so a
 * reminder created or edited is seen exactly when the old per-tick query would
 * have seen it. The bump repeats after commit, because the listener fires at
 * flush, before the row is visible: a reload in between would miss it.
 *
 * <p>Bulk SQL bypasses the listener. Today that is only deletes (account
 * deletion, unverified-user cleanup), which can never make something newly due,
 * and the schedulers re-read due rows fresh before sending, so a deleted one is
 * dropped there. ponytail: a new bulk UPDATE/INSERT on users, calendar_reminders
 * or habits must call {@link #changed()}, or it waits for {@link #MAX_AGE}.
 */
public final class DeliveryCache {

    /** Safety net: reload at least this often even if nothing signalled a change. */
    public static final Duration MAX_AGE = Duration.ofMinutes(15);

    private static final AtomicLong VERSION = new AtomicLong();

    private DeliveryCache() {}

    public static long version() {
        return VERSION.get();
    }

    /** Is a snapshot loaded at {@code loadedVersion} / {@code loadedAt} out of date? */
    public static boolean stale(long loadedVersion, Instant loadedAt, Instant now) {
        return loadedAt == null || loadedVersion != VERSION.get()
                || now.isAfter(loadedAt.plus(MAX_AGE));
    }

    public static void changed() {
        VERSION.incrementAndGet();
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    VERSION.incrementAndGet();
                }
            });
        }
    }

    /** JPA listener on every entity a delivery tick reads. */
    public static class Listener {
        @PostPersist
        @PostUpdate
        @PostRemove
        void onChange(Object entity) {
            changed();
        }
    }
}
