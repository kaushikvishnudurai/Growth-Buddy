package com.growthbuddy.food;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/** The no-AI diet check: what it says when the gateway is down or out of budget. */
class FoodWeekRulesTest {

    @Test
    void aWeekOfRiceAndDosaIsLowOnBoth() {
        DietCheckResponse r = FoodWeek.rules(List.of("Rice", "Dosa", "Poori", "Bread", "Rice"));
        assertEquals("low", r.protein());
        assertEquals("low", r.fiber());
        assertTrue(r.add().size() >= 2);
    }

    @Test
    void dalAndVegetablesCountForBoth() {
        DietCheckResponse r = FoodWeek.rules(List.of("Dal rice", "Chicken curry", "Veg salad", "Sambar"));
        assertEquals("high", r.protein());
        assertEquals("high", r.fiber());
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
    void proteinGuessTakesTheFirstMatchingKeyword() {
        // Chicken, not rice: 18 g per 100 g over 300 g.
        assertEquals(54, FoodWeek.guessProtein("Chicken fried rice", 300));
        assertEquals(8, FoodWeek.guessProtein("Plain dosa", 200));
        // Unknown dish: the 4 g per 100 g default.
        assertEquals(10, FoodWeek.guessProtein("Kozhukattai", 250));
    }

    @Test
    void sourcesGroupSameDishAndKeepTopFive() {
        java.util.List<FoodEntry> all = new java.util.ArrayList<>();
        for (String n : List.of("Dosa", "dosa ", "Chicken curry", "Rice", "Egg", "Paneer", "Dal", "Idli")) {
            FoodEntry e = new FoodEntry();
            e.setFoodName(n);
            e.setQuantityGrams(200);
            all.add(e);
        }
        List<ProteinSource> top = FoodWeek.sources(all);
        assertEquals(5, top.size());
        assertEquals("Chicken curry", top.get(0).name());
        assertTrue(top.stream().anyMatch(s -> s.name().equals("Dosa") && s.count() == 2));
    }

    @Test
    void proteinTargetFollowsWeightAndGoal() {
        com.growthbuddy.user.User u = new com.growthbuddy.user.User();
        assertEquals(60, FoodWeek.proteinTarget(u));
        u.setWeightKg(70);
        assertEquals(84, FoodWeek.proteinTarget(u));
        u.setFitnessGoal("Gain weight , dirty bulk");
        assertEquals(112, FoodWeek.proteinTarget(u));
    }
}
