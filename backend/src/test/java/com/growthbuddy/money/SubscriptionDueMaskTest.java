package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/**
 * The database filter must never drop a subscription dueToday would send: a miss
 * here is a bill reminder that silently never goes out.
 */
class SubscriptionDueMaskTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static JsonNode doc(String subs) throws Exception {
        return JSON.readTree("{\"subscriptions\":[" + subs + "]}");
    }

    @Test
    void everySendDueTodayWouldMakePassesTheFilter() throws Exception {
        // Every UTC day of a leap year and a normal one, every due day, every local
        // date a user can be on at that moment (UTC-12 .. UTC+14).
        for (LocalDate utc = LocalDate.of(2027, 12, 25); utc.isBefore(LocalDate.of(2029, 1, 5)); utc = utc.plusDays(1)) {
            int filter = SubscriptionDueScheduler.dueMaskAround(utc);
            for (int dueDay = 1; dueDay <= 31; dueDay++) {
                JsonNode data = doc("{\"id\":\"s\",\"dueDay\":" + dueDay + "}");
                int stored = SubscriptionDueScheduler.dueDayMask(data);
                for (int off = -1; off <= 1; off++) {
                    LocalDate local = utc.plusDays(off);
                    if (!SubscriptionDueScheduler.dueToday(data, local).isEmpty()) {
                        assertThat(stored & filter)
                                .as("due day %d, UTC %s, local %s", dueDay, utc, local)
                                .isNotZero();
                    }
                }
            }
        }
    }

    @Test
    void filterIsNarrowMidMonth() {
        // 15 Mar: only the 14th, 15th and 16th.
        assertThat(SubscriptionDueScheduler.dueMaskAround(LocalDate.of(2028, 3, 15)))
                .isEqualTo((1 << 13) | (1 << 14) | (1 << 15));
    }

    @Test
    void maskClampsLikeDueTodayAndSkipsIdlessSubs() throws Exception {
        assertThat(SubscriptionDueScheduler.dueDayMask(doc(
                "{\"id\":\"a\",\"dueDay\":0},{\"id\":\"b\",\"dueDay\":40},{\"dueDay\":10}")))
                .isEqualTo(1 | (1 << 30));
        assertThat(SubscriptionDueScheduler.dueDayMask(null)).isZero();
        assertThat(SubscriptionDueScheduler.dueDayMask(JSON.readTree("{}"))).isZero();
    }
}
