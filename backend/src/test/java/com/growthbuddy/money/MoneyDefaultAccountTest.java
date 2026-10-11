package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** FRC-3: a WhatsApp quick add books to the account the app's dialog would have picked. */
class MoneyDefaultAccountTest {

    private static JsonNode accounts() throws Exception {
        return new ObjectMapper().readTree("""
                [{"id":"card","kind":"card","archived":false},
                 {"id":"old","kind":"cash","archived":true},
                 {"id":"cash","kind":"cash","archived":false},
                 {"id":"bank","kind":"bank","archived":false}]""");
    }

    @Test
    void expenseTakesTheLastPaidFromElseCash() throws Exception {
        assertThat(MoneyService.pickAccount(accounts(), "bank", "expense")).isEqualTo("bank");
        assertThat(MoneyService.pickAccount(accounts(), null, "expense")).isEqualTo("cash");
        assertThat(MoneyService.pickAccount(accounts(), "old", "expense")).as("archived: the first active")
                .isEqualTo("card");
    }

    @Test
    void incomeTakesTheFirstBankOrWallet() throws Exception {
        assertThat(MoneyService.pickAccount(accounts(), null, "income")).isEqualTo("bank");
        assertThat(MoneyService.pickAccount(new ObjectMapper().readTree("[]"), null, "income")).isNull();
    }
}
