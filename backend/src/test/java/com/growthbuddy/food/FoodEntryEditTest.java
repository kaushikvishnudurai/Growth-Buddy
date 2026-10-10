package com.growthbuddy.food;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.user.UserClock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Editing a logged meal, and a typed calorie figure never costing an AI call. */
class FoodEntryEditTest {

    private static final UUID USER = UUID.randomUUID();
    // The real day: addEntry stamps Instant.now(), so a pinned date fails the day after.
    private static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Kolkata"));

    private final FoodEntryRepository entries = mock(FoodEntryRepository.class);
    private final UserClock clock = mock(UserClock.class);
    private final OpenAIClient openai = mock(OpenAIClient.class);
    private FoodService service;

    @BeforeEach
    void setUp() {
        when(clock.zoneOf(any())).thenReturn(ZoneId.of("Asia/Kolkata"));
        when(clock.today(any())).thenReturn(TODAY);
        when(entries.save(any())).thenAnswer(i -> i.getArgument(0));
        when(entries.findByUserIdAndLogDateOrderByLoggedAtDesc(any(), any())).thenReturn(List.of());
        when(entries.totalCaloriesForDay(any(), any())).thenReturn(0);
        when(openai.isConfigured()).thenReturn(true);
        service = new FoodService(entries, mock(FoodPhotoLogRepository.class), mock(FoodFavouriteRepository.class), openai, clock);
    }

    private FoodEntry stored() {
        FoodEntry e = new FoodEntry();
        e.setId(UUID.randomUUID());
        e.setUserId(USER);
        e.setFoodName("Dosa");
        e.setQuantityGrams(200);
        e.setKcalPer100g(150);
        e.setKcalEstimated(300);
        e.setEstimateSource("table");
        e.setMealType(MealType.home);
        e.setLogDate(TODAY);
        e.setProteinG(8);
        when(entries.findById(e.getId())).thenReturn(Optional.of(e));
        return e;
    }

    @Test
    void typedCaloriesWithoutGramsAskTheAiNothing() {
        // The grams used to be asked of the AI even when the calories were typed.
        service.addEntry(USER, new AddFoodEntryRequest("Protein bar", null, MealType.home,
                null, null, null, null, 210, null));
        verify(openai, never()).isConfigured();
    }

    @Test
    void newGramsRescaleTheEntrysOwnRateAndClearItsNutrients() {
        FoodEntry e = stored();
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(null, 300, null, null, null, null));
        assertThat(e.getKcalEstimated()).isEqualTo(450);
        assertThat(e.getProteinG()).as("refilled by FoodWeek for the new portion").isNull();
        assertThat(e.getEstimateSource()).isEqualTo("table");
    }

    @Test
    void typedCaloriesAreKeptAsTyped() {
        FoodEntry e = stored();
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(null, null, 380, MealType.hotel, null, null));
        assertThat(e.getKcalEstimated()).isEqualTo(380);
        assertThat(e.getKcalPer100g()).isEqualTo(190);
        assertThat(e.getEstimateSource()).isEqualTo("manual");
        assertThat(e.getMealType()).isEqualTo(MealType.hotel);
        assertThat(e.getProteinG()).as("same food, same grams: nutrients stay").isEqualTo(8);
    }

    @Test
    void anEntryMovesToAPastDayButNotAFutureOne() {
        FoodEntry e = stored();
        service.updateEntry(USER, e.getId(),
                new UpdateFoodEntryRequest(null, null, null, null, TODAY.minusDays(2), null));
        assertThat(e.getLogDate()).isEqualTo(TODAY.minusDays(2));
        assertThat(e.getLoggedAt().atZone(ZoneId.of("Asia/Kolkata")).toLocalDate()).isEqualTo(TODAY.minusDays(2));
        assertThatThrownBy(() -> service.updateEntry(USER, e.getId(),
                new UpdateFoodEntryRequest(null, null, null, null, TODAY.plusDays(1), null)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void someoneElsesEntryIsRefused() {
        FoodEntry e = stored();
        assertThatThrownBy(() -> service.updateEntry(UUID.randomUUID(), e.getId(),
                new UpdateFoodEntryRequest("Idli", null, null, null, null, null)))
                .isInstanceOf(ApiException.class);
    }
}
