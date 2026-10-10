package com.growthbuddy.water;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** Which day a glass counts towards, whose goal wins, and the week's empty days. */
class WaterServiceTest {

    private static final UUID USER = UUID.randomUUID();
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final WaterEntryRepository entries = mock(WaterEntryRepository.class);
    private final WaterGoalRepository goals = mock(WaterGoalRepository.class);
    private final UserClock clock = mock(UserClock.class);
    private final UserRepository users = mock(UserRepository.class);
    private WaterService service;
    private LocalDate today;

    @BeforeEach
    void setUp() {
        today = LocalDate.now(IST);
        when(clock.zoneOf(any())).thenReturn(IST);
        when(clock.today(any())).thenReturn(today);
        when(entries.save(any())).thenAnswer(i -> i.getArgument(0));
        when(entries.findByUserIdAndLogDateOrderByLoggedAtAsc(any(), any())).thenReturn(List.of());
        when(goals.findById(any())).thenReturn(Optional.empty());
        when(users.findById(any())).thenReturn(Optional.empty());
        service = new WaterService(entries, goals, clock, users);
    }

    private WaterEntry saved() {
        ArgumentCaptor<WaterEntry> c = ArgumentCaptor.forClass(WaterEntry.class);
        org.mockito.Mockito.verify(entries).save(c.capture());
        return c.getValue();
    }

    @Test
    void aGlassCountsTowardsTheDrinkersOwnDay() {
        // 00:30 IST yesterday is 19:00 UTC the day before: UTC would file it a day early.
        Instant early = today.minusDays(1).atStartOfDay(IST).plusMinutes(30).toInstant();
        service.addEntry(USER, new AddWaterEntryRequest(250, null, early));
        assertThat(saved().getLogDate()).isEqualTo(today.minusDays(1));
    }

    @Test
    void aPastDayIsFineAFutureOneIsRefused() {
        Instant yesterday = today.minusDays(1).atTime(12, 0).atZone(IST).toInstant();
        service.addEntry(USER, new AddWaterEntryRequest(250, null, yesterday));
        assertThat(saved().getLogDate()).isEqualTo(today.minusDays(1));

        Instant tomorrow = today.plusDays(1).atTime(12, 0).atZone(IST).toInstant();
        assertThatThrownBy(() -> service.addEntry(USER, new AddWaterEntryRequest(250, null, tomorrow)))
                .isInstanceOf(ApiException.class);
        Instant inAnHour = Instant.now().plusSeconds(3600);
        if (!inAnHour.atZone(IST).toLocalDate().isAfter(today)) {
            assertThatThrownBy(() -> service.addEntry(USER, new AddWaterEntryRequest(250, null, inAnHour)))
                    .isInstanceOf(ApiException.class);
        }
        // A phone clock a minute fast still logs (unless that minute is past midnight).
        Instant fast = Instant.now().plusSeconds(60);
        if (!fast.atZone(IST).toLocalDate().isAfter(today)) {
            service.addEntry(USER, new AddWaterEntryRequest(250, null, fast));
        }
    }

    @Test
    void theLegacyTrackerGoalWinsThenTheProfileThenTheDefault() {
        assertThat(service.goalMl(USER)).isEqualTo(2000);

        User u = new User();
        u.setDailyWaterGoalMl(3000);
        when(users.findById(USER)).thenReturn(Optional.of(u));
        assertThat(service.goalMl(USER)).isEqualTo(3000);

        WaterGoal legacy = new WaterGoal();
        legacy.setGoalMl(2500);
        when(goals.findById(USER)).thenReturn(Optional.of(legacy));
        assertThat(service.goalMl(USER)).isEqualTo(2500);
    }

    @Test
    void theWeekIsSevenDaysOldestFirstWithEmptyDaysAtZero() {
        List<Object[]> rows = List.of(new Object[] {today, null, 1500L},
                new Object[] {today.minusDays(3), null, 750L});
        when(entries.totalsByDay(USER, today.minusDays(6), today)).thenReturn(rows);
        WaterWeekResponse w = service.week(USER);
        assertThat(w.days()).hasSize(7);
        assertThat(w.days().get(0).date()).isEqualTo(today.minusDays(6).toString());
        assertThat(w.days()).extracting(WaterWeekDay::ml).containsExactly(0, 0, 0, 750, 0, 0, 1500);
        assertThat(w.goalMl()).isEqualTo(2000);
    }
}
