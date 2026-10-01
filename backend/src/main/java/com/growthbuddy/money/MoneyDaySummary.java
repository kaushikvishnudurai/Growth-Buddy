package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.UserZone;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.mentor.OpenAIClient.ChatTurn;
import com.growthbuddy.user.UserRepository;
import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * "What happened on this day?" for a bar on the Last 7 days chart: the facts
 * (totals, where it went, how the fun spending felt, what could have been
 * skipped) always, computed fresh — plus a short paragraph from the AI coach,
 * cached in money_day_summaries so a second tap costs nothing.
 *
 * <p>The cache is dropped by {@link MoneyLedger#apply} whenever an expense on
 * that day changes, and purged nightly past 7 days by DataCleanupJob.
 *
 * <p>Not behind AiRateLimitInterceptor: a cached tap must stay free, and that
 * interceptor would charge it. OpenAIClient charges every real call against the
 * same per-user budget, and an exhausted budget falls back to the rules text.
 */
@Service
public class MoneyDaySummary {

    private static final Logger log = LoggerFactory.getLogger(MoneyDaySummary.class);

    /** The chart shows 7 days; a summary for any other day has nowhere to appear. */
    static final int DAYS = 7;

    /** Mirrors money.js wantShare: what Spending habits counts as a want. */
    static final Set<String> WANTS = Set.of("shopping", "entertainment");

    private static final Map<String, String> LABELS = Map.of(
            "food", "Food", "shopping", "Shopping", "transport", "Transport",
            "entertainment", "Entertainment", "education", "Education", "others", "Others");

    private static final String PROMPT = """
            You are Buddy, the warm money coach inside the Growth Buddy app.
            You get the facts of ONE day of the user's spending and a list of what to
            cover. Cover exactly those points, one short sentence each, in order, and
            nothing else: never mention a fact that is not given. Write NO numbers,
            amounts or ratings at all — the screen beside your text already shows every
            figure exactly, so talk about what they mean. Money is growth, never shame.
            Plain prose, no Markdown, no lists, no emoji. Second person.
            """;

    private final MoneyLedger ledger;
    private final MoneyRepository docs;
    private final UserRepository users;
    private final OpenAIClient openai;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public MoneyDaySummary(MoneyLedger ledger, MoneyRepository docs, UserRepository users,
                           OpenAIClient openai, JdbcTemplate jdbc, ObjectMapper json) {
        this.ledger = ledger;
        this.docs = docs;
        this.users = users;
        this.openai = openai;
        this.jdbc = jdbc;
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
        if (expenses.isEmpty()) {
            out.put("summary", "Nothing spent on this day. A no-spend day is a win worth noticing.");
            out.put("source", "rules");
            return out;
        }
        List<String> cached = jdbc.queryForList(
                "SELECT summary FROM money_day_summaries WHERE user_id = ? AND day = ?",
                String.class, userId.toString(), Date.valueOf(day));
        if (!cached.isEmpty()) {
            out.put("summary", cached.get(0));
            out.put("source", "ai");
            return out;
        }
        String ai = askAi(out);
        // An expense logged while the AI was writing makes this summary describe a
        // day that no longer exists; answer with it, but don't keep it.
        if (ai != null) {
            // ponytail: re-read, then store. An edit whose transaction is still open at
            // this instant (milliseconds, against a multi-second AI call) can slip past
            // and leave this summary cached until that day next changes or the 7-day
            // purge. The watertight fix is a fingerprint column checked on read; add it
            // if a stale summary is ever reported.
            if (sameDay(expenses, ledger.expensesOn(userId, day))) {
                // Upsert: two taps racing on a cold day both ask, and the second must not 500.
                jdbc.update("""
                        INSERT INTO money_day_summaries (user_id, day, summary, created_at) VALUES (?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE summary = VALUES(summary), created_at = VALUES(created_at)
                        """, userId.toString(), Date.valueOf(day), ai, Timestamp.from(Instant.now()));
            }
            out.put("summary", ai);
            out.put("source", "ai");
        } else {
            out.put("summary", rulesText(out));
            out.put("source", "rules");
        }
        return out;
    }

    /** Same entries, same amounts: the day the AI read is still the day on record. */
    static boolean sameDay(List<ObjectNode> read, List<ObjectNode> now) {
        return read.toString().equals(now.toString());
    }

    private String askAi(ObjectNode facts) {
        if (!openai.isConfigured()) {
            return null;
        }
        try {
            String text = openai.complete(PROMPT, List.of(new ChatTurn("user", factsForPrompt(facts)))).strip();
            return StringUtils.hasText(text) ? cap(text, 600) : null;
        } catch (RuntimeException ex) {
            log.warn("Day summary AI call failed, using the rules text: {}", ex.getMessage());
            return null;
        }
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

    /**
     * Only the facts, as text, and a task list built from the facts that exist.
     * "Leave out what you don't have" in the prompt was not enough: asked for three
     * points with facts for one, the model wrote the other two about the gap.
     */
    static String factsForPrompt(ObjectNode f) {
        String cur = f.path("currency").asText("₹");
        StringBuilder sb = new StringBuilder("Facts:\nTotal spent: ").append(money(cur, f.path("total")))
                .append(" across ").append(f.path("count").asInt()).append(" expenses.\nBy tag:");
        for (JsonNode c : f.path("categories")) {
            sb.append(' ').append(c.path("label").asText()).append(' ').append(money(cur, c.path("amount"))).append(';');
        }
        JsonNode ent = f.path("entertainment");
        boolean rated = !ent.path("avgSatisfaction").isNull();
        if (rated) {
            sb.append("\nEntertainment satisfaction: ").append(ent.path("avgSatisfaction").asText())
                    .append(" out of 5 over ").append(ent.path("rated").asInt()).append(" rated.");
        }
        boolean avoid = !f.path("avoidable").isEmpty();
        if (avoid) {
            sb.append("\nCould be avoided:");
            for (JsonNode a : f.path("avoidable")) {
                sb.append(' ').append(cap(a.path("note").asText(), 60)).append(' ')
                        .append(money(cur, a.path("amount"))).append(" (").append(a.path("reason").asText()).append(");");
            }
        }
        sb.append("\n\nCover:\n1. What the day's money mostly went on.");
        int n = 2;
        if (rated) {
            sb.append('\n').append(n++).append(". How their entertainment spending felt to them.");
        }
        if (avoid) {
            sb.append('\n').append(n++).append(". One kind, specific thing to skip or swap next time, from the avoidable list.");
        } else {
            sb.append('\n').append(n++).append(". One short, encouraging observation about the day.");
        }
        return sb.toString();
    }

    /** "₹1,25,000": the grouping the app shows, so the paragraph matches the chips beside it. */
    private static String money(String cur, JsonNode amount) {
        return cur + SubscriptionDueScheduler.amount(amount);
    }

    /** No AI (unconfigured, failed, or out of budget): the same facts in one plain line. */
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
        }
        return sb.toString();
    }

    private static String cap(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
