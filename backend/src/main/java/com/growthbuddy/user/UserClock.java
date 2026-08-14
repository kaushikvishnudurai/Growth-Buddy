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

    /** The user's zone; UTC when the user is unknown or has nothing usable stored. */
    public ZoneId zoneOf(UUID userId) {
        if (userId == null) {
            return UserZone.FALLBACK;
        }
        return users.findById(userId)
                .map(User::getTimezone)
                .map(UserZone::of)
                .orElse(UserZone.FALLBACK);
    }

    /** The calendar day it currently is where this user lives. */
    public LocalDate today(UUID userId) {
        return LocalDate.now(zoneOf(userId));
    }
}
