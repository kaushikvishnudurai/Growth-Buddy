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
    void newGramsRescaleTheEntrysKcalAndNutrients() {
        FoodEntry e = stored();
        e.setSugarG(4);
        e.setSodiumMg(300);
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(null, 300, null, null, null, null));
        assertThat(e.getKcalEstimated()).isEqualTo(450);
        assertThat(e.getProteinG()).as("the same food, half as much again").isEqualTo(12);
        assertThat(e.getSugarG()).isEqualTo(6);
        assertThat(e.getSodiumMg()).isEqualTo(450);
        assertThat(e.getCarbsG()).as("a missing one stays for FoodWeek's batch").isNull();
        assertThat(e.getEstimateSource()).isEqualTo("table");
    }

    @Test
    void gramsRescaleByTheEntrysKcalNotItsFlooredRate() {
        // 250 g of green tea at 2 kcal stores 40 kcal/100 g (the column's floor);
        // doubling it used to save 200 kcal.
        FoodEntry e = stored();
        e.setFoodName("Green tea");
        e.setQuantityGrams(250);
        e.setKcalEstimated(2);
        e.setKcalPer100g(40);
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(null, 500, null, null, null, null));
        assertThat(e.getKcalEstimated()).isEqualTo(4);
    }

    @Test
    void aRenameClearsAllSixNutrientsButACaseOnlyOneNone() {
        FoodEntry e = stored();
        e.setSugarG(4);
        e.setSodiumMg(300);
        e.setPieces(2);
        e.setPieceGrams(100.0);
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(" dosa ", null, null, null, null, null));
        assertThat(e.getFoodName()).isEqualTo("dosa");
        assertThat(e.getProteinG()).as("same food").isEqualTo(8);
        assertThat(e.getSodiumMg()).isEqualTo(300);
        assertThat(e.getPieceGrams()).as("its own piece weight kept").isEqualTo(100.0);
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest("Idli", null, null, null, null, null));
        assertThat(e.getProteinG()).isNull();
        assertThat(e.getSugarG()).isNull();
        assertThat(e.getSodiumMg()).isNull();
        assertThat(e.getPieceGrams()).isEqualTo((double) FoodWeek.gramsPerPiece("Idli"));
    }

    @Test
    void aClampedCountKeepsItsPieceWeightThroughEdits() {
        // 30 pieces of 100 g store 2000 g (the column's ceiling). Down to 10 is
        // 1000 g, not 2000 / 30 * 10 = 667, and back up to 30 is 2000 again.
        org.mockito.ArgumentCaptor<FoodEntry> saved = org.mockito.ArgumentCaptor.forClass(FoodEntry.class);
        service.addEntry(USER, new AddFoodEntryRequest("Momo", null, MealType.home,
                null, null, null, null, 1500, 30));
        verify(entries).save(saved.capture());
        FoodEntry e = saved.getValue();
        e.setId(UUID.randomUUID());
        when(entries.findById(e.getId())).thenReturn(Optional.of(e));
        assertThat(e.getQuantityGrams()).isEqualTo(2000);
        assertThat(e.getPieceGrams()).isEqualTo(100.0);
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(null, null, null, null, null, null, null, 10));
        assertThat(e.getQuantityGrams()).isEqualTo(1000);
        assertThat(e.getKcalEstimated()).isEqualTo(750);
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(null, null, null, null, null, null, null, 30));
        assertThat(e.getQuantityGrams()).isEqualTo(2000);
        assertThat(e.getKcalEstimated()).isEqualTo(1500);
    }

    @Test
    void aFractionalPieceWeightDoesNotDriftAcrossCountEdits() {
        // A label's 33.3 g biscuit: 3 store 100 g. Rounding the stored total and
        // dividing again drifted a gram or two per edit.
        org.mockito.ArgumentCaptor<FoodEntry> saved = org.mockito.ArgumentCaptor.forClass(FoodEntry.class);
        service.addEntry(USER, new AddFoodEntryRequest("Biscuit", 100, MealType.home, null, null, null, null,
                480, 3, null, null, null, null, null, null, null, 33.3));
        verify(entries).save(saved.capture());
        FoodEntry e = saved.getValue();
        e.setId(UUID.randomUUID());
        when(entries.findById(e.getId())).thenReturn(Optional.of(e));
        for (int n : new int[] {7, 2, 11, 5, 9}) {
            service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(null, null, null, null, null, null, null, n));
            assertThat(e.getQuantityGrams()).isEqualTo((int) Math.round(n * 33.3));
        }
        // Grams typed beside the count re-weigh the piece and keep the count.
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(null, 135, null, null, null, null, null, 9));
        assertThat(e.getPieces()).isEqualTo(9);
        assertThat(e.getPieceGrams()).isEqualTo(15.0);
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

    /** "Idli (120g)" was the bug: the count was never stored. It is now, and comes back. */
    @Test
    void piecesAreStoredReturnedAndClearedByWeighing() {
        org.mockito.ArgumentCaptor<FoodEntry> saved = org.mockito.ArgumentCaptor.forClass(FoodEntry.class);
        service.addEntry(USER, new AddFoodEntryRequest("Idli", 120, MealType.home,
                null, null, null, null, 160, 2));
        verify(entries).save(saved.capture());
        assertThat(FoodEntryResponse.from(saved.getValue()).pieces()).isEqualTo(2);

        FoodEntry e = stored();
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(null, null, null, null, null, null, null, 3));
        assertThat(e.getPieces()).isEqualTo(3);
        assertThat(e.getQuantityGrams()).as("grams follow the count").isEqualTo(3 * FoodWeek.gramsPerPiece("Dosa"));
        e.setQuantityGrams(30); // 3 pcs off a label: 10 g each
        e.setPieceGrams(10.0);
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(null, null, null, null, null, null, null, 4));
        assertThat(e.getQuantityGrams()).as("the entry's own piece weight, not the guess").isEqualTo(40);
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(null, 250, null, null, null, null));
        assertThat(e.getPieces()).as("weighed now").isNull();
    }
}
