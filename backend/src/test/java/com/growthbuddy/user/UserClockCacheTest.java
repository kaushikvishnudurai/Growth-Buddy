package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** zoneOf reads the user once, and a write to the user makes the next call read again. */
class UserClockCacheTest {

    @Test
    void cachesTheZoneUntilTheUserIsWritten() {
        UserRepository users = mock(UserRepository.class);
        UserClock clock = new UserClock(users);
        User u = new User();
        u.setId(UUID.randomUUID());
        u.setTimezone("Asia/Kolkata");
        when(users.findById(u.getId())).thenReturn(Optional.of(u));

        assertThat(clock.zoneOf(u.getId())).isEqualTo(ZoneId.of("Asia/Kolkata"));
        assertThat(clock.zoneOf(u.getId())).isEqualTo(ZoneId.of("Asia/Kolkata"));
        verify(users, times(1)).findById(u.getId());

        u.setTimezone("America/New_York");
        new UserClock.Forget().onChange(u);
        assertThat(clock.zoneOf(u.getId())).isEqualTo(ZoneId.of("America/New_York"));
        verify(users, times(2)).findById(u.getId());
    }

    @Test
    void aReadJustAfterAWriteIsServedButNotCached() {
        UserRepository users = mock(UserRepository.class);
        UserClock clock = new UserClock(users);
        User stale = new User();
        stale.setId(UUID.randomUUID());
        stale.setTimezone("Asia/Kolkata");
        // A request that loaded the user before the write committed still sees the old zone.
        when(users.findById(stale.getId())).thenReturn(Optional.of(stale));

        new UserClock.Forget().onChange(stale);
        assertThat(clock.zoneOf(stale.getId())).isEqualTo(ZoneId.of("Asia/Kolkata"));

        User fresh = new User();
        fresh.setId(stale.getId());
        fresh.setTimezone("America/Los_Angeles");
        when(users.findById(stale.getId())).thenReturn(Optional.of(fresh));
        assertThat(clock.zoneOf(stale.getId())).isEqualTo(ZoneId.of("America/Los_Angeles"));
        verify(users, times(2)).findById(stale.getId());
    }
}
