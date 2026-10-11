package com.growthbuddy.quickadd;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
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
 * The app's one command box: free text ("spent 200 on lunch, slept 7h, had 2
 * idli, remind me at 9 to call mom, open money, dark mode") into structured
 * intents for every tracker and control. Pure parser — no side effects; the
 * client dispatches each intent to the handler its own screen uses, and
 * {@link QuickAddApplier} does the same server-side for a WhatsApp message.
 * With no model, or a failed call, {@link QuickAddFallback} reads what plain
 * patterns can.
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
            You turn a short natural-language message into actions for a personal growth
            app. It is the app's one command box: logging, adding, finishing, opening and
            switching things all come through here. Output STRICT JSON only, no prose:
            {"intents":[...],"note":"<=90 chars friendly confirmation"}
            Each intent has a "type" and ONLY the fields for that type:
              {"type":"task","title":"..."}                 something to do, no time attached
              {"type":"task_done","title":"..."}            they finished an existing task ("done with the report")
              {"type":"habit","name":"..."}                 ticked a habit; name MUST exactly match one listed below
              {"type":"habit_new","name":"..."}             "start a habit of reading", "new habit: stretch"
              {"type":"goal","title":"..."}                 "my goal is to run a 10k", "new goal: save for a bike"
              {"type":"water","amountMl":<int>}             a glass ~= 250, a bottle ~= 500, a litre = 1000
              {"type":"food","name":"<one dish>","meal":"breakfast|lunch|dinner|snack"|null,"kcal":<int>|null}
                                                            one intent PER dish eaten ("2 idli and a dosa" = two);
                                                            keep the quantity in the name; kcal only if they said it
              {"type":"sleep","hours":<number 0-24>,"quality":"poor|ok|good|great"}
              {"type":"mood","mood":"<one or two words>","energy":"low|medium|high"}
              {"type":"expense","amount":<int>,"note":"<short label>"}   money spent, integer, user's currency
              {"type":"income","amount":<int>,"note":"<short label>"}    money received: salary, refund, gift
              {"type":"note","text":"..."}                  "note: ...", "jot down ...", an idea to keep
              {"type":"focus","minutes":<int 1-240>|null}   "start a 25 minute focus", "pomodoro"
              {"type":"open","screen":"home|money|calendar|notes|goals|habits|food|summary|focus|report|family|circle|mentor|achievements|settings"}
                                                            "open money", "show my calendar", "take me to notes"
              {"type":"setting","key":"theme","value":"dark|light|system"}
              {"type":"setting","key":"waterGoal","value":<ml 500-6000>}
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
            "in 20 minutes" / "in 2 hours" count from NOW below.
            "time" is 24-hour local ("9 pm" -> "21:00", "half past 6 in the morning" ->
            "06:30"); null when no time was said. "endTime" only for a span ("3 to 4pm").
            "repeat": "every day" daily, "weekdays"/"every working day" weekdays, "every
            Monday" weekly (date = the next Monday), "every month on the 5th" monthly,
            "every year"/birthdays yearly; otherwise none. "until" only when an end is said.
            "tag": work for office/meetings/clients, health for medicine/doctor/gym/water,
            urgent when they say urgent/important/ASAP, personal otherwise.
            "notifyBefore": minutes of warning they asked for ("10 minutes before" -> 10,
            "an hour early" -> 60, "a day before" -> 1440); null when not said.
            One message can hold many actions of many types; return all of them.
            "had a coffee" is food, not water. A habit the user did ("went to the gym"
            when "Gym" is a habit) is "habit", not "task_done".
            Only include intents clearly present in the text. If nothing maps, return
            {"intents":[],"note":"..."}. Never invent numbers that weren't stated.
            The text may be in ANY language, or a mix of languages (e.g. Tanglish,
            Hinglish) — understand it regardless. Keep titles in the user's language;
            write "note" in the same language the user wrote in.
            """;

    private final OpenAIClient openai;
    private final ObjectMapper json = new ObjectMapper();

    public QuickAddService(OpenAIClient openai) {
        this.openai = openai;
    }

    /**
     * One action. Only the fields its type uses are set (nulls are left off the
     * wire); the accessors read like the record this used to be. Built fluently,
     * because sixteen types sharing one positional constructor was unreadable.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static final class Intent {
        @JsonProperty private final String type;
        @JsonProperty private String title;
        @JsonProperty private String name;
        @JsonProperty private Integer amountMl;
        @JsonProperty private Double hours;
        @JsonProperty private String quality;
        @JsonProperty private String mood;
        @JsonProperty private String energy;
        @JsonProperty private Integer amount;
        @JsonProperty private String note;
        @JsonProperty private String text;
        @JsonProperty private LocalDate date;
        @JsonProperty @JsonFormat(pattern = "HH:mm") private LocalTime time;
        @JsonProperty @JsonFormat(pattern = "HH:mm") private LocalTime endTime;
        @JsonProperty private String repeat;
        @JsonProperty private LocalDate until;
        @JsonProperty private String tag;
        @JsonProperty private Integer notifyBefore;
        @JsonProperty private Integer kcal;
        @JsonProperty private String meal;
        @JsonProperty private Integer minutes;
        @JsonProperty private String screen;
        @JsonProperty private String key;
        @JsonProperty private String value;

        private Intent(String type) {
            this.type = type;
        }

        public static Intent of(String type) {
            return new Intent(type);
        }

        Intent title(String v) { title = v; return this; }
        Intent name(String v) { name = v; return this; }
        Intent amountMl(Integer v) { amountMl = v; return this; }
        Intent hours(Double v) { hours = v; return this; }
        Intent quality(String v) { quality = v; return this; }
        Intent mood(String v) { mood = v; return this; }
        Intent energy(String v) { energy = v; return this; }
        Intent amount(Integer v) { amount = v; return this; }
        Intent note(String v) { note = v; return this; }
        Intent text(String v) { text = v; return this; }
        Intent kcal(Integer v) { kcal = v; return this; }
        Intent meal(String v) { meal = v; return this; }
        Intent minutes(Integer v) { minutes = v; return this; }
        Intent screen(String v) { screen = v; return this; }
        Intent kv(String k, String v) { key = k; value = v; return this; }

        Intent when(LocalDate d, LocalTime t, String rep, String tg, Integer lead) {
            date = d;
            time = t;
            repeat = rep;
            tag = tg;
            notifyBefore = lead;
            return this;
        }

        Intent span(LocalTime end, LocalDate last) {
            endTime = end;
            until = last;
            return this;
        }

        public String type() { return type; }
        public String title() { return title; }
        public String name() { return name; }
        public Integer amountMl() { return amountMl; }
        public Double hours() { return hours; }
        public String quality() { return quality; }
        public String mood() { return mood; }
        public String energy() { return energy; }
        public Integer amount() { return amount; }
        public String note() { return note; }
        public String text() { return text; }
        public LocalDate date() { return date; }
        public LocalTime time() { return time; }
        public LocalTime endTime() { return endTime; }
        public String repeat() { return repeat; }
        public LocalDate until() { return until; }
        public String tag() { return tag; }
        public Integer notifyBefore() { return notifyBefore; }
        public Integer kcal() { return kcal; }
        public String meal() { return meal; }
        public Integer minutes() { return minutes; }
        public String screen() { return screen; }
        public String key() { return key; }
        public String value() { return value; }
    }

    private static final Set<String> REPEATS = Set.of("none", "daily", "weekdays", "weekly", "monthly", "yearly");
    private static final Set<String> TAGS = Set.of("work", "personal", "health", "urgent", "other");
    private static final Set<String> MEALS = Set.of("breakfast", "lunch", "dinner", "snack");
    private static final Set<String> SCREENS = Set.of("home", "money", "calendar", "notes", "goals", "habits",
            "food", "summary", "focus", "report", "family", "circle", "mentor", "achievements", "settings");
    private static final Set<String> THEMES = Set.of("dark", "light", "system");
    private static final Pattern HHMM = Pattern.compile("([01]?\\d|2[0-3]):([0-5]\\d)(:\\d\\d)?");

    /**
     * {@code fallback}: these intents came from the plain patterns, not the model
     * (no key, or the call failed) — the client says so above the preview.
     */
    public record QuickAddResult(boolean configured, boolean unavailable, List<Intent> intents, String note,
                                 boolean fallback) {
        QuickAddResult(boolean configured, boolean unavailable, List<Intent> intents, String note) {
            this(configured, unavailable, intents, note, false);
        }
    }

    public QuickAddResult parse(String text, List<String> habitNames) {
        return parse(text, habitNames, LocalDate.now());
    }

    public QuickAddResult parse(String text, List<String> habitNames, LocalDate today) {
        return parse(text, habitNames, today, LocalTime.now());
    }

    /**
     * {@code today} and {@code now} are the user's own: "tomorrow" and "in 20
     * minutes" mean nothing without them. With no model, or a failed call, the
     * plain patterns read what they can; only when they find nothing either does
     * the caller hear "not configured" / "unavailable" with an empty list.
     */
    /**
     * The habit list as it goes into the prompt: each name clipped to the 120 a
     * habit can have, the whole line to 4 KB. Unclipped, the request's names went
     * in at any length, a token-cost amplifier in the system-prompt position.
     */
    static String habitLine(List<String> habitNames) {
        if (habitNames == null || habitNames.isEmpty()) return "(none)";
        String line = String.join(", ", habitNames.stream()
                .filter(n -> n != null && !n.isBlank())
                .map(n -> n.strip().length() > 120 ? n.strip().substring(0, 120) : n.strip())
                .toList());
        return line.isEmpty() ? "(none)" : line.length() > 4096 ? line.substring(0, 4096) : line;
    }

    public QuickAddResult parse(String text, List<String> habitNames, LocalDate today, LocalTime now) {
        String clean = cap(text);
        if (clean.isEmpty()) {
            return new QuickAddResult(openai.isConfigured(), false, List.of(), null);
        }
        if (!openai.isConfigured()) {
            return new QuickAddResult(false, false, QuickAddFallback.parse(clean, habitNames, today, now), null, true);
        }
        String context = PROMPT + "\nTODAY: " + today + " ("
                + today.getDayOfWeek().getDisplayName(TextStyle.FULL, Locale.ENGLISH) + ")"
                + "\nNOW: " + now.withSecond(0).withNano(0)
                + "\nUser's habits: "
                + habitLine(habitNames);
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
            return new QuickAddResult(true, true, QuickAddFallback.parse(clean, habitNames, today, now), null, true);
        }
    }

    private Intent toIntent(JsonNode n, LocalDate today) {
        String type = n.path("type").asText("");
        switch (type) {
            case "task", "task_done", "goal": {
                String title = cap(n.path("title").asText(""), 200);
                return title.isEmpty() ? null : Intent.of(type).title(title);
            }
            case "habit", "habit_new": {
                String name = cap(n.path("name").asText(""), 120);
                return name.isEmpty() ? null : Intent.of(type).name(name);
            }
            case "water": {
                int ml = clamp(n.path("amountMl").asInt(0), 0, 5000);
                return ml <= 0 ? null : Intent.of(type).amountMl(ml);
            }
            case "sleep": {
                double hrs = n.path("hours").asDouble(0);
                if (hrs <= 0 || hrs > 24) return null;
                return Intent.of(type).hours(hrs)
                        .quality(oneOf(n.path("quality").asText(""), "ok", "poor", "ok", "good", "great"));
            }
            case "mood": {
                String mood = cap(n.path("mood").asText(""), 40);
                return mood.isEmpty() ? null : Intent.of(type).mood(mood)
                        .energy(oneOf(n.path("energy").asText(""), "medium", "low", "medium", "high"));
            }
            case "reminder":
                return reminder(n, today);
            case "expense", "income": {
                int amt = clamp(n.path("amount").asInt(0), 0, 100_000_000);
                return amt <= 0 ? null : Intent.of(type).amount(amt).note(cap(n.path("note").asText(""), 120));
            }
            case "food": {
                String name = cap(n.path("name").asText(""), 255);
                if (name.isEmpty()) return null;
                int kcal = n.path("kcal").asInt(0);
                String meal = n.path("meal").asText("").trim().toLowerCase(Locale.ROOT);
                return Intent.of(type).name(name)
                        .kcal(kcal >= 1 && kcal <= 5000 ? kcal : null)
                        .meal(MEALS.contains(meal) ? meal : null);
            }
            case "note": {
                String text = cap(n.path("text").asText(""), 2000);
                return text.isEmpty() ? null : Intent.of(type).text(text);
            }
            case "focus": {
                int min = n.path("minutes").asInt(0);
                return Intent.of(type).minutes(min >= 1 && min <= 240 ? min : null);
            }
            case "open": {
                String screen = n.path("screen").asText("").trim().toLowerCase(Locale.ROOT);
                return SCREENS.contains(screen) ? Intent.of(type).screen(screen) : null;
            }
            case "setting":
                return setting(n);
            default:
                return null;
        }
    }

    /** Only the settings a sentence can safely change, each with its own bounds. */
    private static Intent setting(JsonNode n) {
        String key = n.path("key").asText("");
        String value = n.path("value").asText("").trim().toLowerCase(Locale.ROOT);
        if ("theme".equals(key) && THEMES.contains(value)) {
            return Intent.of("setting").kv(key, value);
        }
        if ("waterGoal".equals(key)) {
            int ml = n.path("value").asInt(0);
            return ml >= 500 && ml <= 6000 ? Intent.of("setting").kv(key, String.valueOf(ml)) : null;
        }
        return null;
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
        return Intent.of("reminder").text(text).when(date, time, repeat, tag, lead).span(end, until);
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
