package com.growthbuddy.quickadd;

import com.growthbuddy.quickadd.QuickAddService.Intent;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Quick add without the model: plain patterns for the sentences people actually
 * type ("spent 200 on lunch, slept 7h, 2 glasses of water, remind me tomorrow at 9
 * to call mom"). Runs when no AI is configured or the call failed, so the box
 * never just says no. English only, one meaning per clause; everything it reads
 * still goes through the same preview, so a misread is switched off, not saved.
 *
 * <p>ponytail: regexes, not a grammar. Anything they miss falls to the model when
 * there is one; widen a pattern here when a common phrasing keeps falling through.
 */
final class QuickAddFallback {

    private QuickAddFallback() {
    }

    private static final int F = Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE;
    private static final String LEADS =
            "spent|spend|paid|slept|drank|drink|had|ate|eaten|remind|feeling|feel|felt|got|received|earned"
                    + "|done|finished|completed|todo|task|note|start|open|bought";
    private static final Pattern CLAUSE_AND =
            Pattern.compile("\\s+and\\s+(?=(?:i\\s+)?(?:" + LEADS + ")\\b)|\\s+then\\s+", F);
    private static final String MONEY = "(?:₹|rs\\.?|inr|\\$|usd|eur|€|£)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)(?:\\s*(?:rs|rupees|inr|bucks|dollars)\\b)?";

    private static final Pattern REMIND = Pattern.compile(
            "^(?:please\\s+)?(?:remind\\s+me|set\\s+(?:a\\s+)?reminder|reminder|don'?t\\s+let\\s+me\\s+forget|alert\\s+me)\\s*(?:to\\s+|that\\s+|about\\s+|:\\s*)?(.*)$", F);
    private static final Pattern FOCUS = Pattern.compile(
            "^(?:start\\s+)?(?:a\\s+)?(?:focus(?:\\s+session|\\s+timer)?|pomodoro|timer)(?:\\s+for)?(?:\\s+(\\d{1,3})\\s*(?:m|min|mins|minutes?)?)?$", F);
    private static final Pattern OPEN = Pattern.compile("^(?:open|go\\s+to|show(?:\\s+me)?|take\\s+me\\s+to)\\s+(?:the\\s+|my\\s+)?([a-z ]+?)(?:\\s+(?:screen|page|tab))?$", F);
    private static final Pattern THEME = Pattern.compile("\\b(dark|light|system)\\s+(?:mode|theme)\\b", F);
    private static final Pattern WATER_GOAL = Pattern.compile("\\bwater\\s+goal\\s+(?:to\\s+)?(\\d+(?:\\.\\d+)?)\\s*(ml|l|litres?|liters?)?\\b", F);
    private static final Pattern NEW_HABIT = Pattern.compile("^(?:add|new|create|start)\\s+(?:a\\s+)?(?:new\\s+)?habit\\s*(?:called|named|:|to)?\\s+(.+)$", F);
    private static final Pattern GOAL = Pattern.compile("^(?:(?:add|new|set)\\s+(?:a\\s+)?goal|goal|my\\s+goal\\s+is)\\s*(?:to|:)?\\s+(.+)$", F);
    private static final Pattern NOTE = Pattern.compile("^(?:note|jot\\s+down|write\\s+down|add\\s+(?:a\\s+)?note)\\s*(?:that|:)?\\s+(.+)$", F);
    private static final Pattern TASK = Pattern.compile("^(?:add\\s+)?(?:a\\s+)?(?:todo|to-do|task)\\s*:?\\s+(?:to\\s+)?(.+)$|^(?:i\\s+)?(?:need\\s+to|have\\s+to|must|gotta)\\s+(.+)$", F);
    private static final Pattern TASK_DONE = Pattern.compile("^(?:i\\s+)?(?:done|finished|completed|did)\\s+(?:with\\s+)?(?:the\\s+|my\\s+)?(.+?)(?:\\s+task)?$", F);
    private static final Pattern ML = Pattern.compile("(\\d+(?:\\.\\d+)?)\\s*(ml|l|litres?|liters?)\\b", F);
    private static final Pattern GLASSES = Pattern.compile(
            "\\b(\\d+|a|an|one|two|three|four|five|six)\\s+(glass(?:es)?|cups?|bottles?)\\b(?:\\s+of\\s+water)?", F);
    private static final Pattern SLEEP = Pattern.compile(
            "\\bslept\\s+(?:for\\s+)?(?:about\\s+|around\\s+)?(\\d+(?:\\.\\d+)?)\\s*(?:h|hr|hrs|hours?)?\\b|\\b(\\d+(?:\\.\\d+)?)\\s*(?:h|hrs?|hours?)\\s+(?:of\\s+)?sleep\\b", F);
    private static final Pattern INCOME = Pattern.compile(
            "\\b(?:got\\s+paid|received|earned|salary(?:\\s+of)?|income(?:\\s+of)?)\\s+" + MONEY + "(?:\\s+(?:from|for|as)\\s+(.+))?", F);
    private static final Pattern SPENT = Pattern.compile(
            "\\b(?:spent|spend|paid)\\s+" + MONEY + "(?:\\s+(?:on|for|at|to)\\s+(.+))?", F);
    private static final Pattern BOUGHT = Pattern.compile("\\bbought\\s+(.+?)\\s+for\\s+" + MONEY, F);
    private static final Pattern PRICE_FIRST = Pattern.compile("^(?:₹|rs\\.?\\s*)(\\d[\\d,]*(?:\\.\\d+)?)\\s+(?:on\\s+|for\\s+)?(.+)$", F);
    private static final Pattern MOOD = Pattern.compile(
            "\\b(?:feeling|feel|felt|mood\\s+(?:is\\s+)?)\\s+(?:very\\s+|so\\s+|a\\s+bit\\s+|pretty\\s+|really\\s+|kinda\\s+)?([a-z]+)", F);
    private static final Pattern FOOD = Pattern.compile(
            "^(?:i\\s+)?(?:ate|had|eaten|eat)\\s+(.+?)(?:\\s+(?:for|at)\\s+(breakfast|lunch|dinner|snack))?$"
                    + "|^(?:for\\s+)?(breakfast|lunch|dinner|snack)\\s*(?:was|:|-)?\\s*(?:i\\s+had\\s+)?(.+)$", F);

    private static final Pattern AT_TIME = Pattern.compile("\\b(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)(?=\\s|$|[,.])|\\bat\\s+(\\d{1,2})(?::(\\d{2}))?\\b|\\b(\\d{1,2}):(\\d{2})\\b", F);
    private static final Pattern IN_TIME = Pattern.compile("\\bin\\s+(\\d{1,3}|an?|half\\s+an)\\s*(min|mins|minutes?|h|hrs?|hours?)\\b", F);
    private static final Pattern NAMED_TIME = Pattern.compile("\\b(?:in\\s+the\\s+|this\\s+|tomorrow\\s+)?(morning|noon|afternoon|evening|tonight|night)\\b", F);
    private static final Pattern DAY = Pattern.compile("\\b(today|tonight|tomorrow|day\\s+after\\s+tomorrow|(?:on\\s+|next\\s+|this\\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\\b", F);
    private static final Pattern REPEAT = Pattern.compile("\\b(every\\s*day|everyday|daily|every\\s+(?:week\\s*day|working\\s+day)s?|weekdays|on\\s+weekdays|every\\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|weekly|every\\s+week|every\\s+month|monthly|every\\s+year|yearly)\\b", F);
    private static final Pattern LEAD = Pattern.compile("\\b(\\d{1,3}|an?|half\\s+an)\\s*(min|mins|minutes?|h|hrs?|hours?|days?)\\s+(?:before|early|earlier|ahead)\\b", F);

    private static final Map<String, Integer> WORDS = Map.of(
            "a", 1, "an", 1, "one", 1, "two", 2, "three", 3, "four", 4, "five", 5, "six", 6);
    private static final Map<String, String> SCREENS = Map.ofEntries(
            Map.entry("home", "home"), Map.entry("money", "money"), Map.entry("budget", "money"),
            Map.entry("expenses", "money"), Map.entry("calendar", "calendar"), Map.entry("reminders", "calendar"),
            Map.entry("notes", "notes"), Map.entry("goals", "goals"), Map.entry("habits", "habits"),
            Map.entry("food", "food"), Map.entry("focus", "focus"), Map.entry("timer", "focus"),
            Map.entry("report", "report"), Map.entry("progress", "report"), Map.entry("family", "family"),
            Map.entry("circle", "circle"), Map.entry("buddy", "mentor"), Map.entry("chat", "mentor"),
            Map.entry("achievements", "achievements"), Map.entry("badges", "achievements"),
            Map.entry("settings", "settings"), Map.entry("food summary", "summary"), Map.entry("nutrition", "summary"));

    static List<Intent> parse(String text, List<String> habits, LocalDate today, LocalTime now) {
        List<Intent> out = new ArrayList<>();
        if (text == null) return out;
        for (String part : text.split("(?<!\\d),|,(?!\\d{3}\\b)|[;\\n]+|\\.\\s+")) {
            for (String clause : CLAUSE_AND.split(part)) {
                String c = clause.strip().replaceAll("[.!?]+$", "");
                if (!c.isEmpty()) clause(c, habits, today, now, out);
            }
        }
        return out;
    }

    private static void clause(String c, List<String> habits, LocalDate today, LocalTime now, List<Intent> out) {
        Matcher m;
        if ((m = REMIND.matcher(c)).matches()) {
            Intent r = reminder(m.group(1), today, now);
            if (r != null) out.add(r);
            return;
        }
        if ((m = FOCUS.matcher(c)).matches()) {
            out.add(Intent.of("focus").minutes(m.group(1) == null ? null : clamp(Integer.parseInt(m.group(1)), 1, 240)));
            return;
        }
        if ((m = THEME.matcher(c)).find()) {
            out.add(Intent.of("setting").kv("theme", m.group(1).toLowerCase(Locale.ROOT)));
            return;
        }
        if ((m = WATER_GOAL.matcher(c)).find()) {
            out.add(Intent.of("setting").kv("waterGoal", String.valueOf(ml(m.group(1), m.group(2)))));
            return;
        }
        if ((m = OPEN.matcher(c)).matches()) {
            String screen = SCREENS.get(m.group(1).strip().toLowerCase(Locale.ROOT));
            if (screen != null) {
                out.add(Intent.of("open").screen(screen));
                return;
            }
        }
        if ((m = NEW_HABIT.matcher(c)).matches()) {
            out.add(Intent.of("habit_new").name(cap(m.group(1), 120)));
            return;
        }
        if ((m = GOAL.matcher(c)).matches()) {
            out.add(Intent.of("goal").title(cap(m.group(1), 255)));
            return;
        }
        if ((m = NOTE.matcher(c)).matches()) {
            out.add(Intent.of("note").text(cap(m.group(1), 2000)));
            return;
        }
        boolean any = false;
        if ((m = SLEEP.matcher(c)).find()) {
            double h = Double.parseDouble(m.group(1) != null ? m.group(1) : m.group(2));
            if (h > 0 && h <= 24) {
                out.add(Intent.of("sleep").hours(h).quality(sleepQuality(c)));
                any = true;
            }
        }
        if ((m = INCOME.matcher(c)).find()) {
            int amt = money(m.group(1));
            if (amt > 0) {
                out.add(Intent.of("income").amount(amt).note(m.group(2) == null ? incomeLabel(c) : cap(m.group(2), 120)));
                return;
            }
        }
        if ((m = SPENT.matcher(c)).find()) {
            int amt = money(m.group(1));
            if (amt > 0) {
                out.add(Intent.of("expense").amount(amt).note(cap(m.group(2), 120)));
                return;
            }
        }
        if ((m = BOUGHT.matcher(c)).find()) {
            int amt = money(m.group(2));
            if (amt > 0) {
                out.add(Intent.of("expense").amount(amt).note(cap(m.group(1), 120)));
                return;
            }
        }
        if ((m = PRICE_FIRST.matcher(c)).matches()) {
            int amt = money(m.group(1));
            if (amt > 0) {
                out.add(Intent.of("expense").amount(amt).note(cap(m.group(2), 120)));
                return;
            }
        }
        boolean watery = c.toLowerCase(Locale.ROOT).matches(".*\\b(water|drank|drink|hydrat\\w*)\\b.*");
        if ((m = ML.matcher(c)).find() && (watery || c.strip().equalsIgnoreCase(m.group()))) {
            out.add(Intent.of("water").amountMl(ml(m.group(1), m.group(2))));
            any = true;
        } else if ((m = GLASSES.matcher(c)).find() && watery) {
            int n = WORDS.getOrDefault(m.group(1).toLowerCase(Locale.ROOT), 0);
            if (n == 0) n = Integer.parseInt(m.group(1));
            int each = m.group(2).toLowerCase(Locale.ROOT).startsWith("bottle") ? 500 : 250;
            out.add(Intent.of("water").amountMl(clamp(n * each, 1, 5000)));
            any = true;
        }
        if ((m = MOOD.matcher(c)).find()) {
            String mood = m.group(1).toLowerCase(Locale.ROOT);
            out.add(Intent.of("mood").mood(mood).energy(energyOf(mood)));
            any = true;
        }
        if (any) return;
        String habit = habitIn(c, habits);
        if (habit != null) {
            out.add(Intent.of("habit").name(habit));
            return;
        }
        if ((m = TASK_DONE.matcher(c)).matches()) {
            out.add(Intent.of("task_done").title(cap(m.group(1), 255)));
            return;
        }
        if ((m = FOOD.matcher(c)).matches()) {
            String items = m.group(1) != null ? m.group(1) : m.group(4);
            String meal = m.group(2) != null ? m.group(2) : m.group(3);
            for (String item : items.split("\\s+(?:and|with|&)\\s+|\\s*\\+\\s*")) {
                if (!item.isBlank()) {
                    out.add(Intent.of("food").name(cap(item, 255)).meal(meal == null ? null : meal.toLowerCase(Locale.ROOT)));
                }
            }
            return;
        }
        if ((m = TASK.matcher(c)).matches()) {
            out.add(Intent.of("task").title(cap(m.group(1) != null ? m.group(1) : m.group(2), 255)));
        }
    }

    /** "tomorrow at 9pm to call mom, 10 minutes before" -> every field the words carry. */
    static Intent reminder(String rest, LocalDate today, LocalTime now) {
        String s = " " + rest + " ";
        String said = s;
        LocalDate date = today;
        LocalTime time = null;
        String repeat = "none";
        Integer lead = null;
        Matcher m;
        if ((m = LEAD.matcher(s)).find()) {
            lead = minutes(m.group(1), m.group(2));
            s = cut(s, m);
        }
        if ((m = REPEAT.matcher(s)).find()) {
            String r = m.group(1).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
            if (m.group(2) != null) {
                repeat = "weekly";
                date = today.with(TemporalAdjusters.nextOrSame(DayOfWeek.valueOf(m.group(2).toUpperCase(Locale.ROOT))));
            } else if (r.contains("week day") || r.contains("weekday") || r.contains("working")) {
                repeat = "weekdays";
            } else if (r.contains("day")) {
                repeat = "daily";
            } else if (r.contains("week")) {
                repeat = "weekly";
            } else if (r.contains("month")) {
                repeat = "monthly";
            } else {
                repeat = "yearly";
            }
            s = cut(s, m);
        }
        if ((m = IN_TIME.matcher(s)).find()) {
            int mins = minutes(m.group(1), m.group(2));
            java.time.LocalDateTime at = today.atTime(now).plusMinutes(mins);
            date = at.toLocalDate();
            time = at.toLocalTime().withSecond(0).withNano(0);
            s = cut(s, m);
        }
        if ((m = DAY.matcher(s)).find()) {
            String d = m.group(1).toLowerCase(Locale.ROOT);
            if (d.startsWith("tomorrow")) {
                date = today.plusDays(1);
            } else if (d.startsWith("day after")) {
                date = today.plusDays(2);
            } else if (m.group(2) != null) {
                DayOfWeek dow = DayOfWeek.valueOf(m.group(2).toUpperCase(Locale.ROOT));
                date = d.startsWith("next") ? today.with(TemporalAdjusters.next(dow)) : today.with(TemporalAdjusters.nextOrSame(dow));
            }
            if (d.equals("tonight") && time == null) time = LocalTime.of(20, 0);
            s = cut(s, m);
        }
        if (time == null && (m = AT_TIME.matcher(s)).find()) {
            int h;
            int min;
            if (m.group(1) != null) {
                h = Integer.parseInt(m.group(1));
                min = m.group(2) == null ? 0 : Integer.parseInt(m.group(2));
                boolean pm = m.group(3).toLowerCase(Locale.ROOT).startsWith("p");
                if (h == 12) h = 0;
                if (pm) h += 12;
            } else if (m.group(4) != null) {
                h = Integer.parseInt(m.group(4));
                min = m.group(5) == null ? 0 : Integer.parseInt(m.group(5));
            } else {
                h = Integer.parseInt(m.group(6));
                min = Integer.parseInt(m.group(7));
            }
            if (h <= 23 && min <= 59) {
                time = LocalTime.of(h, min);
                s = cut(s, m);
            }
        }
        if (time == null && (m = NAMED_TIME.matcher(s)).find()) {
            time = switch (m.group(1).toLowerCase(Locale.ROOT)) {
                case "morning" -> LocalTime.of(9, 0);
                case "noon" -> LocalTime.of(12, 0);
                case "afternoon" -> LocalTime.of(15, 0);
                case "evening" -> LocalTime.of(18, 0);
                default -> LocalTime.of(20, 0);
            };
            s = cut(s, m);
        }
        String what = s.replaceAll("\\s+", " ").strip()
                .replaceAll("^(?:(?:to|that|about|on|at|me)\\s+)+", "")
                .replaceAll("\\s+(?:to|on|at|by)$", "").strip();
        if (what.isEmpty()) return null;
        if (lead != null && (time == null || lead > 1440)) lead = null;
        date = anchor(said, date, repeat, today, time, now);
        return Intent.of("reminder").text(cap(what.substring(0, 1).toUpperCase(Locale.ROOT) + what.substring(1), 120))
                .when(date, time, repeat, tagOf(what), lead);
    }

    private static final Pattern WEEKDAY = Pattern.compile(
            "\\b(next\\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\\b", F);

    /**
     * The first day of a reminder, checked against the weekday the words name: the
     * model has filed "every Monday" on a Tuesday, and a weekly series rings on its
     * anchor's weekday for ever. With exactly one weekday in the text, a date on
     * another weekday (or already gone, or today with the time passed) becomes the
     * next one that day falls on ("next X" never means today). A weekdays series
     * never starts on a weekend; a one-off with no day said whose time has gone
     * today is tomorrow's. Anything else is left as read.
     *
     * <p>ponytail: one weekday per message; "Monday and Friday" or two reminders on
     * two days are trusted as read. English weekday names only.
     */
    private static final Pattern TODAY_SAID = Pattern.compile("\\b(today|tonight)\\b", F);

    static LocalDate anchor(String text, LocalDate date, String repeat, LocalDate today, LocalTime time, LocalTime now) {
        if (date == null) date = today;
        DayOfWeek named = null;
        boolean next = false;
        Matcher m = WEEKDAY.matcher(text == null ? "" : text);
        while (m.find()) {
            DayOfWeek d = DayOfWeek.valueOf(m.group(2).toUpperCase(Locale.ROOT));
            if (named != null && named != d) return date;
            named = d;
            next |= m.group(1) != null;
        }
        boolean passed = time != null && now != null && !time.isAfter(now);
        if (named != null) {
            boolean ok = date.getDayOfWeek() == named && !date.isBefore(today)
                    && !(date.equals(today) && (passed || next));
            if (ok) return date;
            LocalDate first = today.with(TemporalAdjusters.nextOrSame(named));
            return first.equals(today) && (passed || next) ? first.plusWeeks(1) : first;
        }
        // "remind me at 9pm" at 23:45: no day was said, so the next 9pm is tomorrow's
        // (EXS-5). Only a one-off: a series still has tomorrow, and the app refuses only
        // a single occurrence that has gone. "today" / "tonight" said out loud are kept.
        if ("none".equals(repeat) && passed && date.equals(today) && !TODAY_SAID.matcher(text == null ? "" : text).find()) {
            return today.plusDays(1);
        }
        if ("weekdays".equals(repeat)) {
            while (date.getDayOfWeek() == DayOfWeek.SATURDAY || date.getDayOfWeek() == DayOfWeek.SUNDAY) {
                date = date.plusDays(1);
            }
        }
        return date;
    }

    private static String cut(String s, Matcher m) {
        return s.substring(0, m.start()) + " " + s.substring(m.end());
    }

    private static int minutes(String n, String unit) {
        String k = n.toLowerCase(Locale.ROOT);
        double v = k.startsWith("half") ? 0.5 : WORDS.containsKey(k) ? WORDS.get(k) : Double.parseDouble(k);
        String u = unit.toLowerCase(Locale.ROOT);
        return (int) Math.round(u.startsWith("d") ? v * 1440 : u.startsWith("h") ? v * 60 : v);
    }

    private static String habitIn(String c, List<String> habits) {
        if (habits == null) return null;
        String low = " " + c.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ") + " ";
        String best = null;
        for (String h : habits) {
            if (h == null || h.strip().length() < 3) continue;
            String n = " " + h.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").strip() + " ";
            if (low.contains(n) && (best == null || h.length() > best.length())) best = h;
        }
        return best;
    }

    static String tagOf(String what) {
        String w = what.toLowerCase(Locale.ROOT);
        if (w.matches(".*\\b(urgent|asap|important)\\b.*")) return "urgent";
        if (w.matches(".*\\b(medicine|meds|pill|pills|tablet|doctor|dentist|gym|workout|water|vitamin)s?\\b.*")) return "health";
        if (w.matches(".*\\b(meeting|standup|stand-up|client|office|call with|deadline|report|interview)\\b.*")) return "work";
        return "personal";
    }

    private static String sleepQuality(String c) {
        String s = c.toLowerCase(Locale.ROOT);
        if (s.matches(".*\\b(badly|poorly|bad|terrible|awful|restless)\\b.*")) return "poor";
        if (s.matches(".*\\b(great|amazing|excellent)\\b.*")) return "great";
        if (s.matches(".*\\b(well|good|nicely|deeply)\\b.*")) return "good";
        return "ok";
    }

    private static String energyOf(String mood) {
        if (mood.matches("tired|exhausted|sleepy|drained|sick|low|sad|lazy|weak")) return "low";
        if (mood.matches("energetic|great|amazing|pumped|excited|awesome|fantastic|motivated")) return "high";
        return "medium";
    }

    private static String incomeLabel(String c) {
        return c.toLowerCase(Locale.ROOT).contains("salary") ? "Salary" : "Income";
    }

    private static int ml(String n, String unit) {
        double v = Double.parseDouble(n);
        return clamp((int) Math.round(unit != null && unit.toLowerCase(Locale.ROOT).startsWith("l") ? v * 1000 : v), 1, 5000);
    }

    private static int money(String n) {
        try {
            return clamp((int) Math.round(Double.parseDouble(n.replace(",", ""))), 0, 100_000_000);
        } catch (NumberFormatException ex) {
            return 0;
        }
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    private static String cap(String s, int max) {
        if (s == null) return null;
        s = s.strip();
        return s.length() <= max ? s : s.substring(0, max);
    }
}
