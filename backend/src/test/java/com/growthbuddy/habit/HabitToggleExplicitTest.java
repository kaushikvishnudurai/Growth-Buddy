package com.growthbuddy.habit;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.user.ProgressService;
import com.growthbuddy.user.UserClock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * HOS-6: a stale tab still showing the habit unticked taps "done". The flip
 * unticked it (and could cost a streak); an explicit done=true is idempotent.
 */
class HabitToggleExplicitTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 7);
    private static final UUID USER = UUID.randomUUID();

    private final HabitRepository habits = mock(HabitRepository.class);
    private final HabitCheckinRepository checkins = mock(HabitCheckinRepository.class);

    @Test
    void doneTrueOnAHabitAlreadyDoneTodayChangesNothing() {
        UserClock clock = mock(UserClock.class);
        HabitService svc = new HabitService(habits, checkins, mock(HabitStreakRepository.class),
                mock(StreakFreezeWalletRepository.class), mock(ProgressService.class), clock);
        when(clock.today(USER)).thenReturn(TODAY);
        when(clock.zoneOf(USER)).thenReturn(ZoneId.of("UTC"));
        Habit h = new Habit();
        h.setId(UUID.randomUUID());
        h.setUserId(USER);
        h.setName("Read 20 pages");
        h.setIcon("repeat");
        h.setKind(HabitKind.build);
        h.setCreatedAt(TODAY.minusDays(3).atStartOfDay(ZoneOffset.UTC).toInstant());
        when(habits.findByIdAndUserIdAndDeletedAtIsNull(h.getId(), USER)).thenReturn(Optional.of(h));
        when(checkins.existsByHabitIdAndLogDateAndDoneTrue(h.getId(), TODAY)).thenReturn(true);

        svc.toggleToday(USER, h.getId(), true);
        verify(checkins, never()).save(any());
        verify(checkins, never()).delete(any());
    }
}
