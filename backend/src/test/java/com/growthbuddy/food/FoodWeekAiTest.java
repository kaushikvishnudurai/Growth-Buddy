package com.growthbuddy.food;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ThrottleStore;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** What the Summary spends on AI: a failed batch backs off, an unchanged week isn't re-checked. */
class FoodWeekAiTest {

    private final UUID user = UUID.randomUUID();
    private final LocalDate today = LocalDate.of(2026, 10, 2);
    private FoodEntryRepository entries;
    private OpenAIClient openai;
    private FoodWeek week;

    private com.growthbuddy.water.WaterService water;
    private org.springframework.jdbc.core.JdbcTemplate jdbc;
    private final Map<String, Map<String, Object>> table = new java.util.HashMap<>();

    @BeforeEach
    void setUp() {
        entries = mock(FoodEntryRepository.class);
        UserRepository users = mock(UserRepository.class);
        UserClock clock = mock(UserClock.class);
        openai = mock(OpenAIClient.class);
        when(clock.today(user)).thenReturn(today);
        when(clock.zoneOf(user)).thenReturn(java.time.ZoneOffset.UTC);
        this.users = users;
        when(users.findById(any())).thenReturn(Optional.empty());
        when(openai.isConfigured()).thenReturn(true);
        FoodEntry e = new FoodEntry();
        e.setId(UUID.randomUUID());
        e.setFoodName("Dosa");
        e.setQuantityGrams(200);
        e.setKcalEstimated(400);
        e.setLogDate(today);
        when(entries.findByUserIdAndLogDateBetween(user, today.minusDays(6), today)).thenReturn(List.of(e));
        water = mock(com.growthbuddy.water.WaterService.class);
        when(water.goalMl(user)).thenReturn(2500);
        // food_diet_checks as a map: the upsert writes it, the SELECT reads it back.
        jdbc = mock(org.springframework.jdbc.core.JdbcTemplate.class);
        when(jdbc.update(anyString(), org.mockito.ArgumentMatchers.any(Object[].class))).thenAnswer(inv -> {
            Object[] a = (Object[]) inv.getRawArguments()[1];
            table.put(a[0] + "/" + a[1], Map.of("prompt", a[2], "answer", a[3]));
            return 1;
        });
        when(jdbc.queryForList(anyString(), org.mockito.ArgumentMatchers.any(Object[].class))).thenAnswer(inv -> {
            Object[] a = (Object[]) inv.getRawArguments()[1];
            Map<String, Object> row = table.get(a[0] + "/" + a[1]);
            return row == null ? List.of() : List.of(row);
        });
        week = new FoodWeek(entries, users, clock, openai, water, jdbc, throttle);
    }

    private UserRepository users;

    /** login_attempts as a map: the shared store every instance reads. */
    private final ThrottleStore throttle = new ThrottleStore() {
        private final Map<String, Attempt> rows = new java.util.HashMap<>();
        @Override public int countHit(String k, long w) { return 1; }
        @Override public void sweepCounters(long c) { }
        @Override public Attempt attempt(String k) { return rows.getOrDefault(k, Attempt.NONE); }
        @Override public void recordFailure(String k, java.util.function.IntUnaryOperator lock) {
            Attempt a = attempt(k);
            long now = System.currentTimeMillis();
            rows.put(k, new Attempt(a.failures() + 1, now + lock.applyAsInt(a.failures() + 1), now));
        }
        @Override public void clearAttempt(String k) { rows.remove(k); }
        @Override public void sweepAttempts(long c) { }
    };

    @Test
    void aFailedEstimateIsNotRetriedOnEveryOpen() {
        when(openai.complete(anyString(), anyList())).thenThrow(new IllegalStateException("AI gateway 401"));
        week.week(user);
        week.week(user);
        week.week(user);
        // Another instance, or this one restarted, shares the backoff.
        new FoodWeek(entries, users, clockFor(), openai, water, jdbc, throttle).week(user);
        verify(openai, times(1)).complete(anyString(), anyList());
        assertEquals(1, throttle.attempt(FoodWeek.backoffKey(user)).failures());
        // The screen still has numbers: the keyword table's (60 g carbs, 362 kcal),
        // scaled to the 400 kcal logged.
        assertEquals(66, week.week(user).days().get(6).carbsG());
    }

    @Test
    void anUnchangedWeekIsAnsweredFromTheLastCheck() {
        when(openai.complete(anyString(), anyList()))
                .thenReturn("{\"summary\":\"Add dal.\",\"add\":[\"Dal\"]}");
        DietCheckResponse first = week.check(user, null);
        DietCheckResponse again = week.check(user, null);
        verify(openai, times(1)).complete(anyString(), anyList());
        assertEquals("ai", again.source());
        assertEquals(first, again);
        // A restart: a new instance over the same table still costs nothing.
        FoodWeek restarted = new FoodWeek(entries, mock(UserRepository.class), clockFor(), openai, water, jdbc,
                throttle);
        assertEquals(first, restarted.check(user, null));
        verify(openai, times(1)).complete(anyString(), anyList());
    }

    @Test
    void aDayCheckReadsOnlyThatDayAndSaysSoToTheAi() {
        List<FoodEntry> todays = entries.findByUserIdAndLogDateBetween(user, today.minusDays(6), today);
        when(entries.findByUserIdAndLogDateBetween(user, today, today)).thenReturn(todays);
        when(water.totalsByDay(user, today.minusDays(6), today)).thenReturn(Map.of(today.minusDays(1), 2000));
        when(openai.complete(anyString(), anyList()))
                .thenReturn("{\"summary\":\"Add dal.\",\"add\":[\"Dal\"]}");
        DietCheckResponse r = week.check(user, today);
        assertEquals("ai", r.source());
        // Water was logged this week but not today: today's 0 ml is judged, not skipped.
        assertEquals("low", r.water());
        verify(openai).complete(anyString(), org.mockito.ArgumentMatchers.argThat(turns ->
                turns.get(0).toString().contains("still in progress")
                        && turns.get(0).toString().contains("Water ml a day (goal): 0 (2500)")));
        org.junit.jupiter.api.Assertions.assertThrows(com.growthbuddy.common.ApiException.class,
                () -> week.check(user, today.minusDays(7)));
    }

    @Test
    void aSuccessfulEstimateClearsTheBackoff() {
        throttle.recordFailure(FoodWeek.backoffKey(user), n -> -1); // a failure on record, lock already over
        when(openai.complete(anyString(), anyList()))
                .thenReturn("{\"items\":[{\"i\":1,\"proteinG\":8,\"carbsG\":60,\"fatG\":10,\"fiberG\":3}]}");
        week.week(user);
        assertEquals(ThrottleStore.Attempt.NONE, throttle.attempt(FoodWeek.backoffKey(user)));
    }

    @Test
    void waterIsLeftOutOnlyWhenTheFeatureIsOff() {
        when(openai.complete(anyString(), anyList()))
                .thenReturn("{\"summary\":\"Add dal.\",\"add\":[\"Dal\"]}");
        LocalDate yesterday = today.minusDays(1);
        List<FoodEntry> meals = entries.findByUserIdAndLogDateBetween(user, today.minusDays(6), today);
        when(entries.findByUserIdAndLogDateBetween(user, yesterday, yesterday)).thenReturn(meals);
        // On (the default) and nothing logged all week: 0 ml is judged, not skipped.
        assertEquals("low", week.check(user, today.minusDays(1)).water());
        com.growthbuddy.user.User off = new com.growthbuddy.user.User();
        off.setFeaturePrefs(Map.of("water", false));
        when(users.findById(user)).thenReturn(Optional.of(off));
        assertEquals(null, week.check(user, today.minusDays(1)).water());
        verify(openai).complete(anyString(), org.mockito.ArgumentMatchers.argThat(turns ->
                !turns.get(0).toString().contains("Water ml")));
    }

    private UserClock clockFor() {
        UserClock c = mock(UserClock.class);
        when(c.today(user)).thenReturn(today);
        when(c.zoneOf(user)).thenReturn(java.time.ZoneOffset.UTC);
        return c;
    }
}
