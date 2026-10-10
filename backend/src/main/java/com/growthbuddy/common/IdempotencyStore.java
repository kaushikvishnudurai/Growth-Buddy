package com.growthbuddy.common;

import java.util.UUID;

/**
 * Where {@link IdempotencyInterceptor} keeps the answer to each keyed write.
 *
 * <p>Same seam as {@link ThrottleStore}: {@code JdbcIdempotencyStore} is the only
 * implementation that ships (the table is shared, so a retry that lands on a
 * different instance still finds the first answer); the interface exists so the
 * replay rules are testable without a database.
 */
public interface IdempotencyStore {

    enum Kind {
        /** No row existed (or a stale in-progress one was taken over): run the handler. */
        RESERVED,
        /** The first request finished; send its answer again. */
        REPLAY,
        /** The first request is still running. */
        IN_PROGRESS,
        /** The key was first used for a different method or path. */
        MISMATCH
    }

    record Outcome(Kind kind, int status, String contentType, String body) {
        static final Outcome RESERVED = new Outcome(Kind.RESERVED, 0, null, null);
        static final Outcome IN_PROGRESS = new Outcome(Kind.IN_PROGRESS, 0, null, null);
        static final Outcome MISMATCH = new Outcome(Kind.MISMATCH, 0, null, null);

        static Outcome replay(int status, String contentType, String body) {
            return new Outcome(Kind.REPLAY, status, contentType, body);
        }
    }

    /**
     * Claim {@code key} for this user, atomically against other instances, or say
     * why not. An in-progress row older than {@code staleMs} is taken over: the
     * instance that reserved it died mid-request, and a key stuck "in progress"
     * for 48h would turn every retry into a 409.
     */
    Outcome reserve(UUID userId, String key, String method, String path, long staleMs);

    /** The handler finished with an answer worth replaying. */
    void complete(UUID userId, String key, int status, String contentType, String body);

    /** Forget the reservation (a 5xx, a throw, an answer too big to keep): a retry runs again. */
    void release(UUID userId, String key);
}
