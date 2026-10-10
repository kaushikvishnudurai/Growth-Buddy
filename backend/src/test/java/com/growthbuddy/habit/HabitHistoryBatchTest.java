package com.growthbuddy.habit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.CurrentUser;
import com.growthbuddy.user.ProgressService;
import com.growthbuddy.user.UserClock;
import java.lang.reflect.Method;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * GET /api/habits/history: every habit's {@code {since, days}} from ONE check-in
 * query, the read Insights used to make once per daily habit.
 */
class HabitHistoryBatchTest {

    private static final ZoneId UTC = ZoneId.of("UTC");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 7);
    private static final UUID USER = UUID.randomUUID();

    private final HabitRepository habits = mock(HabitRepository.class);
    private final HabitCheckinRepository checkins = mock(HabitCheckinRepository.class);
    private final HabitService service = new HabitService(habits, checkins,
            mock(HabitStreakRepository.class), mock(StreakFreezeWalletRepository.class),
            mock(ProgressService.class), clockAt(TODAY));

    private static UserClock clockAt(LocalDate today) {
        UserClock clock = mock(UserClock.class);
        when(clock.today(USER)).thenReturn(today);
        when(clock.zoneOf(USER)).thenReturn(UTC);
        return clock;
    }

    private static Habit habit(LocalDate created) {
        Habit h = new Habit();
        h.setId(UUID.randomUUID());
        h.setUserId(USER);
        h.setName("Run");
        h.setIcon("repeat");
        h.setCadence(Cadence.daily);
        h.setTargetPerWeek(7);
        h.setCreatedAt(created.atStartOfDay(ZoneOffset.UTC).toInstant());
        return h;
    }

    private static HabitCheckin row(Habit h, LocalDate d, boolean done, boolean protectedDay) {
        HabitCheckin c = new HabitCheckin();
        c.setHabitId(h.getId());
        c.setUserId(USER);
        c.setLogDate(d);
        c.setDone(done);
        c.setProtectedDay(protectedDay);
        return c;
    }

    private Habit old;
    private Habit fresh;

    @BeforeEach
    void setUp() {
        old = habit(TODAY.minusDays(300));
        fresh = habit(TODAY.minusDays(3));
        when(habits.findByUserIdAndDeletedAtIsNullOrderBySortOrderAscCreatedAtAsc(USER))
                .thenReturn(List.of(old, fresh));
    }

    @AfterEach
    void tearDown() {
        CurrentUser.clear();
    }

    @Test
    void groupsOneQueryByHabitInTheUsersOrder() {
        Habit deleted = habit(TODAY.minusDays(10));
        when(checkins.findByUserIdAndLogDateGreaterThanEqualOrderByLogDateDesc(USER, TODAY.minusDays(60)))
                .thenReturn(List.of(
                        row(fresh, TODAY, true, false),
                        row(old, TODAY.minusDays(1), true, false),
                        row(deleted, TODAY.minusDays(1), true, false),
                        row(old, TODAY.minusDays(2), false, true)));

        Map<UUID, HabitHistory> all = service.historyAll(USER, 60);

        assertThat(all.keySet()).containsExactly(old.getId(), fresh.getId());
        HabitHistory o = all.get(old.getId());
        assertThat(o.since()).isEqualTo(TODAY.minusDays(60)); // older than the window: the window
        assertThat(o.days()).containsExactly(
                new HabitDay(TODAY.minusDays(1), true, false),
                new HabitDay(TODAY.minusDays(2), false, true));
        HabitHistory f = all.get(fresh.getId());
        assertThat(f.since()).isEqualTo(TODAY.minusDays(3)); // its own start, not a missed month
        assertThat(f.days()).containsExactly(new HabitDay(TODAY, true, false));
        verify(checkins, never()).findByHabitIdAndLogDateGreaterThanEqualOrderByLogDateDesc(any(), any());
    }

    @Test
    void aHabitWithNoCheckinsHasAnEmptyDaysListNotAMissingKey() {
        when(checkins.findByUserIdAndLogDateGreaterThanEqualOrderByLogDateDesc(eq(USER), any()))
                .thenReturn(List.of());
        Map<UUID, HabitHistory> all = service.historyAll(USER, 60);
        assertThat(all).hasSize(2);
        assertThat(all.get(old.getId()).days()).isEmpty();
    }

    @Test
    void noHabitsSkipsTheCheckinQuery() {
        when(habits.findByUserIdAndDeletedAtIsNullOrderBySortOrderAscCreatedAtAsc(USER))
                .thenReturn(List.of());
        assertThat(service.historyAll(USER, 60)).isEmpty();
        verify(checkins, never()).findByUserIdAndLogDateGreaterThanEqualOrderByLogDateDesc(any(), any());
    }

    @Test
    void daysIsClampedToTheReadWindow() {
        when(checkins.findByUserIdAndLogDateGreaterThanEqualOrderByLogDateDesc(eq(USER), any()))
                .thenReturn(List.of());
        service.historyAll(USER, 100_000);
        verify(checkins).findByUserIdAndLogDateGreaterThanEqualOrderByLogDateDesc(
                USER, TODAY.minusDays(HabitService.HISTORY_WINDOW_DAYS));
        assertThat(HabitService.clampHistoryDays(0)).isEqualTo(1);
        assertThat(HabitService.clampHistoryDays(-5)).isEqualTo(1);
        assertThat(HabitService.clampHistoryDays(60)).isEqualTo(60);
        assertThat(HabitService.clampHistoryDays(401)).isEqualTo(HabitService.HISTORY_WINDOW_DAYS);
    }

    /** The route the client calls, with the default it relies on. */
    @Test
    void controllerServesTheBatchAtGetHistoryForTheCurrentUser() throws Exception {
        HabitService svc = mock(HabitService.class);
        Map<UUID, HabitHistory> expected = Map.of(old.getId(), new HabitHistory(TODAY, List.of()));
        when(svc.historyAll(USER, 60)).thenReturn(expected);
        CurrentUser.set(USER);

        assertThat(new HabitController(svc).historyAll(60)).isSameAs(expected);

        assertThat(HabitController.class.getAnnotation(RequestMapping.class).value())
                .containsExactly("/api/habits");
        Method m = HabitController.class.getMethod("historyAll", int.class);
        assertThat(m.getAnnotation(GetMapping.class).value()).containsExactly("/history");
        var param = m.getParameters()[0]
                .getAnnotation(org.springframework.web.bind.annotation.RequestParam.class);
        assertThat(param.defaultValue()).isEqualTo("60");
    }
}
