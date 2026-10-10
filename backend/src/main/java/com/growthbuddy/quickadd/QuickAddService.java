package com.growthbuddy.quickadd;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.mentor.OpenAIClient.ChatTurn;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
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
 * can tell the user the feature needs an API key rather than failing silently,
 * and {@code unavailable=true} when the model call itself failed, so the client
 * says the assistant was unreachable instead of blaming the user's sentence.
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
              {"type":"reminder","text":"...","date":"YYYY-MM-DD","time":"HH:MM"|null,
               "endTime":"HH:MM"|null,"repeat":"none|daily|weekdays|weekly|monthly|yearly",
               "until":"YYYY-MM-DD"|null,"tag":"work|personal|health|urgent|other",
               "notifyBefore":<minutes 0-1440>|null}
            A REMINDER is anything to be told about at a moment: "remind me", "don't let me
            forget", "alert me", a meeting or appointment with a day or time, "every Monday
            at 7 call mom" (repeating). Use it, not "task", whenever a time, a day, or a
            repeat is given. "text" is what to be reminded of, without the time words
            ("call mom", not "remind me tomorrow at 9 to call mom"). Resolve the date from
            TODAY below ("tomorrow", "next Friday", "on the 21st"); no day given = today.
            "time" is 24-hour local ("9 pm" -> "21:00", "half past 6 in the morning" ->
            "06:30"); null when no time was said. "endTime" only for a span ("3 to 4pm").
            "repeat": "every day" daily, "weekdays"/"every working day" weekdays, "every
            Monday" weekly (date = the next Monday), "every month on the 5th" monthly,
            "every year"/birthdays yearly; otherwise none. "until" only when an end is said.
            "tag": work for office/meetings/clients, health for medicine/doctor/gym/water,
            urgent when they say urgent/important/ASAP, personal otherwise.
            "notifyBefore": minutes of warning they asked for ("10 minutes before" -> 10,
            "an hour early" -> 60, "a day before" -> 1440); null when not said.
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

    /**
     * One action. A reminder uses the last group of fields; every other type
     * leaves them null. ({@code text} is the reminder's own text — {@code title}
     * stays the task's.)
     */
    public record Intent(
            String type, String title, String name, Integer amountMl,
            Double hours, String quality, String mood, String energy,
            Integer amount, String note,
            String text, LocalDate date, LocalTime time, LocalTime endTime,
            String repeat, LocalDate until, String tag, Integer notifyBefore) {

        Intent(String type, String title, String name, Integer amountMl, Double hours, String quality,
               String mood, String energy, Integer amount, String note) {
            this(type, title, name, amountMl, hours, quality, mood, energy, amount, note,
                    null, null, null, null, null, null, null, null);
        }
    }

    private static final Set<String> REPEATS = Set.of("none", "daily", "weekdays", "weekly", "monthly", "yearly");
    private static final Set<String> TAGS = Set.of("work", "personal", "health", "urgent", "other");
    private static final Pattern HHMM = Pattern.compile("([01]?\\d|2[0-3]):([0-5]\\d)(:\\d\\d)?");

    public record QuickAddResult(boolean configured, boolean unavailable, List<Intent> intents, String note) {}

    public QuickAddResult parse(String text, List<String> habitNames) {
        return parse(text, habitNames, LocalDate.now());
    }

    /** {@code today} is the user's own date: "tomorrow" means nothing without it. */
    public QuickAddResult parse(String text, List<String> habitNames, LocalDate today) {
        String clean = cap(text);
        if (!openai.isConfigured() || clean.isEmpty()) {
            return new QuickAddResult(openai.isConfigured(), false, List.of(), null);
        }
        String context = PROMPT + "\nTODAY: " + today + " ("
                + today.getDayOfWeek().getDisplayName(TextStyle.FULL, Locale.ENGLISH) + ")"
                + "\nUser's habits: "
                + (habitNames == null || habitNames.isEmpty() ? "(none)" : String.join(", ", habitNames));
        try {
            String raw = openai.complete(context, List.of(new ChatTurn("user", clean)));
            JsonNode root = json.readTree(OpenAIClient.jsonOf(raw));
            List<Intent> out = new ArrayList<>();
            for (JsonNode n : root.path("intents")) {
                Intent it = toIntent(n, today);
                if (it != null) out.add(it);
            }
            String note = root.path("note").asText("");
            return new QuickAddResult(true, false, out, note.isBlank() ? null : cap(note, 120));
        } catch (ApiException ex) {
            throw ex; // the AI budget's 429 already says something true; let it through
        } catch (Exception ex) {
            log.warn("Quick-add parse failed: {}", ex.getMessage());
            return new QuickAddResult(true, true, List.of(), null);
        }
    }

    private Intent toIntent(JsonNode n, LocalDate today) {
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
            case "reminder":
                return reminder(n, today);
            case "expense":
                int amt = clamp(n.path("amount").asInt(0), 0, 100_000_000);
                return amt <= 0 ? null : new Intent(type, null, null, null, null, null, null, null, amt,
                        cap(n.path("note").asText(""), 120));
            default:
                return null;
        }
    }


    /**
     * Everything the model said, checked one field at a time: a bad time or an
     * unknown repeat drops that field, not the reminder. A date before today (the
     * model misreading "Monday" as last Monday) becomes today — the reminder API
     * refuses a past day, and the preview shows the date before anything is saved.
     */
    private static Intent reminder(JsonNode n, LocalDate today) {
        String text = cap(n.path("text").asText(""), 120);
        if (text.isEmpty()) return null;
        LocalDate date = date(n.path("date").asText(""));
        if (date == null || date.isBefore(today)) date = today;
        LocalTime time = time(n.path("time").asText(""));
        LocalTime end = time == null ? null : time(n.path("endTime").asText(""));
        if (end != null && !end.isAfter(time)) end = null;
        String repeat = n.path("repeat").asText("none").trim().toLowerCase();
        if (!REPEATS.contains(repeat)) repeat = "none";
        LocalDate until = "none".equals(repeat) ? null : date(n.path("until").asText(""));
        if (until != null && until.isBefore(date)) until = null;
        String tag = n.path("tag").asText("personal").trim().toLowerCase();
        if (!TAGS.contains(tag)) tag = "personal";
        Integer lead = n.path("notifyBefore").isNumber() ? n.path("notifyBefore").asInt() : null;
        if (lead != null && (lead < 0 || lead > 1440 || time == null)) lead = null;
        return new Intent("reminder", null, null, null, null, null, null, null, null, null,
                text, date, time, end, repeat, until, tag, lead);
    }

    private static LocalDate date(String s) {
        try {
            return s == null || s.isBlank() ? null : LocalDate.parse(s.trim());
        } catch (Exception ex) {
            return null;
        }
    }

    private static LocalTime time(String s) {
        if (s == null || !HHMM.matcher(s.trim()).matches()) return null;
        String[] p = s.trim().split(":");
        return LocalTime.of(Integer.parseInt(p[0]), Integer.parseInt(p[1]));
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
