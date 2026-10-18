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
}
