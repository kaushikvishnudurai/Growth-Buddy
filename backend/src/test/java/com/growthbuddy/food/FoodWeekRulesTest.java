package com.growthbuddy.food;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The numbers behind the Summary screen, and the no-AI diet check. */
class FoodWeekRulesTest {

    private static final Nutrients TARGET = new Nutrients(112, 325, 87, 30);

    @Test
    void aRiceHeavyWeekIsLightOnProteinAndFiber() {
        DietCheckResponse r = FoodWeek.rules(new Nutrients(79, 400, 72, 14), TARGET);
        assertEquals("low", r.protein());
        assertEquals("high", r.carbs());
        assertEquals("ok", r.fat());
        assertEquals("low", r.fiber());
        assertTrue(r.summary().contains("light on protein and fiber"));
        assertTrue(r.summary().contains("heavy on carbs"));
        assertTrue(r.add().size() <= 4);
        // Every gap the summary names keeps a tip, even past the cap.
        assertTrue(r.add().contains("Half a serving less rice, more vegetables"));
    }

    @Test
    void aLowGapAlwaysGetsATip() {
        DietCheckResponse r = FoodWeek.rules(new Nutrients(112, 200, 40, 30), TARGET);
        assertTrue(r.summary().contains("light on carbs and fat"));
        assertEquals(2, r.add().size());
    }

    @Test
    void onTargetSaysSo() {
        DietCheckResponse r = FoodWeek.rules(TARGET, TARGET);
        assertEquals(List.of("ok", "ok", "ok", "ok"), List.of(r.protein(), r.carbs(), r.fat(), r.fiber()));
        assertTrue(r.add().isEmpty());
    }

    @Test
    void waterIsJudgedOnlyWhenGiven() {
        DietCheckResponse dry = FoodWeek.rules(TARGET, TARGET, "That day", 900, 2500);
        assertEquals("low", dry.water());
        assertTrue(dry.summary().startsWith("That day looks light on water"), dry.summary());
        assertEquals(List.of("A glass of water with each meal"), dry.add());
        assertTrue(FoodWeek.rules(TARGET, TARGET, "That day", 2500, 2500).summary().contains("water is on track"));
        assertEquals(null, FoodWeek.rules(TARGET, TARGET).water());
    }

    @Test
    void fiveGapsKeepFiveTips() {
        // Light on protein, carbs and fiber, heavy on fat, and short on water.
        DietCheckResponse r = FoodWeek.rules(new Nutrients(20, 100, 120, 5), TARGET, "That day", 900, 2500);
        assertEquals(5, r.add().size(), r.add().toString());
        assertTrue(r.add().contains("A glass of water with each meal"));
        assertTrue(r.summary().contains("water, and heavy on fat"), r.summary());
    }

    @Test
    void aDayCheckNamesTheDayNotTheWeek() {
        DietCheckResponse r = FoodWeek.rules(new Nutrients(20, 400, 72, 14), TARGET, "Today so far");
        assertTrue(r.summary().startsWith("Today so far looks light on protein"), r.summary());
    }

    @Test
    void todayIsJudgedAgainstTheShareOfTheWakingDayGone() {
        assertEquals(0.25, FoodWeek.dayShare(java.time.LocalTime.of(5, 0)));
        assertEquals(0.25, FoodWeek.dayShare(java.time.LocalTime.of(9, 30)));
        assertEquals(0.5, FoodWeek.dayShare(java.time.LocalTime.of(15, 0)));
        assertEquals(0.5, FoodWeek.dayShare(java.time.LocalTime.of(15, 59)), "whole hours, so the prompt holds");
        assertEquals(1.0, FoodWeek.dayShare(java.time.LocalTime.of(23, 30)));
        // Breakfast and lunch by 15:00: half a day's protein is on track, not light...
        Nutrients half = new Nutrients(56, 160, 43, 15);
        DietCheckResponse r = FoodWeek.rules(half, TARGET, "Today so far", 1250, 2500, 0.5);
        assertEquals(List.of("ok", "ok", "ok", "ok", "ok"), List.of(r.protein(), r.carbs(), r.fat(), r.fiber(), r.water()));
        // ...which it would be against the full day.
        assertEquals("low", FoodWeek.rules(half, TARGET, "Today so far").protein());
        // "High" stays against the full day: a big lunch is not heavy at 13:00.
        assertEquals("ok", FoodWeek.level(300, 325, 0.375));
        assertEquals("high", FoodWeek.level(400, 325, 0.375));
    }

    @Test
    void onlyTodayMeansNoFinishedDayHasMeals() {
        FoodWeekDay empty = new FoodWeekDay("2026-10-01", 0, 0, 0, 0, 0, 0);
        FoodWeekDay eaten = new FoodWeekDay("2026-10-02", 500, 2, 10, 60, 10, 4);
        assertTrue(FoodWeek.averagesOnlyToday(List.of(empty, eaten)));
        assertTrue(!FoodWeek.averagesOnlyToday(List.of(eaten, eaten)));
        assertTrue(!FoodWeek.averagesOnlyToday(List.of(eaten, empty)));
    }

    @Test
    void waterIsJudgedUnlessTheFeatureIsOff() {
        com.growthbuddy.user.User u = new com.growthbuddy.user.User();
        assertTrue(FoodWeek.waterOn(null));
        assertTrue(FoodWeek.waterOn(u));
        u.setFeaturePrefs(java.util.Map.of("water", true, "food", false));
        assertTrue(FoodWeek.waterOn(u));
        u.setFeaturePrefs(java.util.Map.of("water", false));
        assertTrue(!FoodWeek.waterOn(u));
    }

    @Test
    void keywordsMatchWordStartsOnly() {
        assertTrue(FoodWeek.mentions("2 Eggs", List.of("egg")));
        assertTrue(!FoodWeek.mentions("Veggie wrap", List.of("egg")));
        assertTrue(!FoodWeek.mentions("Non veg biryani", List.of("veg")));
        assertTrue(!FoodWeek.mentions("Non-veg meals", List.of("veg")));
        assertTrue(FoodWeek.mentions("Mixed veg curry", List.of("veg")));
    }

    @Test
    void guessTakesTheFirstMatchingKeyword() {
        // Chicken, not rice: 18/3/10/0.5 per 100 g over 300 g.
        assertArrayEquals(new int[] {54, 9, 30, 2}, FoodWeek.guess("Chicken fried rice", 300));
        // Biryani before chicken or veg: it is mostly rice.
        assertEquals(50, FoodWeek.guess("Chicken biryani", 200)[1]);
        assertEquals(50, FoodWeek.guess("Veg biryani", 200)[1]);
        // Unknown dish: the 4/15/4/1.5 default.
        assertArrayEquals(new int[] {10, 38, 10, 4}, FoodWeek.guess("Kozhukattai", 250));
    }

    @Test
    void storedGramsWinOverTheGuess() {
        FoodEntry e = entry("Dosa");
        e.setProteinG(20);
        int[] g = FoodWeek.grams(e);
        assertEquals(20, g[0]);
        assertEquals(60, g[1]);
    }

    @Test
    void gramsAddUpToTheLoggedCalories() {
        // The AI said 10/40/8/3 (272 kcal) for a 700 kcal plate: the kcal wins.
        FoodEntry e = entry("Chicken fried rice");
        e.setKcalEstimated(700);
        e.setProteinG(10);
        e.setCarbsG(40);
        e.setFatG(8);
        e.setFiberG(3);
        int[] g = FoodWeek.grams(e);
        assertArrayEquals(new int[] {26, 103, 21, 8}, g);
        assertTrue(Math.abs(4 * g[0] + 4 * g[1] + 9 * g[2] - 700) < 15);
    }

    @Test
    void sourcesGroupSameDishAndKeepTopFive() {
        List<FoodEntry> all = new ArrayList<>();
        for (String n : List.of("Dosa", "dosa ", "Chicken curry", "Rice", "Egg", "Paneer", "Dal", "Idli")) {
            all.add(entry(n));
        }
        List<NutrientSource> protein = FoodWeek.sources(all, 0);
        assertEquals(5, protein.size());
        assertEquals("Chicken curry", protein.get(0).name());
        assertTrue(protein.stream().anyMatch(s -> s.name().equals("Dosa") && s.count() == 2));
        // Carbs: two dosas (120 g) outrank a plate of rice (56 g).
        assertEquals("Dosa", FoodWeek.sources(all, 1).get(0).name());
    }

    @Test
    void averageSkipsTodayUnlessItIsAllThereIs() {
        FoodWeekDay empty = day(0, 0);
        FoodWeekDay today = day(1, 10);
        List<FoodWeekDay> week = List.of(day(1, 100), empty, day(2, 50), today);
        assertEquals(75, FoodWeek.average(week).proteinG());
        assertEquals(10, FoodWeek.average(List.of(empty, empty, today)).proteinG());
        assertEquals(0, FoodWeek.average(List.of(empty, empty)).proteinG());
    }

    @Test
    void targetsFollowWeightGoalAndCalories() {
        com.growthbuddy.user.User u = new com.growthbuddy.user.User();
        assertEquals(60, FoodWeek.proteinTarget(u));
        u.setWeightKg(70);
        assertEquals(84, FoodWeek.proteinTarget(u));
        u.setFitnessGoal("Gain weight , dirty bulk");
        assertEquals(new Nutrients(112, 325, 87, 30), FoodWeek.targets(u, 2600));
    }

    private static FoodEntry entry(String name) {
        FoodEntry e = new FoodEntry();
        e.setFoodName(name);
        e.setQuantityGrams(200);
        return e;
    }

    /** A long AI tip is cut at a word with an ellipsis, never mid-word ("peanuts or ch"). */
    @Test
    void aLongTipIsCutAtAWord() {
        String tip = "Replace lays packets and biscuits with roasted peanuts or chana for snacks";
        String cut = FoodWeek.cap(tip, 60);
        assertTrue(cut.endsWith("\u2026"), cut);
        assertTrue(cut.length() <= 60, cut);
        assertEquals("Replace lays packets and biscuits with roasted peanuts or\u2026", cut);
        assertEquals("Short tip", FoodWeek.cap("Short tip", 60));
    }

    private static FoodWeekDay day(int count, int protein) {
        return new FoodWeekDay("2026-10-01", protein * 10, count, protein, 0, 0, 0);
    }
}
