package com.growthbuddy.quickadd;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.mentor.OpenAIClient.ChatTurn;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Turns a free-text log ("ran 3km, spent 200 on lunch, slept 7h, felt tired")
 * into structured intents the frontend applies to the right trackers. Pure
 * parser — no side effects; the client dispatches each intent to the existing
 * habit / task / water / sleep / mood / money handlers.
 *
 * <p>Returns {@code configured=false} when no LLM is available, so the client
 * can tell the user the feature needs an API key rather than failing silently.
 */
@Service
public class QuickAddService {

    private static final Logger log = LoggerFactory.getLogger(QuickAddService.class);
    private static final int MAX_TEXT = 400;

    private static final String PROMPT = """
            You convert a short natural-language log into structured actions for a
            personal growth app. Output STRICT JSON only, no prose:
            {"intents":[...],"note":"<=90 chars friendly confirmation"}
            Each intent has a "type" and ONLY the fields for that type:
              {"type":"task","title":"..."}
              {"type":"habit","name":"..."}   name MUST exactly match one of the user's habits listed below; omit if none match
              {"type":"water","amountMl":<int>}   a glass ~= 250, a bottle ~= 500
              {"type":"sleep","hours":<number 0-24>,"quality":"poor|ok|good|great"}
              {"type":"mood","mood":"<one or two words>","energy":"low|medium|high"}
              {"type":"expense","amount":<int>,"note":"<short label>"}   money spent, integer, user's currency
            Only include intents clearly present in the text. If nothing maps, return
            {"intents":[],"note":"..."}. Never invent numbers that weren't stated.
            The text may be in ANY language, or a mix of languages (e.g. Tanglish,
            Hinglish) — understand it regardless. Keep task titles in the user's
            language; write "note" in the same language the user wrote in.
            """;

    private final OpenAIClient openai;
    private final ObjectMapper json = new ObjectMapper();

    public QuickAddService(OpenAIClient openai) {
        this.openai = openai;
    }

    public record Intent(
            String type, String title, String name, Integer amountMl,
            Double hours, String quality, String mood, String energy,
            Integer amount, String note) {}

    public record QuickAddResult(boolean configured, List<Intent> intents, String note) {}

    public QuickAddResult parse(String text, List<String> habitNames) {
        String clean = cap(text);
        if (!openai.isConfigured() || clean.isEmpty()) {
            return new QuickAddResult(openai.isConfigured(), List.of(), null);
        }
        String context = PROMPT + "\nUser's habits: "
                + (habitNames == null || habitNames.isEmpty() ? "(none)" : String.join(", ", habitNames));
        try {
            String raw = openai.complete(context, List.of(new ChatTurn("user", clean)));
            JsonNode root = json.readTree(stripFences(raw));
            List<Intent> out = new ArrayList<>();
            for (JsonNode n : root.path("intents")) {
                Intent it = toIntent(n);
                if (it != null) out.add(it);
            }
            String note = root.path("note").asText("");
            return new QuickAddResult(true, out, note.isBlank() ? null : cap(note, 120));
        } catch (Exception ex) {
            log.warn("Quick-add parse failed: {}", ex.getMessage());
            return new QuickAddResult(true, List.of(), null);
        }
    }

    private Intent toIntent(JsonNode n) {
        String type = n.path("type").asText("");
        switch (type) {
            case "task":
                String title = cap(n.path("title").asText(""), 200);
                return title.isEmpty() ? null : new Intent(type, title, null, null, null, null, null, null, null, null);
            case "habit":
                String name = cap(n.path("name").asText(""), 120);
                return name.isEmpty() ? null : new Intent(type, null, name, null, null, null, null, null, null, null);
            case "water":
                int ml = clamp(n.path("amountMl").asInt(0), 0, 5000);
                return ml <= 0 ? null : new Intent(type, null, null, ml, null, null, null, null, null, null);
            case "sleep":
                double hrs = n.path("hours").asDouble(0);
                if (hrs <= 0 || hrs > 24) return null;
                return new Intent(type, null, null, null, hrs, oneOf(n.path("quality").asText(""), "ok",
                        "poor", "ok", "good", "great"), null, null, null, null);
            case "mood":
                String mood = cap(n.path("mood").asText(""), 40);
                return mood.isEmpty() ? null : new Intent(type, null, null, null, null, null, mood,
                        oneOf(n.path("energy").asText(""), "medium", "low", "medium", "high"), null, null);
            case "expense":
                int amt = clamp(n.path("amount").asInt(0), 0, 100_000_000);
                return amt <= 0 ? null : new Intent(type, null, null, null, null, null, null, null, amt,
                        cap(n.path("note").asText(""), 120));
            default:
                return null;
        }
    }

    private static String stripFences(String s) {
        String t = s == null ? "" : s.trim();
        if (t.startsWith("```")) {
            int nl = t.indexOf('\n');
            if (nl >= 0) t = t.substring(nl + 1);
            if (t.endsWith("```")) t = t.substring(0, t.length() - 3);
        }
        return t.trim();
    }

    private static String oneOf(String v, String fallback, String... allowed) {
        String s = v == null ? "" : v.trim().toLowerCase();
        for (String a : allowed) if (a.equals(s)) return a;
        return fallback;
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    private static String cap(String s) {
        return cap(s, MAX_TEXT);
    }

    private static String cap(String s, int max) {
        if (s == null) return "";
        s = s.strip();
        return s.length() <= max ? s : s.substring(0, max);
    }
}
