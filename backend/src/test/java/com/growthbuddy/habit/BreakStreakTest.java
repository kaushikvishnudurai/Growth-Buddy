package com.growthbuddy.habit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.ProgressService;
import com.growthbuddy.user.UserClock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * I-08 "Take a break": days inside ui_prefs.breakFrom..breakUntil hold a streak
 * like a freeze without spending a token, owe nothing (the score's denominator),
 * and a break can't be aimed at the past to mend a streak that already broke.
 */
class BreakStreakTest {

    private static final ZoneId UTC = ZoneId.of("UTC");
    // Wednesday; the ISO week starts Monday 2026-10-05.
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

    private Map<String, Object> prefs;

    @BeforeEach
    void setUp() {
        prefs = new HashMap<>();
        when(clock.today(USER)).thenReturn(TODAY);
        when(clock.zoneOf(USER)).thenReturn(UTC);
        when(clock.prefsOf(USER)).thenAnswer(i -> prefs);
        when(wallets.findById(USER)).thenReturn(Optional.empty());
    }

    private void breakFrom(LocalDate from, LocalDate until) {
        prefs.put(OnBreak.FROM, from.toString());
        prefs.put(OnBreak.UNTIL, until.toString());
    }

    private static Habit habit(Cadence cadence) {
        Habit h = new Habit();
        h.setId(UUID.randomUUID());
        h.setUserId(USER);
        h.setName("Run");
        h.setIcon("repeat");
        h.setCadence(cadence);
        h.setTargetPerWeek(cadence == Cadence.daily ? 7 : 1);
        h.setCreatedAt(TODAY.minusDays(60).atStartOfDay(ZoneOffset.UTC).toInstant());
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

    /** Done Oct 1..4, newest first. */
    private List<HabitCheckin> fourDays(Habit h) {
        List<HabitCheckin> rows = new ArrayList<>();
        for (int i = 6; i >= 3; i--) rows.add(done(h, TODAY.minusDays(i)));
        rows.sort((a, b) -> b.getLogDate().compareTo(a.getLogDate()));
        return rows;
    }

    private HabitResponse listOne(Habit h, List<HabitCheckin> rows) {
        when(habits.findByUserIdAndDeletedAtIsNullOrderBySortOrderAscCreatedAtAsc(USER)).thenReturn(List.of(h));
        when(checkins.findByUserIdAndLogDateGreaterThanEqualOrderByLogDateDesc(any(), any())).thenReturn(rows);
        when(streaks.findAllById(any())).thenReturn(List.of());
        return service.list(USER).get(0);
    }

    @Test
    void aDailyStreakHoldsOverMissedBreakDaysWithoutAToken() {
        Habit h = habit(Cadence.daily);
        breakFrom(TODAY.minusDays(2), TODAY.plusDays(2)); // Oct 5..9: Oct 5, 6 and today missed
        HabitResponse r = listOne(h, fourDays(h));
        assertThat(r.streak()).isEqualTo(4);
        assertThat(r.atRisk()).isFalse();
        assertThat(r.dueToday()).isFalse(); // nothing owed on a break day
        assertThat(r.protectedToday()).isFalse(); // no freeze row was written
        assertThat(r.freezeTokens()).isEqualTo(1); // the new wallet's one token, untouched
    }

    @Test
    void withoutABreakTheSameMissesBreakTheStreak() {
        Habit h = habit(Cadence.daily);
        HabitResponse r = listOne(h, fourDays(h));
        assertThat(r.streak()).isZero();
        assertThat(r.dueToday()).isTrue();
    }

    @Test
    void theDayAfterTheBreakTheStreakIsStillThere() {
        Habit h = habit(Cadence.daily);
        breakFrom(TODAY.minusDays(2), TODAY.minusDays(1)); // ended yesterday: today is "back on it"
        HabitResponse r = listOne(h, fourDays(h));
        assertThat(r.streak()).isEqualTo(4);
        assertThat(r.atRisk()).isFalse();
        assertThat(r.dueToday()).isTrue();
    }

    @Test
    void aCheckinAfterTheBreakExtendsTheRunInTheCache() {
        Habit h = habit(Cadence.daily);
        breakFrom(TODAY.minusDays(2), TODAY.minusDays(1));
        when(habits.findByIdAndUserIdAndDeletedAtIsNull(h.getId(), USER)).thenReturn(Optional.of(h));
        when(checkins.findByHabitIdAndLogDate(h.getId(), TODAY)).thenReturn(Optional.empty());
        List<HabitCheckin> rows = fourDays(h);
        rows.add(0, done(h, TODAY));
        when(checkins.findByHabitIdOrderByLogDateDesc(h.getId())).thenReturn(rows);
        service.checkin(USER, h.getId(), new CheckinRequest(TODAY, true, null, null, null));
        ArgumentCaptor<HabitStreak> saved = ArgumentCaptor.forClass(HabitStreak.class);
        verify(streaks).save(saved.capture());
        assertThat(saved.getValue().getCurrentStreak()).isEqualTo(5);
    }

    @Test
    void anOldBreakKeptInBreakPastStillBridges() {
        Habit h = habit(Cadence.daily);
        prefs.put(OnBreak.PAST, List.of(TODAY.minusDays(2) + ".." + TODAY.minusDays(1)));
        breakFrom(TODAY.plusDays(5), TODAY.plusDays(7)); // a later one does not erase it
        assertThat(listOne(h, fourDays(h)).streak()).isEqualTo(4);
    }

    @Test
    void aWeekInsideTheBreakNeitherCountsNorBreaksAWeeklyRun() {
        Habit h = habit(Cadence.weekly);
        breakFrom(LocalDate.of(2026, 9, 28), LocalDate.of(2026, 10, 4)); // all of last week
        List<HabitCheckin> rows = List.of(done(h, LocalDate.of(2026, 9, 21)), done(h, LocalDate.of(2026, 9, 14)));
        assertThat(listOne(h, rows).streak()).isEqualTo(2);
    }

    @Test
    void aBreakDayOwesNothingSoTheScoreDoesNotDrop() {
        Habit run = habit(Cadence.daily);
        Habit read = habit(Cadence.daily);
        breakFrom(TODAY, TODAY.plusDays(2));
        when(habits.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(USER)).thenReturn(List.of(run, read));
        when(checkins.findByUserIdAndLogDateBetween(any(), any(), any())).thenReturn(List.of(done(read, TODAY)));
        HabitService.TodayCounts c = service.countsOn(USER, TODAY);
        assertThat(c.total()).isEqualTo(1); // only the one done
        assertThat(c.done()).isEqualTo(1);
        // The day before the break still counts both.
        assertThat(service.countsOn(USER, TODAY.minusDays(1)).total()).isEqualTo(2);
        assertThat(service.countsBetween(USER, TODAY.minusDays(1), TODAY).get(TODAY).total()).isEqualTo(1);
    }

    /* ---- what a save may store (AuthService.updateUiPrefs) ---- */

    private static Map<String, Object> range(LocalDate from, LocalDate until) {
        Map<String, Object> m = new HashMap<>();
        m.put(OnBreak.FROM, from.toString());
        m.put(OnBreak.UNTIL, until.toString());
        return m;
    }

    @Test
    void aBreakStartsTodayOrYesterdayAndRunsAtMostFifteenDays() {
        assertThat(OnBreak.settle(Map.of(), range(TODAY, TODAY.plusDays(2)), TODAY)).containsKey(OnBreak.FROM);
        assertThat(OnBreak.settle(Map.of(), range(TODAY.minusDays(1), TODAY.plusDays(13)), TODAY))
                .containsKey(OnBreak.FROM);
        assertThatThrownBy(() -> OnBreak.settle(Map.of(), range(TODAY.minusDays(5), TODAY.plusDays(2)), TODAY))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> OnBreak.settle(Map.of(), range(TODAY, TODAY.plusDays(15)), TODAY))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void endingEarlyIsAlwaysAllowedButAFinishedBreakCannotBeStretchedBack() {
        Map<String, Object> running = range(TODAY.minusDays(3), TODAY.plusDays(3));
        assertThat(OnBreak.settle(running, range(TODAY.minusDays(3), TODAY.minusDays(1)), TODAY))
                .containsEntry(OnBreak.UNTIL, TODAY.minusDays(1).toString());
        // Ended on its first day: an empty range.
        assertThat(OnBreak.settle(range(TODAY, TODAY.plusDays(2)), range(TODAY, TODAY.minusDays(1)), TODAY))
                .containsKey(OnBreak.UNTIL);
        Map<String, Object> over = range(TODAY.minusDays(10), TODAY.minusDays(8));
        assertThatThrownBy(() -> OnBreak.settle(over, range(TODAY.minusDays(10), TODAY), TODAY))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void aNewBreakFilesTheOldOneAndTheClientCannotWriteBreakPast() {
        Map<String, Object> before = range(TODAY.minusDays(10), TODAY.minusDays(8));
        Map<String, Object> after = range(TODAY, TODAY.plusDays(6));
        after.put(OnBreak.PAST, List.of("2026-01-01..2026-01-15"));
        Map<String, Object> out = OnBreak.settle(before, after, TODAY);
        assertThat(out.get(OnBreak.PAST)).isEqualTo(List.of(TODAY.minusDays(10) + ".." + TODAY.minusDays(8)));
        assertThat(OnBreak.on(out, TODAY.minusDays(9))).isTrue();
        assertThat(OnBreak.on(out, TODAY.minusDays(7))).isFalse();
        assertThat(OnBreak.on(out, TODAY.plusDays(6))).isTrue();
        // Unrelated saves leave it alone.
        Map<String, Object> theme = new HashMap<>(out);
        theme.put("theme", "dark");
        assertThat(OnBreak.settle(out, theme, TODAY).get(OnBreak.PAST)).isEqualTo(out.get(OnBreak.PAST));
    }

    @Test
    void unreadableValuesMeanNoBreak() {
        assertThat(OnBreak.on(null, TODAY)).isFalse();
        assertThat(OnBreak.on(Map.of(OnBreak.FROM, "soon", OnBreak.UNTIL, "later"), TODAY)).isFalse();
        assertThat(OnBreak.on(Map.of(OnBreak.UNTIL, TODAY.toString()), TODAY)).isFalse();
    }
}
