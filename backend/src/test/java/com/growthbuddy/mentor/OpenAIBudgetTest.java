package com.growthbuddy.mentor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.common.ThrottleStore;
import java.util.List;
import java.util.function.IntUnaryOperator;
import org.junit.jupiter.api.Test;

/**
 * The budget has to hold from inside the client, because the allowlist in
 * WebConfig is the thing that failed: the four vision endpoints — a whole image
 * per call, the most expensive requests in the app — were never added to it and
 * ran uncapped for months.
 *
 * <p>Counting here means a forgotten endpoint is still bounded. The call never
 * reaches OpenAI, which is the part that costs money, whether or not the caller
 * turns the refusal into a silent fallback.
 */
class OpenAIBudgetTest {

    /** Counts hits in memory; the real one counts in the shared database. */
    private static class CountingStore implements ThrottleStore {
        int hits;

        @Override public int countHit(String bucketKey, long windowStart) {
            return ++hits;
        }

        @Override public void sweepCounters(long cutoffWindowStart) { }

        @Override public Attempt attempt(String key) {
            return Attempt.NONE;
        }

        @Override public void recordFailure(String key, IntUnaryOperator lockMsForFailures) { }

        @Override public void clearAttempt(String key) { }

        @Override public void sweepAttempts(long cutoffMs) { }
    }

    private static OpenAIClient clientWith(CountingStore store) {
        // A non-empty key so isConfigured() passes; the budget refuses before any
        // request is built, so nothing is ever sent anywhere.
        return new OpenAIClient("test-key", "gpt-4o-mini", "https://example.invalid/v1",
                new RateLimiter(store));
    }

    @Test
    void refusesOnceTheHourlyCallBudgetIsSpent() {
        CountingStore store = new CountingStore();
        OpenAIClient client = clientWith(store);
        store.hits = 60; // the next call is the one over the line

        assertThatThrownBy(() -> client.complete("system", List.of()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("a lot in the last hour");
    }

    /* The vision path is the one the allowlist forgot, so it gets its own line. */
    @Test
    void theImagePathIsBudgetedToo() {
        CountingStore store = new CountingStore();
        OpenAIClient client = clientWith(store);
        store.hits = 60;

        assertThatThrownBy(() -> client.completeWithImage("system", "what is this?",
                "data:image/png;base64,iVBORw0KGgo="))
                .isInstanceOf(ApiException.class);
    }

    /* Under the ceiling the budget must be invisible — it counts and steps aside.
       The call then fails on the unroutable host, which is the proof it got past
       the budget and actually tried to go out. */
    @Test
    void anOrdinaryCallIsCountedAndAllowedThrough() {
        CountingStore store = new CountingStore();
        OpenAIClient client = clientWith(store);

        assertThatThrownBy(() -> client.complete("system", List.of()))
                .isNotInstanceOf(ApiException.class);
        assertThat(store.hits).as("the call was counted").isEqualTo(1);
    }
}
