package com.growthbuddy.habit;

import com.growthbuddy.common.ApiException;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

/**
 * "Take a break" (I-08): {@code ui_prefs.breakFrom} .. {@code breakUntil},
 * 'YYYY-MM-DD' in the user's own zone, both days inclusive. A day inside it is
 * rest: a habit streak holds over it as over a freeze (no token spent), nothing
 * is owed that day (the score's denominator), and the nudges the app sends on
 * its own stay quiet (habit reminders, the evening reflection, the digest). A
 * timed reminder the user set still rings, as under quiet hours.
 *
 * <p>Ending early moves {@code breakUntil} to yesterday. Starting a new break
 * overwrites the pair, so the old range is kept in {@code breakPast}
 * ("from..until", newest last), which only the server writes ({@link #settle}):
 * a streak that runs across an old break still has to find that gap protected.
 */
public final class OnBreak {

    public static final String FROM = "breakFrom";
    public static final String UNTIL = "breakUntil";
    public static final String PAST = "breakPast";
    /** 14 days, plus the yesterday a rescue from the at-risk prompt starts on. */
    static final int MAX_DAYS = 15;
    /** ponytail: older breaks are forgotten; past ~a year the cached streak carries the run anyway. */
    static final int MAX_PAST = 12;

    private OnBreak() {
    }

    /** Is {@code day} a break day (the current break or a remembered one)? */
    public static boolean on(Map<String, Object> prefs, LocalDate day) {
        if (day == null) return false;
        for (LocalDate[] r : ranges(prefs)) {
            if (!day.isBefore(r[0]) && !day.isAfter(r[1])) return true;
        }
        return false;
    }

    /** Every break day up to and including {@code through}. A few dozen at most. */
    static Set<LocalDate> days(Map<String, Object> prefs, LocalDate through) {
        Set<LocalDate> out = new TreeSet<>();
        for (LocalDate[] r : ranges(prefs)) {
            for (LocalDate d = r[0]; !d.isAfter(r[1]) && !d.isAfter(through); d = d.plusDays(1)) {
                out.add(d);
            }
        }
        return out;
    }

    /**
     * The prefs a save may store, given the user's {@code today}. A client never
     * writes {@code breakPast} (it is put back to what the server had), and a break
     * can't be pointed at the past to mend a streak that already broke: a new or
     * moved start must be today or yesterday, the end no earlier than yesterday, and
     * the whole of it at most {@link #MAX_DAYS}. An empty range (ended on its first
     * day) is always fine. A new start files the previous range under breakPast.
     */
    public static Map<String, Object> settle(Map<String, Object> before, Map<String, Object> after,
                                             LocalDate today) {
        Map<String, Object> out = new HashMap<>(after);
        Object past = before.get(PAST);
        if (past == null) out.remove(PAST);
        else out.put(PAST, past);
        LocalDate oldFrom = date(before.get(FROM));
        LocalDate oldUntil = date(before.get(UNTIL));
        LocalDate from = date(out.get(FROM));
        LocalDate until = date(out.get(UNTIL));
        if (Objects.equals(oldFrom, from) && Objects.equals(oldUntil, until)) return out;
        if (from != null && until != null && !until.isBefore(from)) {
            LocalDate floor = today.minusDays(1);
            boolean sameBreak = Objects.equals(oldFrom, from) && oldUntil != null && !oldUntil.isBefore(floor);
            if (ChronoUnit.DAYS.between(from, until) + 1 > MAX_DAYS || until.isBefore(floor)
                    || (from.isBefore(floor) && !sameBreak)) {
                throw ApiException.badRequest("A break runs up to 14 days, starting today.");
            }
        }
        if (oldFrom != null && oldUntil != null && !oldUntil.isBefore(oldFrom) && !Objects.equals(oldFrom, from)) {
            List<Object> kept = new ArrayList<>(past instanceof List<?> l ? l : List.of());
            kept.add(oldFrom + ".." + oldUntil);
            out.put(PAST, new ArrayList<>(kept.subList(Math.max(0, kept.size() - MAX_PAST), kept.size())));
        }
        return out;
    }

    /** The current break plus the remembered ones; unreadable entries are skipped. */
    private static List<LocalDate[]> ranges(Map<String, Object> prefs) {
        List<LocalDate[]> out = new ArrayList<>();
        if (prefs == null) return out;
        add(out, date(prefs.get(FROM)), date(prefs.get(UNTIL)));
        if (prefs.get(PAST) instanceof List<?> list) {
            for (Object o : list) {
                String[] p = o instanceof String s ? s.split("\\.\\.") : new String[0];
                if (p.length == 2) add(out, date(p[0]), date(p[1]));
            }
        }
        return out;
    }

    private static void add(List<LocalDate[]> out, LocalDate from, LocalDate until) {
        if (from == null || until == null || until.isBefore(from)
                || ChronoUnit.DAYS.between(from, until) + 1 > MAX_DAYS) return;
        out.add(new LocalDate[] {from, until});
    }

    private static LocalDate date(Object raw) {
        if (!(raw instanceof String s)) return null;
        try {
            return LocalDate.parse(s.trim());
        } catch (RuntimeException ex) {
            return null;
        }
    }
}
