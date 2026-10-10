package com.growthbuddy.habit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
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
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * The habit rules that live outside the daily streak walk: what counts toward
 * today's score, XP once per day, refused dates, the weekly streak, and the
 * freeze wallet. Repositories are mocks; nothing touches a database.
 */
class HabitServiceRulesTest {

    private static final ZoneId UTC = ZoneId.of("UTC");
    // A Wednesday, so the ISO week (Mon 2026-10-05) has days on both sides.
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 7);
    private static final UUID USER = UUID.randomUUID();

    private final HabitRepository habits = mock(HabitRepository.class);
    private final HabitCheckinRepository checkins = mock(HabitCheckinRepository.class);
    private final HabitStreakRepository streaks = mock(HabitStreakRepository.class);
    private final StreakFreezeWalletRepository wallets = mock(StreakFreezeWalletRepository.class);
    private final ProgressService progress = mock(ProgressService.class);
    private final UserClock clock = mock(UserClock.class);
    private final HabitService service =
            new HabitService(habits, checkins, streaks, wallets, progress, clock);

    private Habit habit;

    @BeforeEach
    void setUp() {
        when(clock.today(USER)).thenReturn(TODAY);
        when(clock.zoneOf(USER)).thenReturn(UTC);
        habit = habit(Cadence.daily, 7, TODAY.minusDays(30));
        when(habits.findByIdAndUserIdAndDeletedAtIsNull(habit.getId(), USER))
                .thenReturn(Optional.of(habit));
    }

    private static Habit habit(Cadence cadence, int target, LocalDate created) {
        Habit h = new Habit();
        h.setId(UUID.randomUUID());
        h.setUserId(USER);
        h.setName("Run");
        h.setIcon("repeat");
        h.setCadence(cadence);
        h.setTargetPerWeek(target);
        h.setCreatedAt(created.atStartOfDay(ZoneOffset.UTC).toInstant());
        return h;
    }

    private static HabitCheckin done(Habit h, LocalDate d) {
        HabitCheckin c = new HabitCheckin();
        c.setHabitId(h.getId());
        c.setUserId(USER);
        c.setLogDate(d);
        c.setDone(true);
        return c;
    }

    /* ---- what counts toward today ---- */

    @Test
    void weeklyHabitDoneEarlierThisWeekIsNotADailyMiss() {
        Habit daily = habit(Cadence.daily, 7, TODAY.minusDays(30));
        Habit weekly = habit(Cadence.weekly, 1, TODAY.minusDays(30));
        // Weekly was done Monday; today is Wednesday and neither is ticked today.
        HabitService.TodayCounts c = HabitService.countDue(List.of(daily, weekly),
                List.of(done(weekly, TODAY.minusDays(2))), TODAY, UTC);
        assertThat(c.total()).isEqualTo(1);
        assertThat(c.done()).isZero();
    }

    @Test
    void customHabitIsOwedUntilItsWeeklyQuotaIsMet() {
        Habit three = habit(Cadence.custom, 3, TODAY.minusDays(30));
        List<HabitCheckin> twoSoFar = List.of(done(three, TODAY.minusDays(2)), done(three, TODAY.minusDays(1)));
        assertThat(HabitService.countDue(List.of(three), twoSoFar, TODAY, UTC).total()).isEqualTo(1);
        // Quota met on earlier days this week: no longer owed today.
        Habit two = habit(Cadence.custom, 2, TODAY.minusDays(30));
        assertThat(HabitService.countDue(List.of(two),
                List.of(done(two, TODAY.minusDays(2)), done(two, TODAY.minusDays(1))), TODAY, UTC).total())
                .isZero();
    }

    @Test
    void aHabitTickedTodayAlwaysCountsAsDone() {
        Habit weekly = habit(Cadence.weekly, 1, TODAY.minusDays(30));
        HabitService.TodayCounts c = HabitService.countDue(List.of(weekly),
                List.of(done(weekly, TODAY.minusDays(1)), done(weekly, TODAY)), TODAY, UTC);
        assertThat(c.total()).isEqualTo(1);
        assertThat(c.done()).isEqualTo(1);
    }

    @Test
    void pausedAndNotYetCreatedHabitsDoNotCount() {
        Habit paused = habit(Cadence.daily, 7, TODAY.minusDays(30));
        paused.setActive(false);
        Habit future = habit(Cadence.daily, 7, TODAY.plusDays(1));
        assertThat(HabitService.countDue(List.of(paused, future), List.of(), TODAY, UTC).total()).isZero();
    }

    @Test
    void deletedHabitsCheckInsAreIgnored() {
        Habit kept = habit(Cadence.daily, 7, TODAY.minusDays(30));
        Habit deleted = habit(Cadence.daily, 7, TODAY.minusDays(30));
        // `deleted` is not in the list (the repository excludes soft-deleted rows),
        // but its check-in for today is still in the table.
        HabitService.TodayCounts c = HabitService.countDue(List.of(kept),
                List.of(done(deleted, TODAY)), TODAY, UTC);
        assertThat(c.done()).isZero();
        assertThat(c.total()).isEqualTo(1);
    }

    /* ---- XP once per habit per day ---- */

    @Test
    void firstTickAwardsXpButUntickThenRetickDoesNot() {
        when(checkins.findByHabitIdAndLogDate(habit.getId(), TODAY)).thenReturn(Optional.empty());
        service.checkin(USER, habit.getId(), new CheckinRequest(TODAY, true, null, null, null));
        verify(progress, times(1)).awardHabitCheckin(USER);

        // The un-tick left the row behind, done = false.
        HabitCheckin untouched = done(habit, TODAY);
        untouched.setDone(false);
        when(checkins.findByHabitIdAndLogDate(habit.getId(), TODAY)).thenReturn(Optional.of(untouched));
        service.checkin(USER, habit.getId(), new CheckinRequest(TODAY, true, null, null, null));
        verify(progress, times(1)).awardHabitCheckin(USER);
    }

    @Test
    void completingAProtectedDayAwardsXp() {
        HabitCheckin rest = done(habit, TODAY.minusDays(1));
        rest.setDone(false);
        rest.setProtectedDay(true);
        when(checkins.findByHabitIdAndLogDate(habit.getId(), TODAY.minusDays(1))).thenReturn(Optional.of(rest));
        service.checkin(USER, habit.getId(), new CheckinRequest(TODAY.minusDays(1), true, null, null, null));
        verify(progress).awardHabitCheckin(USER);
    }

    @Test
    void aCheckinWithoutANoteKeepsTheOldNote() {
        HabitCheckin row = done(habit, TODAY);
        row.setNote("felt good");
        when(checkins.findByHabitIdAndLogDate(habit.getId(), TODAY)).thenReturn(Optional.of(row));
        service.checkin(USER, habit.getId(), new CheckinRequest(TODAY, true, null, 5.0, null));
        ArgumentCaptor<HabitCheckin> saved = ArgumentCaptor.forClass(HabitCheckin.class);
        verify(checkins).save(saved.capture());
        assertThat(saved.getValue().getNote()).isEqualTo("felt good");
    }

    @Test
    void aFutureDayIsRefused() {
        assertThatThrownBy(() -> service.checkin(USER, habit.getId(),
                new CheckinRequest(TODAY.plusDays(1), true, null, null, null)))
                .isInstanceOf(ApiException.class);
        verify(checkins, never()).save(any());
    }

    /* ---- freeze wallet ---- */

    @Test
    void protectRefusesADayBeforeTheHabitExisted() {
        assertThatThrownBy(() -> service.protect(USER, habit.getId(), TODAY.minusDays(31)))
                .isInstanceOf(ApiException.class);
        verify(wallets, never()).save(any());
    }

    @Test
    void walletTopsUpOncePerWeekAndCapsAtTwo() {
        StreakFreezeWallet w = new StreakFreezeWallet();
        w.setUserId(USER);
        w.setTokens(1);
        w.setWeekAnchor(HabitService.weekStartOf(TODAY).minusWeeks(1));
        when(wallets.findById(USER)).thenReturn(Optional.of(w));
        assertThat(service.freezeStatus(USER).tokens()).isEqualTo(2);
        // Same week again: no second grant.
        assertThat(service.freezeStatus(USER).tokens()).isEqualTo(2);
        // A new week at the cap stays at the cap.
        w.setWeekAnchor(HabitService.weekStartOf(TODAY).minusWeeks(1));
        assertThat(service.freezeStatus(USER).tokens()).isEqualTo(HabitService.FREEZE_CAP);
    }

    @Test
    void unprotectRefundsTheToken() {
        StreakFreezeWallet w = new StreakFreezeWallet();
        w.setUserId(USER);
        w.setTokens(0);
        w.setWeekAnchor(HabitService.weekStartOf(TODAY));
        when(wallets.findById(USER)).thenReturn(Optional.of(w));
        HabitCheckin rest = done(habit, TODAY.minusDays(1));
        rest.setDone(false);
        rest.setProtectedDay(true);
        when(checkins.findByHabitIdAndLogDate(eq(habit.getId()), eq(TODAY.minusDays(1))))
                .thenReturn(Optional.of(rest));
        service.unprotect(USER, habit.getId(), TODAY.minusDays(1));
        assertThat(w.getTokens()).isEqualTo(1);
        assertThat(rest.isProtectedDay()).isFalse();
    }

    /* ---- weekly / custom streaks ---- */

    @Test
    void weeklyStreakCountsConsecutiveWeeksAndSurvivesAnUnfinishedCurrentWeek() {
        Habit weekly = habit(Cadence.weekly, 1, TODAY.minusDays(60));
        // Done once in each of the last three weeks, nothing yet this week.
        List<HabitCheckin> rows = List.of(done(weekly, TODAY.minusWeeks(1)),
                done(weekly, TODAY.minusWeeks(2)), done(weekly, TODAY.minusWeeks(3)));
        List<LocalDate> weeks = service.completedWeekBuckets(rows, 1);
        assertThat(service.currentWeeklyRun(TODAY, weeks)).isEqualTo(3);
    }

    @Test
    void customStreakNeedsTheFullQuotaAndBreaksOnAMissedWeek() {
        Habit custom = habit(Cadence.custom, 2, TODAY.minusDays(60));
        LocalDate lastMon = HabitService.weekStartOf(TODAY).minusWeeks(1);
        List<HabitCheckin> rows = List.of(
                done(custom, lastMon), done(custom, lastMon.plusDays(1)), // quota met last week
                done(custom, lastMon.minusWeeks(1)),                     // only 1 of 2: not met
                done(custom, lastMon.minusWeeks(2)), done(custom, lastMon.minusWeeks(2).plusDays(1)));
        List<LocalDate> weeks = service.completedWeekBuckets(rows, 2);
        assertThat(service.currentWeeklyRun(TODAY, weeks)).isEqualTo(1);
        // Two weeks with nothing completed: the streak is over.
        assertThat(service.currentWeeklyRun(TODAY.plusWeeks(2), weeks)).isZero();
    }

    /* ---- at risk ---- */

    @Test
    void aDailyRunWithYesterdayMissedIsAtRisk() {
        when(checkins.findByHabitIdAndLogDateGreaterThanEqualOrderByLogDateDesc(eq(habit.getId()), any()))
                .thenReturn(List.of(done(habit, TODAY.minusDays(2)), done(habit, TODAY.minusDays(3))));
        when(checkins.findByHabitIdAndLogDate(habit.getId(), TODAY)).thenReturn(Optional.empty());
        HabitResponse r = service.checkin(USER, habit.getId(), new CheckinRequest(TODAY, false, null, null, null));
        assertThat(r.atRisk()).isTrue();
        assertThat(r.riskStreak()).isEqualTo(2);
        assertThat(r.streak()).isZero();
    }

    /* ---- bounded read ---- */

    @Test
    void cachedStreakCoversARunLongerThanTheReadWindowButNotABrokenOne() {
        HabitStreak cached = new HabitStreak();
        cached.setCurrentStreak(500);
        assertThat(HabitService.liveOrCached(400, cached)).isEqualTo(500);
        assertThat(HabitService.liveOrCached(0, cached)).isZero();
        assertThat(HabitService.liveOrCached(3, null)).isEqualTo(3);
    }
}
