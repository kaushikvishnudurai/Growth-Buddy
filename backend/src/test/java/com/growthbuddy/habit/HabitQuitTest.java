package com.growthbuddy.habit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.ProgressService;
import com.growthbuddy.user.UserClock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * "Break a habit" (HabitKind.quit): each day is clean unless a slip is logged,
 * the streak is the days since the last slip, the score counts it as done
 * unless today was slipped, and each clean day pays XP exactly once.
 * Repositories are mocks; nothing touches a database.
 */
class HabitQuitTest {

    private static final ZoneId UTC = ZoneId.of("UTC");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 7); // a Wednesday
    private static final UUID USER = UUID.randomUUID();

    private final HabitRepository habits = mock(HabitRepository.class);
    private final HabitCheckinRepository checkins = mock(HabitCheckinRepository.class);
    private final HabitStreakRepository streaks = mock(HabitStreakRepository.class);
    private final StreakFreezeWalletRepository wallets = mock(StreakFreezeWalletRepository.class);
    private final ProgressService progress = mock(ProgressService.class);
    private final UserClock clock = mock(UserClock.class);
    private final HabitService service =
            new HabitService(habits, checkins, streaks, wallets, progress, clock);

    private Habit quit;

    @BeforeEach
    void setUp() {
        when(clock.today(USER)).thenReturn(TODAY);
        when(clock.zoneOf(USER)).thenReturn(UTC);
        quit = quitHabit(TODAY.minusDays(5));
        when(habits.findByIdAndUserIdAndDeletedAtIsNull(quit.getId(), USER)).thenReturn(Optional.of(quit));
    }

    private static Habit quitHabit(LocalDate created) {
        Habit h = new Habit();
        h.setId(UUID.randomUUID());
        h.setUserId(USER);
        h.setName("No sugar");
        h.setIcon("repeat");
        h.setKind(HabitKind.quit);
        h.setCreatedAt(created.atStartOfDay(ZoneOffset.UTC).toInstant());
        h.setCleanCreditedThrough(created.minusDays(1));
        return h;
    }

    private static HabitCheckin slip(Habit h, LocalDate d) {
        HabitCheckin c = new HabitCheckin();
        c.setHabitId(h.getId());
        c.setUserId(USER);
        c.setLogDate(d);
        c.setDone(false);
        return c;
    }

    /* ---- streak = days since the last slip ---- */

    @Test
    void streakCountsCleanDaysSinceTheStartOrTheLastSlip() {
        LocalDate start = TODAY.minusDays(5);
        // Never slipped: the start day through today, today included.
        assertThat(HabitService.quitStreak(TODAY, start, null)).isEqualTo(6);
        // Created today: day one reads 1.
        assertThat(HabitService.quitStreak(TODAY, TODAY, null)).isEqualTo(1);
        // Slipped three days ago: the three days after it.
        assertThat(HabitService.quitStreak(TODAY, start, TODAY.minusDays(3))).isEqualTo(3);
        // Slipped today: nothing clean yet.
        assertThat(HabitService.quitStreak(TODAY, start, TODAY)).isZero();
    }

    @Test
    void longestRunIsTheWidestGapBetweenSlips() {
        LocalDate start = TODAY.minusDays(20);
        // Clean days 20..15 back (6), slip at 14, clean 13..4 (10), slip at 3, clean 2..0 (3).
        Set<LocalDate> slips = Set.of(TODAY.minusDays(14), TODAY.minusDays(3));
        assertThat(HabitService.longestQuitRun(TODAY, start, slips)).isEqualTo(10);
        assertThat(HabitService.longestQuitRun(TODAY, start, Set.of())).isEqualTo(21);
    }

    @Test
    void theListReadsTheStreakLiveAndCleanTodayAsDone() {
        when(habits.findByUserIdAndDeletedAtIsNullOrderBySortOrderAscCreatedAtAsc(USER)).thenReturn(List.of(quit));
        when(checkins.findByUserIdAndLogDateGreaterThanEqualOrderByLogDateDesc(eq(USER), any()))
                .thenReturn(List.of(slip(quit, TODAY.minusDays(2))));
        HabitResponse r = service.list(USER).get(0);
        assertThat(r.kind()).isEqualTo(HabitKind.quit);
        assertThat(r.streak()).isEqualTo(2);
        assertThat(r.doneToday()).isTrue();
        assertThat(r.dueToday()).isTrue();
        assertThat(r.atRisk()).isFalse();
    }

    /* ---- what counts toward today ---- */

    @Test
    void aQuitHabitCountsAsDoneUnlessTodayWasSlipped() {
        HabitService.TodayCounts clean = HabitService.countDue(List.of(quit), List.of(), TODAY, UTC);
        assertThat(clean.total()).isEqualTo(1);
        assertThat(clean.done()).isEqualTo(1);

        HabitService.TodayCounts slipped = HabitService.countDue(List.of(quit),
                List.of(slip(quit, TODAY)), TODAY, UTC);
        assertThat(slipped.total()).isEqualTo(1);
        assertThat(slipped.done()).isZero();

        // A slip on an earlier day says nothing about today.
        HabitService.TodayCounts earlier = HabitService.countDue(List.of(quit),
                List.of(slip(quit, TODAY.minusDays(1))), TODAY, UTC);
        assertThat(earlier.done()).isEqualTo(1);
    }

    @Test
    void aPausedOrNotYetStartedQuitHabitDoesNotCount() {
        quit.setActive(false);
        Habit later = quitHabit(TODAY.plusDays(1));
        assertThat(HabitService.countDue(List.of(quit, later), List.of(), TODAY, UTC).total()).isZero();
    }

    /* ---- XP: each clean day once ---- */

    @Test
    void cleanDaysArePaidOnceThroughYesterday() {
        when(habits.findByUserIdAndDeletedAtIsNullOrderBySortOrderAscCreatedAtAsc(USER)).thenReturn(List.of(quit));
        when(checkins.findByUserIdAndLogDateGreaterThanEqualOrderByLogDateDesc(eq(USER), any()))
                .thenReturn(List.of(slip(quit, TODAY.minusDays(2))));
        service.list(USER);
        // Five finished days (5..1 back), one of them slipped; today is not paid yet.
        verify(progress).awardHabitCleanDays(USER, 4);
        assertThat(quit.getCleanCreditedThrough()).isEqualTo(TODAY.minusDays(1));

        // Reading again the same day pays nothing more.
        service.list(USER);
        verify(progress, times(1)).awardHabitCleanDays(eq(USER), anyInt());
    }

    @Test
    void aPausedQuitHabitEarnsNothingButItsDaysAreSettled() {
        quit.setActive(false);
        assertThat(HabitService.creditableCleanDays(quit, Set.of(), TODAY, UTC)).isZero();
        when(habits.findByUserIdAndDeletedAtIsNullOrderBySortOrderAscCreatedAtAsc(USER)).thenReturn(List.of(quit));
        service.list(USER);
        verify(progress, never()).awardHabitCleanDays(any(), anyInt());
        assertThat(quit.getCleanCreditedThrough()).isEqualTo(TODAY.minusDays(1));
    }

    @Test
    void slippingAndTakingItBackNeverPaysCheckinXp() {
        service.checkin(USER, quit.getId(), new CheckinRequest(TODAY, false, "cake at work", null, null));
        HabitCheckin row = slip(quit, TODAY);
        when(checkins.findByHabitIdAndLogDate(quit.getId(), TODAY)).thenReturn(Optional.of(row));
        service.checkin(USER, quit.getId(), new CheckinRequest(TODAY, true, null, null, null));
        service.checkin(USER, quit.getId(), new CheckinRequest(TODAY, false, null, null, null));
        verify(progress, never()).awardHabitCheckin(any());
    }

    @Test
    void theTodayToggleLogsASlipWithItsNote() {
        when(checkins.findByHabitIdAndLogDate(quit.getId(), TODAY)).thenReturn(Optional.empty());
        service.toggleToday(USER, quit.getId());
        ArgumentCaptor<HabitCheckin> saved = ArgumentCaptor.forClass(HabitCheckin.class);
        verify(checkins).save(saved.capture());
        assertThat(saved.getValue().isDone()).isFalse();
        assertThat(saved.getValue().isProtectedDay()).isFalse();
        assertThat(HabitService.isSlip(saved.getValue())).isTrue();
    }

    @Test
    void aQuitHabitTakesNoFreeze() {
        assertThatThrownBy(() -> service.protect(USER, quit.getId(), TODAY.minusDays(1)))
                .isInstanceOf(ApiException.class);
        verify(wallets, never()).save(any());
    }

    @Test
    void aQuitHabitStaysDailyAndUnmeasured() {
        service.update(USER, quit.getId(), new UpdateHabitRequest(null, null, null, null,
                Cadence.weekly, 2, null, HabitMetric.km, null, null, null));
        assertThat(quit.getCadence()).isEqualTo(Cadence.daily);
        assertThat(quit.getMetric()).isEqualTo(HabitMetric.none);
    }
}
