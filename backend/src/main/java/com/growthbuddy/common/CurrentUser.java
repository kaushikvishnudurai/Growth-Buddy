package com.growthbuddy.common;

import java.util.UUID;

/**
 * Holds the current request's user id in a ThreadLocal.
 *
 * <p>Populated by {@link CurrentUserInterceptor} from the validated
 * {@code Authorization: Bearer <token>} session — never from a client-supplied
 * header. Do NOT reintroduce header-based identity (e.g. {@code X-User-Id}): it
 * lets any client spoof another user by guessing their id.
 */
public final class CurrentUser {

    private static final ThreadLocal<UUID> HOLDER = new ThreadLocal<>();

    private CurrentUser() {
    }

    public static void set(UUID userId) {
        HOLDER.set(userId);
    }

    public static UUID id() {
        UUID id = HOLDER.get();
        if (id == null) {
            throw new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED, "No current user");
        }
        return id;
    }

    public static void clear() {
        HOLDER.remove();
    }
}
