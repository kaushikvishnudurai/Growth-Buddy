package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * applyLedger refuses a bad entry on its own, by id, and saves the rest: failing
 * the whole batch made one bad expense a poison pill that blocked every later save.
 */
class MoneyApplyLedgerTest {

    private final ObjectMapper json = new ObjectMapper();
    private final List<MoneyLedger.Row> saved = new ArrayList<>();
    private final List<String> deleted = new ArrayList<>();

    private final MoneyLedger ledger = new MoneyLedger(null, json) {
        @Override
        public void apply(UUID userId, List<Row> upserts, Collection<String> deletes) {
            saved.addAll(upserts);
            deleted.addAll(deletes);
        }

        @Override
        public ArrayNode accounts(UUID userId) {
            return json.createArrayNode();
        }
    };

    private final MoneyService service = new MoneyService(null, json, null, ledger);

    @Test
    void eachBadRowIsRejectedByIdAndTheRestAreSaved() throws Exception {
        ObjectNode body = (ObjectNode) json.readTree("""
                {"upserts":[
                  {"kind":"expense","id":"ok","amount":250,"date":"2026-09-30"},
                  {"kind":"expense","id":"nodate","amount":10},
                  {"kind":"expense","id":"huge","amount":20000000,"date":"2026-09-30"},
                  {"kind":"income","id":"inc","amount":5000,"source":"salary","date":"2026-09-01"}],
                 "deletes":["gone"]}""");
        ObjectNode out = service.applyLedger(UUID.randomUUID(), body);

        assertThat(saved).extracting(MoneyLedger.Row::id).containsExactly("ok", "inc");
        assertThat(deleted).containsExactly("gone");
        assertThat(out.get("rejected")).hasSize(2);
        assertThat(out.get("rejected").get(0).path("id").asText()).isEqualTo("nodate");
        assertThat(out.get("rejected").get(1).path("id").asText()).isEqualTo("huge");
        assertThat(out.get("rejected").get(1).path("reason").asText()).contains("10,000,000");
        assertThat(out.has("accounts")).isTrue();
    }
}
