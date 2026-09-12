package com.growthbuddy.user;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * The fallback suggestion is what users actually see whenever the AI call is
 * unconfigured or fails, and both of its inputs are free text — so a substring
 * test that reads "non vegetarian" as vegetarian, or a bulk goal that lands on a
 * deficit, ships as a confident wrong answer rather than an error.
 */
class NutritionHeuristicTest {

    @Test
    void nonVegetarianIsNotVegetarian() {
        assertFalse(AuthService.vegetarian("non vegetarian"));
        assertFalse(AuthService.vegetarian("Non-Veg"));
        assertFalse(AuthService.vegetarian("nonveg"));
        assertFalse(AuthService.vegetarian("eggetarian"));
    }

    @Test
    void vegetarianStillIs() {
        assertTrue(AuthService.vegetarian("vegetarian"));
        assertTrue(AuthService.vegetarian("pure veg"));
    }

    /** Failing the other way suggests chicken to a vegetarian, which is worse. */
    @Test
    void aVegetarianWhoAvoidsEggIsStillVegetarian() {
        assertTrue(AuthService.vegetarian("vegetarian, no egg"));
        assertTrue(AuthService.vegetarian("eggless veg"));
    }

    @Test
    void unsetDietIsNotAssumedVegetarian() {
        assertFalse(AuthService.vegetarian(null));
        assertFalse(AuthService.vegetarian("  "));
    }

    @Test
    void caloriesFollowTheGoal() {
        assertTrue(AuthService.goalFactor("Gain weight , dirty bulk") > 1.0);
        assertTrue(AuthService.goalFactor("lose belly fat") < 1.0);
        assertTrue(AuthService.goalFactor("stay healthy") == 1.0);
        assertTrue(AuthService.goalFactor(null) == 1.0);
    }
}
