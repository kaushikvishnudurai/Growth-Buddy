package com.growthbuddy.food;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.LocalDate;
import java.util.List;
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

    @BeforeEach
    void setUp() {
        entries = mock(FoodEntryRepository.class);
        UserRepository users = mock(UserRepository.class);
        UserClock clock = mock(UserClock.class);
        openai = mock(OpenAIClient.class);
        when(clock.today(user)).thenReturn(today);
        when(users.findById(any())).thenReturn(Optional.empty());
        when(openai.isConfigured()).thenReturn(true);
        FoodEntry e = new FoodEntry();
        e.setId(UUID.randomUUID());
        e.setFoodName("Dosa");
        e.setQuantityGrams(200);
        e.setKcalEstimated(400);
        e.setLogDate(today);
        when(entries.findByUserIdAndLogDateBetween(user, today.minusDays(6), today)).thenReturn(List.of(e));
        week = new FoodWeek(entries, users, clock, openai);
    }

    @Test
    void aFailedEstimateIsNotRetriedOnEveryOpen() {
        when(openai.complete(anyString(), anyList())).thenThrow(new IllegalStateException("AI gateway 401"));
        week.week(user);
        week.week(user);
        week.week(user);
        verify(openai, times(1)).complete(anyString(), anyList());
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
    }

    @Test
    void aDayCheckReadsOnlyThatDayAndSaysSoToTheAi() {
        List<FoodEntry> todays = entries.findByUserIdAndLogDateBetween(user, today.minusDays(6), today);
        when(entries.findByUserIdAndLogDateBetween(user, today, today)).thenReturn(todays);
        when(openai.complete(anyString(), anyList()))
                .thenReturn("{\"summary\":\"Add dal.\",\"add\":[\"Dal\"]}");
        assertEquals("ai", week.check(user, today).source());
        verify(openai).complete(anyString(), org.mockito.ArgumentMatchers.argThat(turns ->
                turns.get(0).toString().contains("still in progress")));
        org.junit.jupiter.api.Assertions.assertThrows(com.growthbuddy.common.ApiException.class,
                () -> week.check(user, today.minusDays(7)));
    }
}
