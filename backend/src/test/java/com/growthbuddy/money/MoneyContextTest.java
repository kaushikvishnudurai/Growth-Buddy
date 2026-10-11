package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** Buddy's "bills due" line: unpaid only, inside the window, a 31st on a short month's last day. */
class MoneyContextTest {

    @Test
    void billsDueSkipsPaidAndClampsShortMonths() throws Exception {
        var subs = new ObjectMapper().readTree("""
                [{"name":"Netflix","amount":199,"dueDay":15},
                 {"name":"Rent","amount":20000,"dueDay":31},
                 {"name":"Gym","amount":999,"dueDay":14,"paidFor":"2026-11"},
                 {"name":"Far","amount":5,"dueDay":28}]
                """);
        var due = MoneyService.billsDue(subs, LocalDate.of(2026, 11, 13), 7);
        assertThat(due).containsExactly("Netflix 199 on 2026-11-15");
        var endOfMonth = MoneyService.billsDue(subs, LocalDate.of(2026, 11, 30), 0);
        assertThat(endOfMonth).containsExactly("Rent 20000 on 2026-11-30");
    }
}
