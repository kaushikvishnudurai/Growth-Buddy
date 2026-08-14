package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.UserZone;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * {@link UserClock} resolves each user's own zone. The day-arithmetic itself is
 * covered by {@code UserZoneTest} against fixed instants; here we pin the lookup and
 * its fallbacks, which is where a wrong answer would silently reach streaks.
 */
class UserClockTest {

    private final UserRepository users = mock(UserRepository.class);
    private final UserClock clock = new UserClock(users);

    private UUID userWithZone(String timezone) {
        UUID id = UUID.randomUUID();
        User u = new User();
        u.setTimezone(timezone);
        when(users.findById(id)).thenReturn(Optional.of(u));
        return id;
    }

    @Test
    void resolvesTheUsersStoredZone() {
        assertThat(clock.zoneOf(userWithZone("Asia/Kolkata"))).isEqualTo(ZoneId.of("Asia/Kolkata"));
        assertThat(clock.zoneOf(userWithZone("America/New_York")))
                .isEqualTo(ZoneId.of("America/New_York"));
    }

    @Test
    void twoUsersInDifferentZonesCanBeOnDifferentDays() {
        LocalDate inKolkata = clock.today(userWithZone("Asia/Kolkata"));
        LocalDate inHonolulu = clock.today(userWithZone("Pacific/Honolulu"));
        // Kolkata is +05:30, Honolulu -10:00: never behind, and ahead for most of the day.
        assertThat(inKolkata).isAfterOrEqualTo(inHonolulu);
        assertThat(java.time.temporal.ChronoUnit.DAYS.between(inHonolulu, inKolkata))
                .isBetween(0L, 1L);
    }

    @Test
    void todayMatchesTheZoneItResolved() {
        UUID id = userWithZone("Asia/Kolkata");
        assertThat(clock.today(id)).isEqualTo(LocalDate.now(ZoneId.of("Asia/Kolkata")));
    }

    @Test
    void unknownUserFallsBackToUtcRatherThanThrowing() {
        UUID ghost = UUID.randomUUID();
        when(users.findById(ghost)).thenReturn(Optional.empty());

        assertThat(clock.zoneOf(ghost)).isEqualTo(UserZone.FALLBACK);
        assertThat(clock.today(ghost)).isEqualTo(LocalDate.now(UserZone.FALLBACK));
    }

    @Test
    void nullUserIdShortCircuitsWithoutQuerying() {
        assertThat(clock.zoneOf(null)).isEqualTo(UserZone.FALLBACK);
        verifyNoInteractions(users);
    }

    @Test
    void garbageStoredZoneFallsBackToUtc() {
        // A user row edited by hand, or a client that sent something odd.
        assertThat(clock.zoneOf(userWithZone("Mars/Olympus"))).isEqualTo(UserZone.FALLBACK);
        assertThat(clock.zoneOf(userWithZone(null))).isEqualTo(UserZone.FALLBACK);
        assertThat(clock.zoneOf(userWithZone(""))).isEqualTo(UserZone.FALLBACK);
    }
}
