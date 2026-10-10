package com.growthbuddy.food;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.user.UserClock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** Meal slots, copying yesterday's slot, favourites' ownership and the barcode mapping. */
class FoodSlotFavouriteBarcodeTest {

    private static final UUID USER = UUID.randomUUID();
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 10);

    private final FoodEntryRepository entries = mock(FoodEntryRepository.class);
    private final FoodFavouriteRepository favs = mock(FoodFavouriteRepository.class);
    private final UserClock clock = mock(UserClock.class);
    private final OpenAIClient openai = mock(OpenAIClient.class);
    private FoodService service;

    @BeforeEach
    void setUp() {
        when(clock.zoneOf(any())).thenReturn(IST);
        when(clock.today(any())).thenReturn(TODAY);
        when(entries.save(any())).thenAnswer(i -> i.getArgument(0));
        when(entries.findByUserIdAndLogDateOrderByLoggedAtDesc(any(), any())).thenReturn(List.of());
        when(favs.save(any())).thenAnswer(i -> i.getArgument(0));
        when(favs.findByUserIdOrderByCreatedAtDesc(any())).thenReturn(List.of());
        when(favs.findFirstByUserIdAndFoodNameIgnoreCase(any(), any())).thenReturn(Optional.empty());
        service = new FoodService(entries, mock(FoodPhotoLogRepository.class), favs, openai, clock);
    }

    private FoodEntry savedEntry() {
        ArgumentCaptor<FoodEntry> c = ArgumentCaptor.forClass(FoodEntry.class);
        verify(entries).save(c.capture());
        return c.getValue();
    }

    private static Instant at(LocalDate day, int hour, int minute) {
        return day.atTime(hour, minute).atZone(IST).toInstant();
    }

    // ---- slots ----

    @Test
    void theHourOfDayPicksTheSlot() {
        assertThat(MealSlot.forHour(7)).isEqualTo(MealSlot.breakfast);
        assertThat(MealSlot.forHour(4)).isEqualTo(MealSlot.breakfast);
        assertThat(MealSlot.forHour(11)).isEqualTo(MealSlot.lunch);
        assertThat(MealSlot.forHour(15)).isEqualTo(MealSlot.lunch);
        assertThat(MealSlot.forHour(16)).isEqualTo(MealSlot.snack);
        assertThat(MealSlot.forHour(18)).isEqualTo(MealSlot.dinner);
        assertThat(MealSlot.forHour(22)).isEqualTo(MealSlot.dinner);
        assertThat(MealSlot.forHour(23)).isEqualTo(MealSlot.snack);
        assertThat(MealSlot.forHour(2)).isEqualTo(MealSlot.snack);
    }

    @Test
    void anEntryWithNoSlotTakesTheUsersLocalHourNotUtcs() {
        // 20:30 IST is 15:00 UTC: UTC would call dinner lunch.
        service.addEntry(USER, new AddFoodEntryRequest("Chapati", 120, MealType.home, null, null, null,
                at(TODAY, 20, 30), 250, null));
        assertThat(savedEntry().getMealSlot()).isEqualTo(MealSlot.dinner);
    }

    @Test
    void aChosenSlotWins() {
        service.addEntry(USER, new AddFoodEntryRequest("Upma", 200, MealType.home, null, null, null,
                at(TODAY, 20, 30), 300, null, MealSlot.breakfast, null, null, null, null, null, null));
        assertThat(savedEntry().getMealSlot()).isEqualTo(MealSlot.breakfast);
    }

    @Test
    void labelNutrientsAreKeptOnlyWithTypedCalories() {
        service.addEntry(USER, new AddFoodEntryRequest("Biscuits", 50, MealType.home, null, null, null,
                at(TODAY, 17, 0), 240, null, null, 3, 35, 10, 1, 12, 180));
        FoodEntry e = savedEntry();
        assertThat(e.getSugarG()).isEqualTo(12);
        assertThat(e.getSodiumMg()).isEqualTo(180);
        assertThat(e.getProteinG()).isEqualTo(3);
        assertThat(e.getEstimateSource()).isEqualTo("manual");
    }

    @Test
    void anEditCanMoveAnEntryToAnotherSlot() {
        FoodEntry e = entry("Dosa", MealSlot.breakfast, at(TODAY, 8, 0));
        when(entries.findById(e.getId())).thenReturn(Optional.of(e));
        service.updateEntry(USER, e.getId(), new UpdateFoodEntryRequest(null, null, null, null, null, null,
                MealSlot.dinner));
        assertThat(e.getMealSlot()).isEqualTo(MealSlot.dinner);
    }

    @Test
    void theDaySummaryAddsOnlyTheFiguresItHas() {
        FoodEntry a = entry("Oats", MealSlot.breakfast, at(TODAY, 8, 0));
        a.setFiberG(4);
        FoodEntry b = entry("Chips", MealSlot.snack, at(TODAY, 17, 0));
        b.setFiberG(1);
        b.setSodiumMg(300);
        when(entries.findByUserIdAndLogDateOrderByLoggedAtDesc(USER, TODAY)).thenReturn(List.of(b, a));
        FoodSummaryResponse s = service.summary(USER, TODAY);
        assertThat(s.fiberG()).isEqualTo(5);
        assertThat(s.sodiumMg()).isEqualTo(300);
        assertThat(s.sugarG()).as("no entry carries sugar: unknown, not 0").isNull();
    }

    // ---- copy yesterday's slot ----

    @Test
    void copyingASlotCopiesOnlyThatSlotAsManualCalories() {
        LocalDate y = TODAY.minusDays(1);
        FoodEntry idli = entry("Idli", MealSlot.breakfast, at(y, 8, 0));
        idli.setEstimateSource("ai-estimate");
        idli.setProteinG(6);
        // A row from before slots: its 08:30 makes it breakfast too.
        FoodEntry old = entry("Coffee", null, at(y, 8, 30));
        FoodEntry lunch = entry("Rice", MealSlot.lunch, at(y, 13, 0));
        when(entries.findByUserIdAndLogDate(USER, y)).thenReturn(List.of(lunch, old, idli));

        service.copySlot(USER, MealSlot.breakfast, null, null);

        ArgumentCaptor<FoodEntry> c = ArgumentCaptor.forClass(FoodEntry.class);
        verify(entries, org.mockito.Mockito.times(2)).save(c.capture());
        assertThat(c.getAllValues()).extracting(FoodEntry::getFoodName).containsExactly("Idli", "Coffee");
        FoodEntry copy = c.getAllValues().get(0);
        assertThat(copy.getId()).as("a new row, not the old one").isNull();
        assertThat(copy.getLogDate()).isEqualTo(TODAY);
        assertThat(copy.getEstimateSource()).isEqualTo("manual");
        assertThat(copy.getKcalEstimated()).isEqualTo(idli.getKcalEstimated());
        assertThat(copy.getProteinG()).isEqualTo(6);
        assertThat(copy.getMealSlot()).isEqualTo(MealSlot.breakfast);
        verify(openai, never()).isConfigured();
    }

    @Test
    void copyingAnEmptySlotSaysSo() {
        when(entries.findByUserIdAndLogDate(any(), any())).thenReturn(List.of());
        assertThatThrownBy(() -> service.copySlot(USER, MealSlot.dinner, null, null))
                .isInstanceOf(ApiException.class);
        verify(entries, never()).save(any());
    }

    // ---- favourites ----

    @Test
    void starringAnEntryCopiesItsFigures() {
        FoodEntry e = entry("Paneer roll", MealSlot.lunch, at(TODAY, 13, 0));
        e.setProteinG(18);
        when(entries.findById(e.getId())).thenReturn(Optional.of(e));
        service.addFavourite(USER, e.getId());
        ArgumentCaptor<FoodFavourite> c = ArgumentCaptor.forClass(FoodFavourite.class);
        verify(favs).save(c.capture());
        FoodFavourite f = c.getValue();
        assertThat(f.getUserId()).isEqualTo(USER);
        assertThat(f.getFoodName()).isEqualTo("Paneer roll");
        assertThat(f.getKcal()).isEqualTo(e.getKcalEstimated());
        assertThat(f.getQuantityGrams()).isEqualTo(e.getQuantityGrams());
        assertThat(f.getProteinG()).isEqualTo(18);
    }

    @Test
    void nobodyCanStarSomeoneElsesEntry() {
        FoodEntry e = entry("Theirs", MealSlot.lunch, at(TODAY, 13, 0));
        e.setUserId(UUID.randomUUID());
        when(entries.findById(e.getId())).thenReturn(Optional.of(e));
        assertThatThrownBy(() -> service.addFavourite(USER, e.getId())).isInstanceOf(ApiException.class);
        verify(favs, never()).save(any());
    }

    @Test
    void nobodyCanDeleteSomeoneElsesFavourite() {
        FoodFavourite f = new FoodFavourite();
        f.setId(UUID.randomUUID());
        f.setUserId(UUID.randomUUID());
        when(favs.findById(f.getId())).thenReturn(Optional.of(f));
        assertThatThrownBy(() -> service.deleteFavourite(USER, f.getId())).isInstanceOf(ApiException.class);
        verify(favs, never()).delete(any());
    }

    @Test
    void starringANameAgainRefreshesItInsteadOfDuplicating() {
        FoodFavourite existing = new FoodFavourite();
        existing.setId(UUID.randomUUID());
        existing.setUserId(USER);
        existing.setFoodName("dosa");
        existing.setKcal(100);
        when(favs.findFirstByUserIdAndFoodNameIgnoreCase(USER, "Dosa")).thenReturn(Optional.of(existing));
        FoodEntry e = entry("Dosa", MealSlot.breakfast, at(TODAY, 8, 0));
        when(entries.findById(e.getId())).thenReturn(Optional.of(e));
        service.addFavourite(USER, e.getId());
        assertThat(existing.getKcal()).isEqualTo(e.getKcalEstimated());
        verify(favs, never()).countByUserId(any());
    }

    @Test
    void theFavouriteListIsCapped() {
        when(favs.countByUserId(USER)).thenReturn((long) FoodService.MAX_FAVOURITES);
        FoodEntry e = entry("One more", MealSlot.lunch, at(TODAY, 13, 0));
        when(entries.findById(e.getId())).thenReturn(Optional.of(e));
        assertThatThrownBy(() -> service.addFavourite(USER, e.getId())).isInstanceOf(ApiException.class);
    }

    // ---- barcode ----

    @Test
    void aProductMapsToPer100gFiguresWithSodiumInMilligrams() throws Exception {
        String body = """
                {"status":1,"product":{"product_name":"Marie biscuits","brands":"Britannia, Other",
                 "serving_quantity":"25",
                 "nutriments":{"energy-kcal_100g":443,"proteins_100g":7.5,"carbohydrates_100g":76,
                   "fat_100g":12.3,"fiber_100g":"2.1","sugars_100g":22,"sodium_100g":0.36}}}
                """;
        BarcodeProduct p = FoodService.barcodeFrom(new ObjectMapper().readTree(body), "8901063010000");
        assertThat(p.name()).isEqualTo("Britannia Marie biscuits");
        assertThat(p.kcalPer100g()).isEqualTo(443);
        assertThat(p.proteinPer100g()).isEqualTo(7.5);
        assertThat(p.fiberPer100g()).as("a quoted number still counts").isEqualTo(2.1);
        assertThat(p.sugarPer100g()).isEqualTo(22.0);
        assertThat(p.sodiumMgPer100g()).isEqualTo(360);
        assertThat(p.servingGrams()).isEqualTo(25);
    }

    @Test
    void kilojoulesAndSaltStandInWhenTheLabelLacksKcalAndSodium() throws Exception {
        String body = """
                {"status":1,"product":{"product_name":"Oat drink",
                 "nutriments":{"energy_100g":200,"salt_100g":0.1}}}
                """;
        BarcodeProduct p = FoodService.barcodeFrom(new ObjectMapper().readTree(body), "123456");
        assertThat(p.kcalPer100g()).as("200 kJ is 48 kcal").isEqualTo(48);
        assertThat(p.sodiumMgPer100g()).isEqualTo(40);
        assertThat(p.sugarPer100g()).isNull();
        assertThat(p.servingGrams()).isNull();
    }

    @Test
    void anUnknownOrNamelessProductIsNotAProduct() throws Exception {
        ObjectMapper m = new ObjectMapper();
        assertThat(FoodService.barcodeFrom(m.readTree("{\"status\":0,\"status_verbose\":\"product not found\"}"),
                "123456")).isNull();
        assertThat(FoodService.barcodeFrom(m.readTree("{\"status\":1,\"product\":{\"product_name\":\"\"}}"),
                "123456")).isNull();
    }

    @Test
    void aBarcodeIsDigitsOnly() {
        assertThatThrownBy(() -> service.barcode("12ab")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.barcode("../../x")).isInstanceOf(ApiException.class);
    }

    private static FoodEntry entry(String name, MealSlot slot, Instant loggedAt) {
        FoodEntry e = new FoodEntry();
        e.setId(UUID.randomUUID());
        e.setUserId(USER);
        e.setFoodName(name);
        e.setQuantityGrams(150);
        e.setKcalPer100g(200);
        e.setKcalEstimated(300);
        e.setEstimateSource("table");
        e.setMealType(MealType.home);
        e.setMealSlot(slot);
        e.setLoggedAt(loggedAt);
        e.setLogDate(loggedAt.atZone(IST).toLocalDate());
        return e;
    }
}
