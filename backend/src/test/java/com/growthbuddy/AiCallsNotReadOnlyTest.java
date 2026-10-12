package com.growthbuddy;

import static org.assertj.core.api.Assertions.assertThat;

import com.growthbuddy.food.FoodService;
import com.growthbuddy.user.AuthService;
import java.lang.reflect.Method;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

/**
 * An AI call charges the per-account budget with an INSERT (RateLimiter). Inside a
 * read-only transaction MySQL refuses it (1792) and the call silently falls back,
 * so the methods that reach the AI client must not be readOnly.
 */
class AiCallsNotReadOnlyTest {

    @Test
    void aiReachingMethodsAreNotReadOnly() {
        assertNotReadOnly(AuthService.class, "nutritionSuggestion");
        assertNotReadOnly(FoodService.class, "estimateFromPhoto");
        assertNotReadOnly(FoodService.class, "estimateFromPhotoMulti");
    }

    private static void assertNotReadOnly(Class<?> type, String name) {
        Method[] found = Arrays.stream(type.getDeclaredMethods()).filter(m -> m.getName().equals(name))
                .toArray(Method[]::new);
        assertThat(found).as(type.getSimpleName() + "." + name).isNotEmpty();
        for (Method m : found) {
            Transactional tx = m.getAnnotation(Transactional.class);
            assertThat(tx == null || !tx.readOnly()).as(type.getSimpleName() + "." + name + " is readOnly").isTrue();
        }
    }
}
