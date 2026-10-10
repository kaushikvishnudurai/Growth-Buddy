package com.growthbuddy.reminder;

import com.growthbuddy.common.WorkWeek;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/**
 * The user's reminders as an iCalendar file ({@code GET /api/reminders/export.ics}).
 *
 * <p>One VEVENT per reminder, its rule mapped onto RRULE. Times are LOCAL with
 * {@code TZID} = the user's zone, the same way the scheduler treats them: 09:00
 * stays 09:00 through a DST change. Pure and static so it can be tested without
 * Spring.
 *
 * <p>Mapping notes, where our model and RFC 5545 differ:
 * <ul>
 *   <li>A monthly date on the 29th-31st clamps to the month's last day here; RRULE's
 *       BYMONTHDAY=31 would skip short months, so it becomes
 *       {@code BYMONTHDAY=28,29,30,31;BYSETPOS=-1} (the last of those that exist).
 *       Same trick for a yearly Feb 29.</li>
 *   <li>RRULE may not carry both COUNT and UNTIL; ours ends at whichever comes
 *       first, so only that one is written.</li>
 *   <li>DTSTART has to be an occurrence (RFC: otherwise the set is undefined), so
 *       it is the first day the rule lands on at or after the anchor / "from"
 *       bound, and COUNT is what is left from there.</li>
 *   <li>'weekdays' is written as the user's working week, BYDAY=MO,TU,... — an
 *       export is a snapshot, so changing the working week later doesn't follow.</li>
 * </ul>
 * ponytail: no VTIMEZONE block — Google, Apple and Outlook.com resolve an IANA
 * TZID on their own. Add one generated from ZoneRules if a strict client refuses.
 */
final class ReminderIcs {

    private static final DateTimeFormatter LOCAL = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss");
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("yyyyMMdd");
    private static final DateTimeFormatter UTC = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'");
    /** How far ahead to look for a series' first live day before giving up on it. */
    private static final int FIRST_SCAN_DAYS = 366 * 10;

    private ReminderIcs() {
    }

    static String build(List<CalendarReminder> reminders, ZoneId zone, WorkWeek workWeek,
                        int defaultLead, Instant now) {
        List<String> out = new ArrayList<>();
        out.add("BEGIN:VCALENDAR");
        out.add("VERSION:2.0");
        out.add("PRODID:-//Growth Buddy//Reminders//EN");
        out.add("CALSCALE:GREGORIAN");
        out.add("METHOD:PUBLISH");
        out.add("X-WR-CALNAME:Growth Buddy reminders");
        out.add("X-WR-TIMEZONE:" + zone.getId());
        String stamp = UTC.format(now.atOffset(ZoneOffset.UTC));
        for (CalendarReminder r : reminders) {
            event(out, r, zone, workWeek, defaultLead, stamp);
        }
        out.add("END:VCALENDAR");
        StringBuilder sb = new StringBuilder();
        for (String line : out) {
            sb.append(fold(line)).append("\r\n");
        }
        return sb.toString();
    }

    private static void event(List<String> out, CalendarReminder r, ZoneId zone, WorkWeek workWeek,
                              int defaultLead, String stamp) {
        boolean repeats = r.getRepeat() != RepeatFreq.none;
        LocalDate start = r.getAnchorDate();
        Integer count = repeats ? r.getRepeatCount() : null;
        if (repeats) {
            LocalDate from = r.getFromDate() != null && r.getFromDate().isAfter(start) ? r.getFromDate() : start;
            LocalDate first = firstOnOrAfter(r, from, workWeek);
            if (first == null || (r.getUntilDate() != null && first.isAfter(r.getUntilDate()))) {
                return; // nothing left to export
            }
            if (count != null) {
                count -= ReminderService.countBefore(r, first, workWeek);
                if (count < 1) {
                    return;
                }
            }
            start = first;
        }
        LocalTime time = r.getTime();
        String tz = ";TZID=" + zone.getId();

        out.add("BEGIN:VEVENT");
        out.add("UID:" + r.getId() + "@growthbuddy");
        out.add("DTSTAMP:" + stamp);
        out.add("SUMMARY:" + text(r.getText()));
        if (r.getNotes() != null && !r.getNotes().isBlank()) {
            out.add("DESCRIPTION:" + text(r.getNotes()));
        }
        out.add("CATEGORIES:" + text(String.valueOf(r.getTag())));
        if (time != null) {
            out.add("DTSTART" + tz + ":" + LOCAL.format(start.atTime(time)));
            if (r.getEndTime() != null) {
                out.add("DTEND" + tz + ":" + LOCAL.format(start.atTime(r.getEndTime())));
            }
        } else {
            out.add("DTSTART;VALUE=DATE:" + DATE.format(start));
            out.add("DTEND;VALUE=DATE:" + DATE.format(start.plusDays(1)));
        }
        if (repeats) {
            out.add("RRULE:" + rrule(r, count, zone, workWeek));
            Set<LocalDate> skips = new TreeSet<>(r.getSkipDays());
            for (LocalDate s : skips) {
                out.add(time != null
                        ? "EXDATE" + tz + ":" + LOCAL.format(s.atTime(time))
                        : "EXDATE;VALUE=DATE:" + DATE.format(s));
            }
        }
        if (time != null) {
            int lead = r.getNotifyBefore() != null ? r.getNotifyBefore() : defaultLead;
            alarm(out, lead, r.getText());
            Integer second = r.getNotifyBefore2();
            if (second != null && second != lead) {
                alarm(out, second, r.getText());
            }
        }
        out.add("END:VEVENT");
    }

    static String rrule(CalendarReminder r, Integer count, ZoneId zone, WorkWeek workWeek) {
        StringBuilder sb = new StringBuilder("FREQ=");
        LocalDate anchor = r.getAnchorDate();
        int n = Math.max(1, r.getRepeatInterval());
        switch (r.getRepeat()) {
            case daily -> sb.append("DAILY");
            case weekdays -> {
                EnumSet<DayOfWeek> days = EnumSet.noneOf(DayOfWeek.class);
                for (DayOfWeek d : DayOfWeek.values()) {
                    if (workWeek.includes(d)) {
                        days.add(d);
                    }
                }
                sb.append("WEEKLY;BYDAY=").append(ReminderService.toCodes(days));
                n = 1;
            }
            case weekly -> {
                Set<DayOfWeek> days = ReminderService.daysOf(r.getRepeatDays());
                if (days.isEmpty()) {
                    days = EnumSet.of(anchor.getDayOfWeek());
                }
                sb.append("WEEKLY;WKST=MO;BYDAY=").append(ReminderService.toCodes(days));
            }
            case monthly -> {
                sb.append("MONTHLY");
                Integer nth = r.getRepeatNth();
                if (nth != null && nth != 0) {
                    sb.append(";BYDAY=").append(nth).append(ReminderService.codeOf(anchor.getDayOfWeek()));
                } else {
                    sb.append(monthDay(anchor.getDayOfMonth()));
                }
            }
            case yearly -> {
                sb.append("YEARLY;BYMONTH=").append(anchor.getMonthValue());
                sb.append(anchor.getMonthValue() == 2 && anchor.getDayOfMonth() == 29
                        ? ";BYMONTHDAY=28,29;BYSETPOS=-1"
                        : ";BYMONTHDAY=" + anchor.getDayOfMonth());
            }
            case none -> throw new IllegalStateException("a one-off has no rule");
        }
        if (n > 1) {
            sb.append(";INTERVAL=").append(n);
        }
        LocalDate until = r.getUntilDate();
        if (count != null && until != null) {
            // Only one may be written: keep whichever ends the series first.
            LocalDate last = ReminderService.lastByCount(r, r.getRepeatCount(), workWeek);
            if (last != null && !last.isAfter(until)) {
                until = null;
            } else {
                count = null;
            }
        }
        if (count != null) {
            sb.append(";COUNT=").append(count);
        } else if (until != null) {
            // With a TZID'd DTSTART, UNTIL has to be UTC; the end of that local day.
            sb.append(";UNTIL=").append(r.getTime() != null
                    ? UTC.format(ZonedDateTime.of(until, LocalTime.of(23, 59, 59), zone)
                            .withZoneSameInstant(ZoneOffset.UTC))
                    : DATE.format(until));
        }
        return sb.toString();
    }

    /** By date, with the 29th-31st clamped the way occursOn clamps them. */
    private static String monthDay(int day) {
        return switch (day) {
            case 29 -> ";BYMONTHDAY=28,29;BYSETPOS=-1";
            case 30 -> ";BYMONTHDAY=28,29,30;BYSETPOS=-1";
            case 31 -> ";BYMONTHDAY=28,29,30,31;BYSETPOS=-1";
            default -> ";BYMONTHDAY=" + day;
        };
    }

    private static LocalDate firstOnOrAfter(CalendarReminder r, LocalDate from, WorkWeek workWeek) {
        LocalDate d = from;
        for (int i = 0; i < FIRST_SCAN_DAYS; i++, d = d.plusDays(1)) {
            if (ReminderService.matchesRule(r, d, workWeek)) {
                return d;
            }
        }
        return null;
    }

    private static void alarm(List<String> out, int minutes, String text) {
        out.add("BEGIN:VALARM");
        out.add("ACTION:DISPLAY");
        out.add("DESCRIPTION:" + text(text));
        out.add("TRIGGER:" + (minutes == 0 ? "PT0M" : "-PT" + minutes + "M"));
        out.add("END:VALARM");
    }

    /** TEXT escaping (RFC 5545 3.3.11). */
    static String text(String s) {
        return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
                .replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n");
    }

    /** Lines longer than 75 octets continue on the next with a leading space, never splitting a UTF-8 char. */
    static String fold(String line) {
        byte[] bytes = line.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if (bytes.length <= 75) {
            return line;
        }
        StringBuilder sb = new StringBuilder();
        int used = 0;
        int limit = 75;
        for (int i = 0; i < line.length(); ) {
            int cp = line.codePointAt(i);
            int len = new String(Character.toChars(cp)).getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
            if (used + len > limit) {
                sb.append("\r\n ");
                used = 0;
                limit = 74; // the leading space counts
            }
            sb.appendCodePoint(cp);
            used += len;
            i += Character.charCount(cp);
        }
        return sb.toString();
    }
}
