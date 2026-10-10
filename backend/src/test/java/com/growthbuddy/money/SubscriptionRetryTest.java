package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * A transient WhatsApp failure used to be retried every 15-minute tick for the
 * rest of the day — ~60 calls per subscription if Meta was down. The budget caps
 * it at three, backing off between them, and starts over the next day.
 */
class SubscriptionRetryTest {

    private static final long MIN = 60_000L;
    private static final UUID KEY = UUID.nameUUIDFromBytes("sub:u:s".getBytes());
    private static final LocalDate DAY = LocalDate.of(2026, 10, 10);

    @Test
    void anUntriedSubscriptionIsDue() {
        assertThat(new SubscriptionDueScheduler.Retries().due(KEY, DAY, 0)).isTrue();
    }

    @Test
    void backsOffOneTickThenTwoThenGivesUpOnTheThird() {
        SubscriptionDueScheduler.Retries r = new SubscriptionDueScheduler.Retries();
        long t = 9 * 60 * MIN;

        assertThat(r.recordFailure(KEY, DAY, t)).as("first failure").isFalse();
        assertThat(r.due(KEY, DAY, t + 5 * MIN)).as("mid-backoff").isFalse();
        assertThat(r.due(KEY, DAY, t + 15 * MIN)).as("next tick").isTrue();

        t += 15 * MIN;
        assertThat(r.recordFailure(KEY, DAY, t)).as("second failure").isFalse();
        assertThat(r.due(KEY, DAY, t + 15 * MIN)).as("one tick later: still waiting").isFalse();
        assertThat(r.due(KEY, DAY, t + 30 * MIN)).as("two ticks later").isTrue();

        t += 30 * MIN;
        assertThat(r.recordFailure(KEY, DAY, t)).as("third failure spends the budget").isTrue();
    }

    @Test
    void aNewDayStartsAFreshBudget() {
        SubscriptionDueScheduler.Retries r = new SubscriptionDueScheduler.Retries();
        r.recordFailure(KEY, DAY, 0);
        r.recordFailure(KEY, DAY, 20 * MIN);
        LocalDate tomorrow = DAY.plusDays(1);
        assertThat(r.due(KEY, tomorrow, 21 * MIN)).isTrue();
        assertThat(r.recordFailure(KEY, tomorrow, 21 * MIN)).as("first failure of the new day").isFalse();
    }

    @Test
    void oneSubscriptionsFailuresDoNotSpendAnothers() {
        SubscriptionDueScheduler.Retries r = new SubscriptionDueScheduler.Retries();
        UUID other = UUID.nameUUIDFromBytes("sub:u:other".getBytes());
        r.recordFailure(KEY, DAY, 0);
        r.recordFailure(KEY, DAY, 20 * MIN);
        assertThat(r.due(other, DAY, 21 * MIN)).isTrue();
        assertThat(r.recordFailure(other, DAY, 21 * MIN)).isFalse();
    }
}
