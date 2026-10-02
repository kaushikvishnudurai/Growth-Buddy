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
    }

    @Test
    void onTargetSaysSo() {
        DietCheckResponse r = FoodWeek.rules(TARGET, TARGET);
        assertEquals(List.of("ok", "ok", "ok", "ok"), List.of(r.protein(), r.carbs(), r.fat(), r.fiber()));
        assertTrue(r.add().isEmpty());
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

    private static FoodWeekDay day(int count, int protein) {
        return new FoodWeekDay("2026-10-01", protein * 10, count, protein, 0, 0, 0);
    }
}
