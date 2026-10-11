package com.growthbuddy.habit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.user.ProgressService;
import com.growthbuddy.user.UserClock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * A rest (freeze) day the user then ticks: the freeze bought nothing, so the
 * token comes back (never past the cap) and the protection goes. The refund
 * makes protect free, so XP must still pay once per day however the day is
 * ticked, unticked and protected in between.
 */
class HabitFreezeRefundTest {

    private static final ZoneId UTC = ZoneId.of("UTC");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 7); // a Wednesday
    private static final UUID USER = UUID.randomUUID();

    private final HabitRepository habits = mock(HabitRepository.class);
    private final HabitCheckinRepository checkins = mock(HabitCheckinRepository.class);
    private final StreakFreezeWalletRepository wallets = mock(StreakFreezeWalletRepository.class);
    private final ProgressService progress = mock(ProgressService.class);
    private final UserClock clock = mock(UserClock.class);
    private final HabitService service = new HabitService(habits, checkins, mock(HabitStreakRepository.class),
            wallets, progress, clock);

    private Habit habit;
    private StreakFreezeWallet wallet;
    private HabitCheckin[] row = {null};

    @BeforeEach
    void setUp() {
        when(clock.today(USER)).thenReturn(TODAY);
        when(clock.zoneOf(USER)).thenReturn(UTC);
        habit = new Habit();
        habit.setId(UUID.randomUUID());
        habit.setUserId(USER);
        habit.setName("Read");
        habit.setIcon("book");
        habit.setCreatedAt(TODAY.minusDays(5).atStartOfDay(ZoneOffset.UTC).toInstant());
        when(habits.findByIdAndUserIdAndDeletedAtIsNull(habit.getId(), USER)).thenReturn(Optional.of(habit));
        wallet = new StreakFreezeWallet();
        wallet.setUserId(USER);
        wallet.setTokens(1);
        wallet.setWeekAnchor(LocalDate.of(2026, 10, 5)); // this ISO week: no top-up
        when(wallets.findById(USER)).thenReturn(Optional.of(wallet));
        // One day's row, as the database would keep it.
        when(checkins.findByHabitIdAndLogDate(habit.getId(), TODAY)).thenAnswer(i -> Optional.ofNullable(row[0]));
        when(checkins.save(any())).thenAnswer(i -> row[0] = i.getArgument(0));
    }

    private void tick(boolean done) {
        service.checkin(USER, habit.getId(), new CheckinRequest(TODAY, done, null, null, null));
    }

    @Test
    void tickingARestDayRefundsTheTokenAndClearsTheProtection() {
        service.protect(USER, habit.getId(), TODAY);
        assertThat(wallet.getTokens()).isZero();
        tick(true);
        assertThat(wallet.getTokens()).isEqualTo(1);
        assertThat(row[0].isProtectedDay()).isFalse();
        assertThat(row[0].isDone()).isTrue();
        verify(progress, times(1)).awardHabitCheckin(USER);
    }

    @Test
    void theRefundNeverPassesTheCap() {
        HabitCheckin c = new HabitCheckin();
        c.setHabitId(habit.getId());
        c.setUserId(USER);
        c.setLogDate(TODAY);
        c.setDone(false);
        c.setProtectedDay(true); // a legacy row: xp_paid NULL
        row[0] = c;
        wallet.setTokens(HabitService.FREEZE_CAP);
        tick(true);
        assertThat(wallet.getTokens()).isEqualTo(HabitService.FREEZE_CAP);
        verify(progress, times(1)).awardHabitCheckin(USER); // a legacy rest day was never paid
    }

    @Test
    void tickUntickProtectTickPaysOnce() {
        tick(true);
        for (int i = 0; i < 3; i++) {
            tick(false);
            service.protect(USER, habit.getId(), TODAY);
            tick(true);
        }
        assertThat(wallet.getTokens()).isEqualTo(1);
        verify(progress, times(1)).awardHabitCheckin(USER);
    }
}
