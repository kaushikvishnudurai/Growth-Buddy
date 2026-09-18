package com.growthbuddy.food;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.user.UserClock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * Two things about a logged meal that are easy to get wrong and invisible when
 * they are: which day it counts towards, and whether a number the user typed
 * survives contact with the estimator.
 */
class FoodEntryTest {

    private static final UUID USER = UUID.randomUUID();
    /** 19:10 UTC — which is already the NEXT day in IST. */
    private static final Instant EVENING = Instant.parse("2026-09-12T19:10:00Z");

    private final FoodEntryRepository entries = mock(FoodEntryRepository.class);
    private final UserClock clock = mock(UserClock.class);

    private FoodService serviceInZone(String zone) {
        when(clock.zoneOf(any())).thenReturn(ZoneId.of(zone));
        when(clock.today(any())).thenReturn(EVENING.atZone(ZoneId.of(zone)).toLocalDate());
        when(entries.save(any())).thenAnswer(i -> i.getArgument(0));
        when(entries.findByUserIdAndLogDateOrderByLoggedAtDesc(any(), any())).thenReturn(List.of());
        when(entries.totalCaloriesForDay(any(), any())).thenReturn(0);
        OpenAIClient openai = mock(OpenAIClient.class);
        when(openai.isConfigured()).thenReturn(false);
        return new FoodService(entries, mock(FoodPhotoLogRepository.class), openai, clock);
    }

    private FoodEntry saved() {
        ArgumentCaptor<FoodEntry> captor = ArgumentCaptor.forClass(FoodEntry.class);
        org.mockito.Mockito.verify(entries).save(captor.capture());
        return captor.getValue();
    }

    /**
     * The day was derived in UTC while the summary read it in another zone, so in
     * IST every meal logged after 5:30pm — dinner, the most logged meal there is —
     * was filed under yesterday and vanished from the Food screen on save.
     */
    @Test
    void anEveningMealCountsTowardsTheUsersDayNotUtc() {
        FoodService service = serviceInZone("Asia/Kolkata");
        service.addEntry(USER, new AddFoodEntryRequest("Dinner dosa", 250, MealType.home,
                null, null, null, EVENING, 420));
        assertThat(saved().getLogDate())
                .as("19:10 UTC is already the 13th in IST")
                .isEqualTo(LocalDate.of(2026, 9, 13));
    }

    @Test
    void andStillUtcForAUserWhoLivesThere() {
        FoodService service = serviceInZone("UTC");
        service.addEntry(USER, new AddFoodEntryRequest("Dinner", 250, MealType.home,
                null, null, null, EVENING, 420));
        assertThat(saved().getLogDate()).isEqualTo(LocalDate.of(2026, 9, 12));
    }

    /**
     * `loggedAt` exists so a meal can be filed under a day that has already
     * happened. The form caps its picker at today; this is the same rule for the
     * API, which anyone can POST to.
     */
    @Test
    void aMealCannotBeLoggedForADayThatHasNotHappened() {
        FoodService service = serviceInZone("UTC");
        assertThatThrownBy(() -> service.addEntry(USER, new AddFoodEntryRequest("Tomorrow's lunch",
                250, MealType.home, null, null, null, EVENING.plus(2, ChronoUnit.DAYS), 420)))
                .hasMessageContaining("hasn't happened yet");
    }

    /** Backdating still works, and lands on the day it was eaten. */
    @Test
    void aBackdatedMealLandsOnItsOwnDay() {
        FoodService service = serviceInZone("UTC");
        service.addEntry(USER, new AddFoodEntryRequest("Yesterday's dosa", 250, MealType.home,
                null, null, null, EVENING.minus(2, ChronoUnit.DAYS), 420));
        assertThat(saved().getLogDate()).isEqualTo(LocalDate.of(2026, 9, 10));
    }

    /** A typed number is the number. No clamp, no adjustment, no estimate. */
    @Test
    void typedCaloriesAreStoredExactly() {
        FoodService service = serviceInZone("UTC");
        service.addEntry(USER, new AddFoodEntryRequest("Protein bar", 200, MealType.home,
                null, null, null, EVENING, 347));
        FoodEntry e = saved();
        assertThat(e.getKcalEstimated()).isEqualTo(347);
        assertThat(e.getEstimateSource()).isEqualTo("manual");
    }

    /**
     * The derived per-100g figure is clamped, because the column CHECKs 40..900 —
     * 90 kcal of coffee over a 250g default works out at 36, which the database
     * refuses outright. The typed total is never touched by that.
     */
    @Test
    void theDerivedPer100gStaysInsideWhatTheColumnAccepts() {
        FoodService service = serviceInZone("UTC");
        service.addEntry(USER, new AddFoodEntryRequest("Filter coffee", 250, MealType.hotel,
                null, null, null, EVENING, 90));
        FoodEntry e = saved();
        assertThat(e.getKcalEstimated()).as("the typed total is exact").isEqualTo(90);
        assertThat(e.getKcalPer100g()).as("the derived figure is clamped").isBetween(40, 900);
    }

    /** No number typed: the estimator runs and the entry is not marked manual. */
    @Test
    void withoutATypedNumberTheEstimatorStillRuns() {
        FoodService service = serviceInZone("UTC");
        service.addEntry(USER, new AddFoodEntryRequest("Idli", 150, MealType.home,
                null, null, null, EVENING, null));
        assertThat(saved().getEstimateSource()).isNotEqualTo("manual");
    }

    @Test
    void theSummaryDefaultsToTheUsersDay() {
        FoodService service = serviceInZone("Asia/Kolkata");
        assertThat(service.summary(USER, null).date()).isEqualTo(LocalDate.of(2026, 9, 13));
        assertThat(service.summary(USER, LocalDate.of(2026, 1, 1)).date())
                .as("an explicit date still wins")
                .isEqualTo(LocalDate.of(2026, 1, 1));
        org.mockito.Mockito.verify(entries, org.mockito.Mockito.never()).save(any());
    }
}
