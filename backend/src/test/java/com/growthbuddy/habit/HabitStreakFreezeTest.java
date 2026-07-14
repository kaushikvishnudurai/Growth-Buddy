package com.growthbuddy.habit;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for the freeze-aware daily streak math: a protected ("rest"/freeze)
 * day must bridge a gap without breaking the streak, and must not itself count
 * as a completed day.
 */
class HabitStreakFreezeTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 6, 27);

    // Repos are never touched by the pure date math, so nulls are fine here.
    private final HabitService service = new HabitService(null, null, null, null, null);

    private Set<LocalDate> days(int... daysAgo) {
        Set<LocalDate> s = new java.util.HashSet<>();
        for (int d : daysAgo) {
            s.add(TODAY.minusDays(d));
        }
        return s;
    }

    @Test
    void unbrokenRunCountsEveryDoneDay() {
        Set<LocalDate> done = days(0, 1, 2); // today + 2 days back
        assertThat(service.currentDailyRun(TODAY, done, Set.of())).isEqualTo(3);
    }

    @Test
    void plainGapBreaksTheStreak() {
        // done today and 2 days ago, but yesterday missed and unprotected.
        Set<LocalDate> done = days(0, 2);
        assertThat(service.currentDailyRun(TODAY, done, Set.of())).isEqualTo(1);
    }

    @Test
    void protectedDayBridgesTheGap() {
        // yesterday was a rest day -> the 3-day run survives, but rest doesn't count.
        Set<LocalDate> done = days(0, 2, 3);
        Set<LocalDate> prot = days(1);
        assertThat(service.currentDailyRun(TODAY, done, prot)).isEqualTo(3);
    }

    @Test
    void streakAliveWhenTodayMissedButYesterdayDone() {
        // Not done today yet, but yesterday + before are done — streak still counts.
        Set<LocalDate> done = days(1, 2);
        assertThat(service.currentDailyRun(TODAY, done, Set.of())).isEqualTo(2);
    }

    @Test
    void brokenWhenTodayAndYesterdayBothInactive() {
        Set<LocalDate> done = days(2, 3);
        assertThat(service.currentDailyRun(TODAY, done, Set.of())).isZero();
    }

    @Test
    void longestRunCountsDoneAcrossAProtectedBridge() {
        // done 5,4,(rest 3),2,1 then gap, then done today: longest contiguous run
        // of done days bridged by the rest day = 4 (days 5,4,2,1).
        Set<LocalDate> done = days(5, 4, 2, 1);
        Set<LocalDate> prot = days(3);
        assertThat(service.longestDailyRun(done, prot)).isEqualTo(4);
    }

    @Test
    void longestRunFindsBestBlockAcrossARealGap() {
        // A 2-day block, an unprotected gap, then a 4-day block -> longest is 4.
        Set<LocalDate> done = days(0, 1, 5, 6, 7, 8);
        assertThat(service.longestDailyRun(done, Set.of())).isEqualTo(4);
    }

    @Test
    void allRestNoDoneIsZeroStreak() {
        assertThat(service.longestDailyRun(Set.of(), days(0, 1, 2))).isZero();
    }
}
