package com.growthbuddy.reminder;

import java.time.LocalTime;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The user's reminder defaults, read from {@code ui_prefs} like the working
 * week: {@code reminderLead} (minutes ahead to notify, 0 = at the time) and
 * {@code snoozeMinutes}. Set in Settings → Reminders; a reminder's own
 * {@code notifyBefore} wins over the lead.
 */
public final class ReminderPrefs {

    public static final int MAX_LEAD = 1440;
    public static final int DEFAULT_SNOOZE = 10;
    public static final int MAX_SNOOZE = 240;

    private ReminderPrefs() {
    }

    public static int leadOf(Map<String, Object> uiPrefs) {
        return clamp(read(uiPrefs, "reminderLead"), 0, 0, MAX_LEAD);
    }

    public static int snoozeOf(Map<String, Object> uiPrefs) {
        return clamp(read(uiPrefs, "snoozeMinutes"), DEFAULT_SNOOZE, 1, MAX_SNOOZE);
    }

    /** The reminder's own lead when it has one, the user's default otherwise. */
    public static int leadFor(CalendarReminder r, Map<String, Object> uiPrefs) {
        Integer own = r.getNotifyBefore();
        return own != null ? clamp(own, 0, 0, MAX_LEAD) : leadOf(uiPrefs);
    }

    /**
     * The second alert's lead, or null when there is none or it would ring with
     * the first ({@code lead}). It has no default to fall back on.
     */
    public static Integer secondLeadFor(CalendarReminder r, int lead) {
        Integer two = r.getNotifyBefore2();
        if (two == null || two < 0 || two > MAX_LEAD || two == lead) return null;
        return two;
    }

    /*
     * Quiet hours: ui_prefs.quietStart / quietEnd, "HH:MM" local, set in
     * Settings → Alerts. A window may wrap midnight (22:00 → 07:00); missing,
     * unreadable or equal ends mean off.
     *
     * What it silences: the nudges the app sends on its own — habit reminders,
     * the water nudge (on the device only; the server sends none) and the
     * digest, which waits for the window to end. NOT a timed reminder the user
     * set: they picked that minute, so it rings (the same on the device, push.js).
     */
    public static LocalTime quietStartOf(Map<String, Object> uiPrefs) {
        return time(uiPrefs, "quietStart");
    }

    public static LocalTime quietEndOf(Map<String, Object> uiPrefs) {
        return time(uiPrefs, "quietEnd");
    }

    /** Is local time {@code t} inside the user's quiet hours? End exclusive. */
    public static boolean isQuiet(Map<String, Object> uiPrefs, LocalTime t) {
        LocalTime from = quietStartOf(uiPrefs);
        LocalTime to = quietEndOf(uiPrefs);
        if (from == null || to == null || from.equals(to) || t == null) return false;
        return from.isBefore(to)
                ? !t.isBefore(from) && t.isBefore(to)
                : !t.isBefore(from) || t.isBefore(to);
    }

    private static LocalTime time(Map<String, Object> prefs, String key) {
        Object raw = prefs == null ? null : prefs.get(key);
        if (!(raw instanceof String s)) return null;
        Matcher m = HHMM.matcher(s.trim());
        if (!m.matches()) return null;
        int h = Integer.parseInt(m.group(1));
        int min = Integer.parseInt(m.group(2));
        return h < 24 && min < 60 ? LocalTime.of(h, min) : null;
    }

    private static final Pattern HHMM = Pattern.compile("(\\d{1,2}):(\\d{2})(?::\\d{2})?");

    /** "5 min", "1 h", "1 h 30 min", "1 day". */
    public static String human(int minutes) {
        if (minutes >= 1440 && minutes % 1440 == 0) {
            int d = minutes / 1440;
            return d + (d == 1 ? " day" : " days");
        }
        int h = minutes / 60;
        int m = minutes % 60;
        if (h == 0) return m + " min";
        return m == 0 ? h + " h" : h + " h " + m + " min";
    }

    private static Integer read(Map<String, Object> prefs, String key) {
        Object raw = prefs == null ? null : prefs.get(key);
        if (raw instanceof Number n) return n.intValue();
        if (raw instanceof String s) {
            try {
                return Integer.parseInt(s.trim());
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private static int clamp(Integer v, int fallback, int min, int max) {
        if (v == null || v < min || v > max) return fallback;
        return v;
    }
}
