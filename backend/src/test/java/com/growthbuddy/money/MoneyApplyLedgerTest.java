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

        @Override
        java.time.ZoneId zoneOf(UUID userId) {
            return ZONE;
        }

        @Override
        public java.util.Set<String> deletedIds(UUID userId, Collection<String> ids) {
            asked.addAll(ids);
            return new java.util.HashSet<>(ids.stream().filter(DELETED::contains).toList());
        }
    };

    private static final java.util.Set<String> DELETED = java.util.Set.of("e1", "loan-7-s");
    private final List<String> asked = new ArrayList<>();

    private static final java.time.ZoneId ZONE = java.time.ZoneId.of("Asia/Kolkata");

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

    /** EXM-1: a future row moved the balance and showed in no list; today still saves. */
    @Test
    void aRowDatedAfterTheUsersTodayIsRefused() throws Exception {
        // 23:55 in Kolkata: ten minutes of clock slack reach tomorrow, the day after is out.
        service.clock = java.time.Clock.fixed(java.time.Instant.parse("2026-10-11T18:25:00Z"), ZONE);
        java.time.LocalDate today = java.time.LocalDate.of(2026, 10, 11);
        var body = json.readTree("""
                {"upserts":[
                  {"kind":"expense","id":"now","amount":100,"date":"%s"},
                  {"kind":"expense","id":"fast","amount":100,"date":"%s"},
                  {"kind":"expense","id":"concert","amount":500,"date":"%s"},
                  {"kind":"income","id":"pay","amount":5000,"source":"salary","date":"%s"},
                  {"kind":"transfer","id":"mv","amount":50,"from":"a","to":"b","date":"%s"}]}"""
                .formatted(today, today.plusDays(1), today.plusDays(2), today.plusDays(9), today.plusDays(2)));
        ObjectNode out = service.applyLedger(UUID.randomUUID(), body);

        assertThat(saved).extracting(MoneyLedger.Row::id).containsExactly("now", "fast");
        assertThat(out.get("rejected")).extracting(r -> r.path("id").asText())
                .containsExactly("concert", "pay", "mv");
        assertThat(out.get("rejected").get(0).path("reason").asText()).isEqualTo("Pick a day up to today.");
    }

    /** OFF-5: a stale tab's edit of an expense deleted elsewhere is refused, not re-inserted. */
    @Test
    void anEditOfADeletedEntryIsRefusedWithACode() throws Exception {
        var body = json.readTree("""
                {"upserts":[
                  {"kind":"expense","id":"e1","amount":99,"date":"2026-09-30"},
                  {"kind":"expense","id":"e2","amount":10,"date":"2026-09-30"},
                  {"kind":"transfer","id":"loan-7-s","amount":50,"to":"a","date":"2026-09-30"}]}""");
        ObjectNode out = service.applyLedger(UUID.randomUUID(), body);

        assertThat(saved).extracting(MoneyLedger.Row::id).containsExactly("e2", "loan-7-s");
        assertThat(out.get("rejected")).hasSize(1);
        assertThat(out.get("rejected").get(0).path("id").asText()).isEqualTo("e1");
        assertThat(out.get("rejected").get(0).path("code").asText()).isEqualTo("deleted");
        assertThat(asked).as("ids rebuilt from the document are re-created on purpose").doesNotContain("loan-7-s");
    }
}
