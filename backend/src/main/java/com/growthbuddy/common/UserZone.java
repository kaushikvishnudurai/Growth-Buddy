package com.growthbuddy.common;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * Resolves a stored timezone string into a usable {@link ZoneId}, and with it the
 * calendar day a user is actually living in.
 *
 * <p>Why this exists: "today" is not a property of the server. A habit checked in at
 * 1am in Kolkata belongs to that user's today, not to whatever day it happens to be
 * in the JVM's default zone — and a container defaulting to UTC would file it under
 * yesterday and break the streak. Every day-boundary decision therefore goes through
 * a user's own zone, the same field the reminder and digest schedulers already use.
 *
 * <p>Falls back to UTC rather than {@code ZoneId.systemDefault()} on purpose: the
 * fallback has to be deterministic across machines, and UTC matches the column
 * default on {@code users.timezone} and {@code AuthService.resolveTimezone}.
 */
public final class UserZone {

    /** Used when a user has no usable timezone stored. */
    public static final ZoneId FALLBACK = ZoneId.of("UTC");

    private UserZone() {
    }

    /** Parse a stored zone id; never throws, never returns null. */
    public static ZoneId of(String timezone) {
        if (timezone == null || timezone.isBlank()) {
            return FALLBACK;
        }
        try {
            return ZoneId.of(timezone.trim());
        } catch (RuntimeException ex) {
            // A stale or hand-edited value must not take an endpoint down.
            return FALLBACK;
        }
    }

    /** The calendar day it is right now for someone in {@code timezone}. */
    public static LocalDate today(String timezone) {
        return today(timezone, Instant.now());
    }

    /** The calendar day {@code at} falls on for someone in {@code timezone}. */
    public static LocalDate today(String timezone, Instant at) {
        return at.atZone(of(timezone)).toLocalDate();
    }
}
