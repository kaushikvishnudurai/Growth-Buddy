package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.growthbuddy.common.ApiException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The document ↔ row translation is the whole contract between the app and the
 * ledger: an expense must come back exactly as it went in, or the app's
 * ledgerDiff sees a change that never happened and re-saves it forever.
 */
class MoneyLedgerMappingTest {

    private final ObjectMapper json = new ObjectMapper();
    private final MoneyLedger ledger = new MoneyLedger(null, json); // mapping never touches the DB

    private ObjectNode obj(String s) throws Exception {
        return (ObjectNode) json.readTree(s);
    }

    private ObjectNode roundTrip(String kind, ObjectNode item) {
        MoneyLedger.Row r = ledger.toRow(kind, item);
        ObjectNode out = ledger.toItem(r.kind(), r.id(), r.accountId(), r.toAccountId(), r.amount(),
                r.category(), r.note(), r.day(), r.extra());
        // Compared as the app sees it — JSON text, re-read. In memory Jackson keeps
        // 250 as a LongNode here and an IntNode there, which the wire never shows.
        try {
            return (ObjectNode) json.readTree(out.toString());
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    @Test
    void anExpenseComesBackExactlyAsItWentIn() throws Exception {
        ObjectNode e = obj("""
                {"id":"m1","amount":250,"category":"food","note":"Lunch","date":"2026-09-30",
                 "createdAt":1790000000000,"accountId":"acc-1",
                 "reflection":{"reason":"hungry","planned":false,"satisfaction":4}}""");
        assertThat(roundTrip("expense", e)).isEqualTo(e);
    }

    @Test
    void incomeAndTransfersKeepTheirOwnFieldNames() throws Exception {
        ObjectNode inc = obj("{\"id\":\"i1\",\"amount\":45000,\"source\":\"salary\",\"label\":\"Salary\",\"date\":\"2026-09-01\"}");
        assertThat(roundTrip("income", inc)).isEqualTo(inc);
        ObjectNode t = obj("{\"id\":\"t1\",\"amount\":2000,\"from\":\"b\",\"to\":\"c\",\"date\":\"2026-09-30\",\"note\":\"ATM\"}");
        assertThat(roundTrip("transfer", t)).isEqualTo(t);
    }

    @Test
    void paiseSurviveAndWholeRupeesStayIntegers() throws Exception {
        assertThat(roundTrip("expense", obj("{\"id\":\"a\",\"amount\":99.5,\"date\":\"2026-09-30\"}"))
                .get("amount").decimalValue()).isEqualByComparingTo("99.5");
        assertThat(roundTrip("expense", obj("{\"id\":\"b\",\"amount\":100,\"date\":\"2026-09-30\"}"))
                .get("amount").isIntegralNumber()).isTrue();
    }

    @Test
    void aBadEntryIsRefusedByNameNotDroppedSilently() throws Exception {
        assertThatThrownBy(() -> ledger.toRow("expense", obj("{\"id\":\"x\",\"amount\":10}")))
                .isInstanceOf(ApiException.class).hasMessageContaining("x");
        assertThatThrownBy(() -> ledger.toRow("expense", obj("{\"id\":\"y\",\"amount\":0,\"date\":\"2026-09-30\"}")))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> ledger.toRow("transfer",
                obj("{\"id\":\"z\",\"amount\":5,\"from\":\"a\",\"to\":\"a\",\"date\":\"2026-09-30\"}")))
                .isInstanceOf(ApiException.class).hasMessageContaining("two different");
    }

    @Test
    void theOldDocumentMovesOverAndBadLegacyEntriesAreSkipped() throws Exception {
        ObjectNode doc = obj("""
                {"expenses":[{"id":"e1","amount":10,"date":"2026-09-01"},{"id":"broken"}],
                 "income":[{"id":"i1","amount":5,"source":"other","date":"2026-09-02"}],
                 "budgets":{"food":900},"accounts":[{"id":"a","balance":1}]}""");
        List<MoneyLedger.Row> rows = ledger.rowsFromDoc(doc);
        assertThat(rows).extracting(MoneyLedger.Row::id).containsExactlyInAnyOrder("e1", "i1");
        assertThat(MoneyLedger.stripArrays(doc)).isTrue();
        assertThat(doc.has("expenses") || doc.has("income") || doc.has("accounts")).isFalse();
        assertThat(doc.get("budgets").get("food").asInt()).isEqualTo(900);
    }

    @Test
    void dayFactsAverageTheFunAndNameWhatCouldBeSkipped() throws Exception {
        List<JsonNode> day = List.of(
                obj("{\"id\":\"1\",\"amount\":800,\"category\":\"entertainment\",\"note\":\"Movie\",\"reflection\":{\"satisfaction\":5,\"planned\":true}}"),
                obj("{\"id\":\"2\",\"amount\":1200,\"category\":\"entertainment\",\"note\":\"Arcade\",\"reflection\":{\"satisfaction\":2,\"planned\":true}}"),
                obj("{\"id\":\"3\",\"amount\":600,\"category\":\"shopping\",\"note\":\"Socks\",\"reflection\":{\"satisfaction\":4,\"planned\":false}}"),
                obj("{\"id\":\"4\",\"amount\":150,\"category\":\"food\",\"note\":\"Tea\"}"));
        ObjectNode f = MoneyDaySummary.facts(day, Map.of("entertainment", "Entertainment", "shopping", "Shopping"), json);
        assertThat(f.get("total").asLong()).isEqualTo(2750);
        assertThat(f.get("categories").get(0).get("key").asText()).isEqualTo("entertainment");
        assertThat(f.get("entertainment").get("avgSatisfaction").asDouble()).isEqualTo(3.5);
        // Socks were an impulse buy rated 4/5: loved, so not one to skip.
        assertThat(f.get("avoidable")).extracting(a -> a.get("note").asText()).containsExactly("Arcade");
        assertThat(f.get("avoidable").get(0).get("reason").asText()).isEqualTo("You rated it 2/5");
        // With no AI, the same facts still read as a sentence.
        assertThat(MoneyDaySummary.rulesText(f)).contains("entertainment").contains("3.5/5").contains("Arcade");
    }

    @Test
    void thePromptOnlyAsksAboutFactsThatExist() throws Exception {
        List<JsonNode> plain = List.of(obj("{\"id\":\"1\",\"amount\":125000,\"category\":\"others\",\"note\":\"Rent\"}"));
        ObjectNode f = MoneyDaySummary.facts(plain, Map.of("others", "Others"), json);
        f.put("currency", "₹");
        String prompt = MoneyDaySummary.factsForPrompt(f);
        assertThat(prompt).contains("₹1,25,000").doesNotContain("avoid").doesNotContain("satisfaction");
        assertThat(prompt).contains("encouraging observation");
    }
}
