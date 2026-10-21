package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The server's reader of bank and UPI messages (the iPhone Shortcut path) against
 * the same {@code scripts/bank-msg.cases.json} the phone's reader is tested on
 * ({@code node scripts/bank-msg.test.mjs}), so the two can't drift apart.
 */
class BankMessageParserTest {

    @Test
    void everySharedCaseReadsTheSameAsThePhone() throws Exception {
        JsonNode cases = new ObjectMapper().readTree(Files.readString(casesFile())).get("cases");
        assertThat(cases.size()).as("shared cases").isGreaterThanOrEqualTo(30);
        List<String> failures = new ArrayList<>();
        for (JsonNode c : cases) {
            BankMessageParser.Parsed got = BankMessageParser.parse(c.get("text").asText());
            JsonNode expect = c.get("expect");
            if (expect.isNull()) {
                if (got != null) failures.add(c.get("name").asText() + ": expected null, got " + got);
                continue;
            }
            if (got == null) {
                failures.add(c.get("name").asText() + ": expected a transaction, got null");
                continue;
            }
            for (Iterator<Map.Entry<String, JsonNode>> it = expect.fields(); it.hasNext(); ) {
                Map.Entry<String, JsonNode> e = it.next();
                Object actual = field(got, e.getKey());
                Object wanted = e.getValue().isNull() ? null
                        : "amount".equals(e.getKey()) ? e.getValue().decimalValue().setScale(2)
                        : e.getValue().asText();
                if (actual instanceof BigDecimal a && wanted instanceof BigDecimal w ? a.compareTo(w) != 0
                        : !java.util.Objects.equals(actual == null ? null : actual.toString(), wanted == null ? null : wanted.toString())) {
                    failures.add(c.get("name").asText() + ": " + e.getKey() + " was " + actual + ", expected " + wanted);
                }
            }
        }
        assertThat(failures).isEmpty();
    }

    @Test
    void refusesWhatNoCaseFileCanSay() {
        assertThat(BankMessageParser.parse(null)).isNull();
        assertThat(BankMessageParser.parse("")).isNull();
        assertThat(BankMessageParser.parse("x".repeat(3000) + " Rs 10 debited")).isNull();
        assertThat(BankMessageParser.parse("Rs 0.00 debited from A/c XX1234")).isNull();
    }

    @Test
    void noInputTakesLong() {
        // The phone's fuzz (20,000 random messages) found nothing over 2 ms; these are
        // the shapes that make lazy names and their lookahead try every position.
        String[] evil = {
            "to " + "a ".repeat(990), "Rs 1 debited " + "to ".repeat(600), "Rs 1 debited at " + "A".repeat(1980),
            "Rs 1 debited " + "1/".repeat(990), "Rs 1 debited UPI/" + "1".repeat(1980), "Rs 1 debited " + "x@y ".repeat(490),
        };
        for (String e : evil) {
            long t = System.nanoTime();
            BankMessageParser.parse(e);
            assertThat((System.nanoTime() - t) / 1_000_000).as(e.substring(0, 20)).isLessThan(250);
        }
    }

    private static Object field(BankMessageParser.Parsed p, String key) {
        return switch (key) {
            case "kind" -> p.kind();
            case "amount" -> p.amount();
            case "merchant" -> p.merchant();
            case "last4" -> p.last4();
            case "ref" -> p.ref();
            case "date" -> p.date();
            case "channel" -> p.channel();
            case "confidence" -> p.confidence();
            default -> throw new IllegalArgumentException("unknown expect key " + key);
        };
    }

    /** Surefire runs from backend/; the case file sits in the frontend's scripts/. */
    private static Path casesFile() {
        for (Path dir = Path.of("").toAbsolutePath(); dir != null; dir = dir.getParent()) {
            Path candidate = dir.resolve("scripts/bank-msg.cases.json");
            if (Files.exists(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("scripts/bank-msg.cases.json not found from " + Path.of("").toAbsolutePath());
    }
}
