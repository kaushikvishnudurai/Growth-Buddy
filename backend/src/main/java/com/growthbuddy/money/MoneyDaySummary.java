package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.UserZone;
import com.growthbuddy.user.UserRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * "What happened on this day?" for a bar on the Last 7 days chart: the facts
 * (totals, where it went, how the fun spending felt, what could have been
 * skipped), computed fresh on every tap, and a paragraph written from them.
 *
 * <p>No AI here on purpose. Every figure is exact, and the AI used to be told to
 * restate these facts and add nothing, so it only changed the wording while
 * costing a call and a cache table. The AI budget goes to Food, where the
 * numbers themselves are guesses.
 */
@Service
public class MoneyDaySummary {

    /** The chart shows 7 days; a summary for any other day has nowhere to appear. */
    static final int DAYS = 7;

    /** Mirrors money.js wantShare: what Spending habits counts as a want. */
    static final Set<String> WANTS = Set.of("shopping", "entertainment");

    private static final Map<String, String> LABELS = Map.of(
            "food", "Food", "shopping", "Shopping", "transport", "Transport",
            "entertainment", "Entertainment", "education", "Education", "others", "Others");

    private final MoneyLedger ledger;
    private final MoneyRepository docs;
    private final UserRepository users;
    private final ObjectMapper json;

    public MoneyDaySummary(MoneyLedger ledger, MoneyRepository docs, UserRepository users, ObjectMapper json) {
        this.ledger = ledger;
        this.docs = docs;
        this.users = users;
        this.json = json;
    }

    public ObjectNode summarise(UUID userId, String dayParam) {
        LocalDate today = LocalDate.now(UserZone.of(
                users.findById(userId).map(u -> u.getTimezone()).orElse(null)));
        LocalDate day;
        try {
            day = LocalDate.parse(dayParam);
        } catch (Exception ex) {
            throw ApiException.badRequest("Pick a day as YYYY-MM-DD.");
        }
        // A day of slack each side: the chart's days come from the phone's clock and
        // these from the account's timezone, which disagree around midnight.
        if (day.isAfter(today.plusDays(1)) || day.isBefore(today.minusDays(DAYS))) {
            throw ApiException.badRequest("Day summaries cover the last 7 days.");
        }
        List<ObjectNode> expenses = ledger.expensesOn(userId, day);
        MoneyState doc = docs.findById(userId).orElse(null);
        ObjectNode out = facts(expenses, labels(doc), json);
        out.put("currency", doc != null && doc.getData() != null
                ? doc.getData().path("settings").path("currency").asText("₹") : "₹");
        out.put("date", day.toString());
        out.put("summary", expenses.isEmpty()
                ? "Nothing spent on this day. A no-spend day is a win worth noticing."
                : rulesText(out));
        out.put("source", "rules");
        return out;
    }

    /** Custom tags live in the document; the built-in ones are fixed. */
    private static Map<String, String> labels(MoneyState doc) {
        Map<String, String> out = new LinkedHashMap<>(LABELS);
        if (doc != null && doc.getData() != null) {
            for (JsonNode c : doc.getData().path("customCategories")) {
                if (c.hasNonNull("key") && c.hasNonNull("label")) {
                    out.put(c.get("key").asText(), c.get("label").asText());
                }
            }
        }
        return out;
    }

    /* ---------------- pure: facts from one day's expenses ---------------- */

    static ObjectNode facts(List<? extends JsonNode> expenses, Map<String, String> labels, ObjectMapper json) {
        ObjectNode out = json.createObjectNode();
        BigDecimal total = BigDecimal.ZERO;
        Map<String, BigDecimal> byCat = new LinkedHashMap<>();
        int entRated = 0;
        int entSum = 0;
        List<JsonNode> avoidable = new ArrayList<>();
        for (JsonNode e : expenses) {
            BigDecimal amt = e.path("amount").decimalValue();
            total = total.add(amt);
            // A tag the app doesn't know (deleted, or from an old build) is filed
            // under Others there, so it is here too — or the AI names a tag the
            // screen beside it never shows.
            String cat = labels.containsKey(e.path("category").asText()) ? e.path("category").asText() : "others";
            byCat.merge(cat, amt, BigDecimal::add);
            JsonNode r = e.path("reflection");
            int sat = r.path("satisfaction").asInt(0);
            if ("entertainment".equals(cat) && sat >= 1 && sat <= 5) {
                entRated++;
                entSum += sat;
            }
            // Same rule as the app's "what could I skip": rated 2/5 or less, or an
            // impulse want not then rated 4/5 or more (an impulse buy you loved stays).
            if ((sat >= 1 && sat <= 2)
                    || (WANTS.contains(cat) && r.has("planned") && !r.path("planned").asBoolean() && sat < 4)) {
                avoidable.add(e);
            }
        }
        out.put("total", total.setScale(0, java.math.RoundingMode.HALF_UP).longValueExact());
        out.put("count", expenses.size());
        ArrayNode cats = out.putArray("categories");
        byCat.entrySet().stream()
                .sorted(Map.Entry.<String, BigDecimal>comparingByValue().reversed())
                .forEach(en -> cats.addObject()
                        .put("key", en.getKey())
                        .put("label", labels.getOrDefault(en.getKey(), en.getKey()))
                        .put("amount", en.getValue().longValue()));
        long entCount = expenses.stream().filter(e -> "entertainment".equals(e.path("category").asText())).count();
        ObjectNode ent = out.putObject("entertainment");
        ent.put("count", entCount);
        if (entRated > 0) {
            ent.put("avgSatisfaction", Math.round(entSum * 10.0 / entRated) / 10.0);
            ent.put("rated", entRated);
        } else {
            ent.putNull("avgSatisfaction");
            ent.put("rated", 0);
        }
        ArrayNode av = out.putArray("avoidable");
        avoidable.stream()
                .sorted(Comparator.comparing((JsonNode e) -> e.path("amount").decimalValue()).reversed())
                .limit(3)
                .forEach(e -> {
                    int sat = e.path("reflection").path("satisfaction").asInt(0);
                    av.addObject()
                            .put("note", e.path("note").asText("").isBlank()
                                    ? labels.getOrDefault(e.path("category").asText(), "Expense")
                                    : e.path("note").asText())
                            .put("amount", e.path("amount").decimalValue().longValue())
                            .put("reason", sat >= 1 && sat <= 2
                                    ? "You rated it " + sat + "/5"
                                    : "Unplanned " + labels.getOrDefault(e.path("category").asText(), "want")
                                            .toLowerCase());
                });
        return out;
    }

    /** The facts as a short paragraph: where it went, how the fun felt, one thing to skip. */
    static String rulesText(ObjectNode f) {
        JsonNode top = f.path("categories").path(0);
        StringBuilder sb = new StringBuilder("Most of the day went on ")
                .append(top.path("label").asText("expenses").toLowerCase()).append('.');
        JsonNode ent = f.path("entertainment");
        if (!ent.path("avgSatisfaction").isNull()) {
            sb.append(" Your fun spending felt ").append(ent.path("avgSatisfaction").asText()).append("/5.");
        }
        JsonNode first = f.path("avoidable").path(0);
        if (!first.isMissingNode()) {
            sb.append(" Next time, ").append(first.path("note").asText()).append(" is one to think twice about.");
        } else {
            sb.append(" Nothing here looks like a regret, so this was money spent on purpose.");
        }
        return sb.toString();
    }
}
