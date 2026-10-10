package com.growthbuddy.mentor;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The one-tap actions under a Buddy reply ("Add as task", "Make it a habit",
 * "Remind me"). The system prompt asks the model to end a reply that suggests
 * something concrete with a fenced block:
 *
 * <pre>```actions [{"type":"task","title":"Walk 10 minutes","time":"18:30"}]```</pre>
 *
 * {@link #parse} takes that block out of the text the user reads (and the model
 * is later replayed) and returns what it said as data. Pure, so it is tested
 * without the model: a malformed block is still removed — fence characters in
 * a chat bubble are worse than a missing chip — and anything it says that isn't
 * one of the three types with a title is dropped. Nothing here creates anything;
 * the client shows a prefilled confirm sheet and calls the ordinary create API.
 */
final class MentorActions {

    static final int MAX_ACTIONS = 3;
    static final int MAX_TITLE = 120;
    static final Set<String> TYPES = Set.of("task", "habit", "reminder");

    /** An unclosed block (the reply hit its token ceiling) runs to the end. */
    private static final Pattern BLOCK = Pattern.compile(
            "```[ \\t]*actions\\b(.*?)(?:```|\\z)", Pattern.DOTALL | Pattern.CASE_INSENSITIVE);
    private static final Pattern HHMM = Pattern.compile("([01]?\\d|2[0-3]):([0-5]\\d)");
    private static final ObjectMapper JSON = new ObjectMapper();

    private MentorActions() {
    }

    /** {@code time} is "HH:MM" or null. */
    record Action(String type, String title, String time) {
    }

    record Parsed(String text, List<Action> actions) {
    }

    static Parsed parse(String raw) {
        if (raw == null) return new Parsed("", List.of());
        Matcher m = BLOCK.matcher(raw);
        StringBuilder text = new StringBuilder();
        List<Action> out = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        int last = 0;
        boolean any = false;
        while (m.find()) {
            any = true;
            text.append(raw, last, m.start());
            last = m.end();
            for (Action a : read(m.group(1))) {
                if (out.size() >= MAX_ACTIONS) break;
                if (seen.add(a.type() + "\n" + a.title().toLowerCase(Locale.ROOT))) out.add(a);
            }
        }
        if (!any) return new Parsed(raw, List.of());
        text.append(raw.substring(last));
        return new Parsed(text.toString().strip(), List.copyOf(out));
    }

    private static List<Action> read(String body) {
        List<Action> out = new ArrayList<>();
        JsonNode node;
        try {
            node = JSON.readTree(body == null ? "" : body.strip());
        } catch (Exception malformed) {
            return out;
        }
        if (node == null) return out;
        if (node.isObject()) node = JSON.createArrayNode().add(node);
        if (!node.isArray()) return out;
        for (JsonNode n : node) {
            if (!n.isObject()) continue;
            String type = n.path("type").asText("").trim().toLowerCase(Locale.ROOT);
            String title = n.path("title").asText("").replaceAll("\\s+", " ").trim();
            if (!TYPES.contains(type) || title.isEmpty()) continue;
            if (title.length() > MAX_TITLE) title = title.substring(0, MAX_TITLE - 1).trim() + "…";
            out.add(new Action(type, title, time(n.path("time").asText(""))));
        }
        return out;
    }

    /** "9:05" → "09:05"; anything else → null. */
    static String time(String s) {
        Matcher m = HHMM.matcher(s == null ? "" : s.trim());
        if (!m.matches()) return null;
        return String.format("%02d:%s", Integer.parseInt(m.group(1)), m.group(2));
    }

    /** For {@code mentor_messages.actions_json}; null when there are none. */
    static String toJson(List<Action> actions) {
        if (actions == null || actions.isEmpty()) return null;
        try {
            return JSON.writeValueAsString(actions);
        } catch (Exception e) {
            return null;
        }
    }

    /** The stored column back to actions; a bad or empty column is none. */
    static List<Action> fromJson(String json) {
        if (json == null || json.isBlank()) return List.of();
        List<Action> out = read(json);
        return out.size() > MAX_ACTIONS ? List.copyOf(out.subList(0, MAX_ACTIONS)) : List.copyOf(out);
    }

    /**
     * A thread's title from its first message: one line, at most 40 characters,
     * cut at a word where one is near and marked with an ellipsis.
     */
    static String autoTitle(String firstMessage) {
        String one = firstMessage == null ? "" : firstMessage.replaceAll("\\s+", " ").trim();
        if (one.isEmpty()) return null;
        if (one.length() <= TITLE_MAX) return one;
        String cut = one.substring(0, TITLE_MAX - 1);
        int space = cut.lastIndexOf(' ');
        if (space >= TITLE_MAX / 2) cut = cut.substring(0, space);
        return cut.strip() + "…";
    }

    static final int TITLE_MAX = 40;
}
