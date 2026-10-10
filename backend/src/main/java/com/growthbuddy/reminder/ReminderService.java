package com.growthbuddy.reminder;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.WorkWeek;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.transaction.annotation.Transactional;

/**
 * Calendar-reminder logic. Recurrence expansion and scoped deletes mirror the
 * frontend ({@code scripts/calendar.js} and {@code app.js}) so behavior is identical.
 */
@Service
public class ReminderService {

    /** How far back the list DTO's doneDates reach. Past days are read-only, so older ticks only cost bytes. */
    static final int DONE_LOOKBACK_DAYS = 90;
    static final int MAX_INTERVAL = 99;
    static final int MAX_COUNT = 999;
    /** How far {@link #lastByCount} looks for the Nth occurrence before calling it endless. */
    private static final int MAX_SCAN_DAYS = 366 * 100;
    private static final List<String> DAY_CODES = List.of("MO", "TU", "WE", "TH", "FR", "SA", "SU");

    private final CalendarReminderRepository repo;
    private final UserClock clock;
    private final UserRepository users;
    /** Null in the pure-logic tests, which never touch a done row. */
    private final ReminderDoneRepository done;

    /** For tests of the pure parts: no done-tracking. */
    public ReminderService(CalendarReminderRepository repo, UserClock clock, UserRepository users) {
        this(repo, clock, users, null);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public ReminderService(CalendarReminderRepository repo, UserClock clock, UserRepository users,
                           ReminderDoneRepository done) {
        this.repo = repo;
        this.clock = clock;
        this.users = users;
        this.done = done;
    }

    @Transactional(readOnly = true)
    public List<ReminderResponse> list(UUID userId) {
        Map<UUID, Set<LocalDate>> ticks = new HashMap<>();
        if (done != null) {
            LocalDate since = clock.today(userId).minusDays(DONE_LOOKBACK_DAYS);
            for (ReminderDone d : done.findByUserIdAndOccurrenceDateGreaterThanEqual(userId, since)) {
                ticks.computeIfAbsent(d.getReminderId(), k -> new TreeSet<>()).add(d.getOccurrenceDate());
            }
        }
        return repo.findByUserId(userId).stream()
                .map(r -> ReminderResponse.from(r, ticks.getOrDefault(r.getId(), Set.of())))
                .toList();
    }

    /**
     * Check one occurrence off ({@code on}) or back on. Only a day the reminder
     * actually lands on can be done. Checking off also drops a pending snooze of
     * that occurrence ({@link #snoozeDay}): it has been dealt with. A snooze of
     * another day's occurrence stays, so ticking tomorrow off ahead of time does
     * not silence today's.
     */
    @Transactional
    public void setDone(UUID userId, UUID id, LocalDate day, boolean on) {
        CalendarReminder r = repo.findByIdAndUserId(id, userId)
                .orElseThrow(() -> ApiException.notFound("Reminder"));
        if (day == null) {
            throw ApiException.badRequest("'date' is required");
        }
        var existing = done.findByReminderIdAndOccurrenceDate(id, day);
        if (!on) {
            existing.ifPresent(done::delete);
            return;
        }
        if (!occursOn(r, day, workWeekOf(userId))) {
            throw ApiException.badRequest("That reminder isn't on " + day + ".");
        }
        if (existing.isEmpty()) {
            ReminderDone d = new ReminderDone();
            d.setReminderId(id);
            d.setUserId(userId);
            d.setOccurrenceDate(day);
            done.save(d);
        }
        if (r.getSnoozedUntil() != null) {
            LocalDate of = snoozeDay(userId, r);
            if (of == null || of.equals(day)) {
                r.setSnoozedUntil(null);
                repo.save(r);
            }
        }
    }

    /**
     * The occurrence a pending snooze is ringing again: the latest day whose ring
     * (its time less the lead, so a lead can make it the evening before) came at or
     * before the snooze. Null when there is no snooze or no such day nearby.
     * ponytail: inferred, not stored; a snooze_day column would make it exact.
     */
    LocalDate snoozeDay(UUID userId, CalendarReminder r) {
        java.time.Instant at = r.getSnoozedUntil();
        if (at == null || r.getTime() == null) {
            return null;
        }
        com.growthbuddy.user.User u = users == null || userId == null ? null : users.findById(userId).orElse(null);
        java.time.ZoneId zone = u == null ? com.growthbuddy.common.UserZone.FALLBACK
                : com.growthbuddy.common.UserZone.of(u.getTimezone());
        java.time.Duration lead = java.time.Duration.ofMinutes(ReminderPrefs.leadFor(r, u == null ? null : u.getUiPrefs()));
        WorkWeek week = u == null ? WorkWeek.DEFAULT : WorkWeek.fromPrefs(u.getUiPrefs());
        // A lead is at most a day and a snooze at most a few hours, so three days back covers it.
        LocalDate d = LocalDate.ofInstant(at, zone).plusDays(1);
        for (int i = 0; i < 4; i++, d = d.minusDays(1)) {
            if (!ReminderDeliveryScheduler.ringAt(d, r.getTime(), zone, lead).isAfter(at) && occursOn(r, d, week)) {
                return d;
            }
        }
        return null;
    }

    @Transactional
    public ReminderResponse create(UUID userId, CreateReminderRequest req) {
        if (req.date() == null) {
            throw ApiException.badRequest("date is required");
        }
        // A past day takes no reminders: a one-off there can never fire, and a
        // recurrence anchored there is a series whose start the user never picked.
        // The calendar hides the form on past days; this is the same rule for the API.
        // ponytail: one day of slack, deliberately. "Today" here is the user's stored
        // timezone, which falls back to UTC when they never set one — and a UTC server
        // is already on tomorrow while a user in the Americas is still on today. Drop
        // the minusDays(1) once the timezone is reliably captured at signup.
        if (req.date().isBefore(clock.today(userId).minusDays(1))) {
            throw ApiException.badRequest("That day has already passed — pick today or later.");
        }
        CalendarReminder r = new CalendarReminder();
        r.setUserId(userId);
        r.setText(req.text().trim());
        r.setAnchorDate(req.date());
        r.setTime(req.time());
        r.setEndTime(endAfter(req.time(), req.endTime()));
        r.setTag(req.tag() != null ? req.tag() : ReminderTag.personal);
        r.setRepeat(req.repeat() != null ? req.repeat() : RepeatFreq.none);
        // Blank and absent both mean "use my default tone"; storing "" instead of
        // null would make every read have to know that too.
        r.setSound(req.sound() != null && !req.sound().isBlank() ? req.sound().trim() : null);
        r.setNotifyBefore(req.notifyBefore());
        r.setNotifyBefore2(req.notifyBefore2());
        r.setNotes(blankToNull(req.notes()));
        r.setRepeatInterval(req.repeatInterval() != null ? req.repeatInterval() : 1);
        r.setRepeatDays(req.repeatDays());
        r.setRepeatNth(req.repeatNth());
        r.setRepeatCount(req.repeatCount());
        normalizeRule(r);
        // "until" only applies to recurring reminders.
        if (r.getRepeat() != RepeatFreq.none) {
            // An end date before the start makes a reminder that can never fire —
            // occursOn() rejects every day, so it sits in the list forever showing
            // "until 19 Jun 2007". The form guards this too, but the form is not
            // the authority: this is an API anyone can POST to.
            if (req.until() != null && req.until().isBefore(req.date())) {
                throw ApiException.badRequest(
                        "\"Repeat until\" can't be before the reminder's first date.");
            }
            r.setUntilDate(req.until());
        }
        return ReminderResponse.from(repo.save(r));
    }

    /** Expand all of a user's reminders into concrete occurrences within [from, to]. */
    @Transactional(readOnly = true)
    public List<OccurrenceResponse> occurrences(UUID userId, LocalDate from, LocalDate to) {
        if (from == null || to == null || to.isBefore(from)) {
            throw ApiException.badRequest("valid 'from' and 'to' dates are required");
        }
        List<CalendarReminder> reminders = repo.findByUserId(userId);
        // Resolved once for the whole expansion: it is the same answer for every
        // reminder and every day, and a lookup per cell would be thousands.
        WorkWeek workWeek = workWeekOf(userId);
        List<OccurrenceResponse> out = new ArrayList<>();
        for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
            for (CalendarReminder r : reminders) {
                if (occursOn(r, day, workWeek)) {
                    out.add(OccurrenceResponse.of(r, day));
                }
            }
        }
        out.sort(Comparator
                .comparing(OccurrenceResponse::date)
                .thenComparing(o -> o.time() == null ? java.time.LocalTime.MAX : o.time()));
        return out;
    }

    /** Every reminder as an iCalendar file, local times in the user's zone (see {@link ReminderIcs}). */
    @Transactional(readOnly = true)
    public String exportIcs(UUID userId) {
        com.growthbuddy.user.User u = users.findById(userId)
                .orElseThrow(() -> ApiException.notFound("User"));
        return ReminderIcs.build(repo.findByUserId(userId),
                com.growthbuddy.common.UserZone.of(u.getTimezone()),
                WorkWeek.fromPrefs(u.getUiPrefs()),
                ReminderPrefs.leadOf(u.getUiPrefs()),
                java.time.Instant.now());
    }

    /** Occurrences for a single day, sorted by time. */
    @Transactional(readOnly = true)
    public List<OccurrenceResponse> occurrencesOn(UUID userId, LocalDate day) {
        return occurrences(userId, day, day);
    }

    /**
     * Delete with a scope.
     * <ul>
     *   <li>{@code all} — remove the whole series.</li>
     *   <li>{@code this} — skip just the given occurrence.</li>
     *   <li>{@code future} — end the series the day before the occurrence.</li>
     *   <li>{@code before} — keep the occurrence and everything after it.</li>
     * </ul>
     */
    @Transactional
    public void delete(UUID userId, UUID id, String scope, LocalDate occ) {
        CalendarReminder r = repo.findByIdAndUserId(id, userId)
                .orElseThrow(() -> ApiException.notFound("Reminder"));

        String s = scope == null ? "all" : scope.toLowerCase();
        if (s.equals("all") || r.getRepeat() == RepeatFreq.none) {
            deleteRow(r);
            return;
        }
        if (occ == null) {
            throw ApiException.badRequest("'date' is required for scoped delete of a recurring reminder");
        }
        switch (s) {
            case "this" -> {
                r.getSkipDays().add(occ);
                repo.save(r);
            }
            case "future" -> {
                LocalDate cut = occ.minusDays(1);
                // From the very first occurrence (its anchor, or the first day a
                // "before" delete kept) there is nothing left ahead of the cut:
                // ending the series there left a row that could never fire.
                if (nothingBefore(r, cut)) {
                    deleteRow(r);
                } else {
                    r.setUntilDate(cut);
                    repo.save(r);
                }
            }
            case "before" -> {
                r.setFromDate(occ);
                repo.save(r);
            }
            default -> throw ApiException.badRequest("Unknown scope: " + scope);
        }
    }

    /**
     * Edit with a scope, the mirror of {@link #delete}.
     * <ul>
     *   <li>{@code all} — change the series itself.</li>
     *   <li>{@code this} — skip that day on the series and put a one-off in its
     *       place, which is the only way to vary a single occurrence when the
     *       model has no per-occurrence overrides.</li>
     *   <li>{@code future} — end the series the day before and start a new one
     *       from that day with the new values.</li>
     * </ul>
     * A non-recurring reminder is always edited whole; there is nothing to split.
     */
    @Transactional
    public ReminderResponse update(UUID userId, UUID id, String scope, LocalDate occ,
                                   UpdateReminderRequest req) {
        CalendarReminder r = repo.findByIdAndUserId(id, userId)
                .orElseThrow(() -> ApiException.notFound("Reminder"));
        String s = scope == null ? "all" : scope.toLowerCase();

        if (s.equals("all") || r.getRepeat() == RepeatFreq.none) {
            // A date moves a one-off. A series is not moved by its edit: the
            // anchor is what every occurrence, skip and bound is measured from.
            if (r.getRepeat() == RepeatFreq.none) {
                moveTo(userId, r, req);
            }
            applyEdit(r, req, true);
            return ReminderResponse.from(repo.save(r));
        }
        if (occ == null) {
            throw ApiException.badRequest("'date' is required for a scoped edit of a recurring reminder");
        }
        switch (s) {
            case "this" -> {
                // A snooze of that day goes with it, so it rings with the edited text;
                // the edit below drops it if the time or day moved.
                boolean snoozeMoves = occ.equals(snoozeDay(userId, r));
                CalendarReminder one = splitFrom(userId, r, occ);
                if (snoozeMoves) {
                    one.setSnoozedUntil(r.getSnoozedUntil());
                    r.setSnoozedUntil(null);
                }
                r.getSkipDays().add(occ);
                repo.save(r);
                one.setRepeat(RepeatFreq.none);
                one.setUntilDate(null);
                // The one-off stands alone, so it may move to another day.
                moveTo(userId, one, req);
                applyEdit(one, req, false);
                CalendarReminder saved = repo.save(one);
                // A tick on that day belongs to the one-off now, unless it moved away.
                if (done != null && saved.getId() != null && occ.equals(saved.getAnchorDate())) {
                    done.moveDay(r.getId(), saved.getId(), occ);
                }
                return ReminderResponse.from(saved);
            }
            case "future" -> {
                WorkWeek week = workWeekOf(userId);
                LocalDate snoozed = snoozeDay(userId, r);
                CalendarReminder rest = splitFrom(userId, r, occ);
                if (snoozed != null && !snoozed.isBefore(occ)) {
                    rest.setSnoozedUntil(r.getSnoozedUntil());
                    r.setSnoozedUntil(null);
                }
                applyEdit(rest, req, true);
                // "End after 10 times" means ten in all, not ten more from the cut,
                // and the dialog sends the series' total back with every edit, so the
                // count asked for (or kept) is a total too, less what was already used.
                Integer total = req != null && req.repeatCount() != null ? req.repeatCount() : r.getRepeatCount();
                if (rest.getRepeatCount() != null && total != null && total > 0) {
                    rest.setRepeatCount(Math.max(1, total - countBefore(r, occ, week)));
                }
                keepDayOfMonth(r, rest, occ, week);
                CalendarReminder saved = repo.save(rest);
                // Ticks from the cut on describe days the new series now owns. Moved
                // before the old row can go, or deleting it would take them along.
                if (done != null && saved.getId() != null) {
                    done.moveFrom(r.getId(), saved.getId(), occ);
                }
                LocalDate cut = occ.minusDays(1);
                if (nothingBefore(r, cut)) {
                    // Nothing of the old series survives ahead of the cut.
                    deleteRow(r);
                } else {
                    r.setUntilDate(cut);
                    repo.save(r);
                }
                return ReminderResponse.from(saved);
            }
            default -> throw ApiException.badRequest("Unknown scope: " + scope);
        }
    }

    /**
     * True when {@code r} has no occurrence on or before {@code cut}: its first
     * live day is the later of its anchor and its "from" bound. Comparing only
     * {@code fromDate} missed the commonest case — a "this and all future" from
     * the first occurrence, where fromDate is null.
     */
    static boolean nothingBefore(CalendarReminder r, LocalDate cut) {
        LocalDate start = r.getAnchorDate();
        if (r.getFromDate() != null && r.getFromDate().isAfter(start)) {
            start = r.getFromDate();
        }
        return start.isAfter(cut);
    }

    /** Re-anchor a one-off on {@code req.date()}, with the same past-day rule as create. */
    private void moveTo(UUID userId, CalendarReminder r, UpdateReminderRequest req) {
        if (req == null || req.date() == null || req.date().equals(r.getAnchorDate())) {
            return;
        }
        if (req.date().isBefore(clock.today(userId).minusDays(1))) {
            throw ApiException.badRequest("That day has already passed — pick today or later.");
        }
        r.setAnchorDate(req.date());
        // A new day is a new moment to ring at, like a new time.
        r.setSnoozedUntil(null);
    }

    /**
     * A monthly-by-date (or yearly) series on the 29th-31st lands on the month's
     * last day when the month is short, and a split anchored on that clamped day
     * would carry on from the 28th. Instead the new series keeps an anchor on the
     * original day (the latest one before {@code occ} the rule puts there) and
     * starts at {@code occ} through its "from" bound. Its count is measured from
     * that earlier anchor, so the occurrences before {@code occ} are added in.
     */
    private static void keepDayOfMonth(CalendarReminder r, CalendarReminder rest, LocalDate occ, WorkWeek week) {
        int dom = r.getAnchorDate().getDayOfMonth();
        boolean byDate = (rest.getRepeat() == RepeatFreq.monthly && rest.getRepeatNth() == null)
                || rest.getRepeat() == RepeatFreq.yearly;
        if (!byDate || rest.getRepeat() != r.getRepeat() || r.getRepeatNth() != null
                || dom <= occ.lengthOfMonth()) {
            return;
        }
        boolean yearly = rest.getRepeat() == RepeatFreq.yearly;
        int n = rest.getRepeatInterval();
        // Leap days come every 4 years (8 across 2100), so 9 periods back always finds one.
        for (int k = 1; k <= 9; k++) {
            LocalDate month = yearly ? occ.minusYears((long) k * n) : occ.minusMonths((long) k * n);
            if (month.lengthOfMonth() >= dom) {
                rest.setAnchorDate(month.withDayOfMonth(dom));
                rest.setFromDate(occ);
                if (rest.getRepeatCount() != null) {
                    rest.setRepeatCount(Math.min(MAX_COUNT, rest.getRepeatCount() + countBefore(rest, occ, week)));
                }
                return;
            }
        }
    }

    /** A copy of {@code r} anchored at {@code occ}, carrying none of its skips. */
    private CalendarReminder splitFrom(UUID userId, CalendarReminder r, LocalDate occ) {
        CalendarReminder c = new CalendarReminder();
        c.setUserId(userId);
        c.setText(r.getText());
        c.setAnchorDate(occ);
        c.setTime(r.getTime());
        c.setEndTime(r.getEndTime());
        c.setTag(r.getTag());
        c.setRepeat(r.getRepeat());
        c.setUntilDate(r.getUntilDate());
        c.setSound(r.getSound());
        c.setNotifyBefore(r.getNotifyBefore());
        c.setNotifyBefore2(r.getNotifyBefore2());
        c.setNotes(r.getNotes());
        c.setRepeatInterval(r.getRepeatInterval());
        c.setRepeatDays(r.getRepeatDays());
        c.setRepeatNth(r.getRepeatNth());
        c.setRepeatCount(r.getRepeatCount());
        return c;
    }

    private void deleteRow(CalendarReminder r) {
        if (done != null) {
            done.deleteByReminder(r.getId());
        }
        repo.delete(r);
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }

    /**
     * Check the rule's details and clear the ones its repeat can't use, so a
     * weekly reminder made monthly doesn't keep a stale "MO,WE" that would come
     * back if it were ever made weekly again — the same reason "until" is
     * cleared on a one-off.
     */
    static void normalizeRule(CalendarReminder r) {
        RepeatFreq rep = r.getRepeat();
        int n = r.getRepeatInterval();
        if (n < 1 || n > MAX_INTERVAL) {
            throw ApiException.badRequest("Repeat every 1 to " + MAX_INTERVAL + ".");
        }
        if (rep == RepeatFreq.none || rep == RepeatFreq.weekdays) {
            r.setRepeatInterval(1);
        }
        if (rep == RepeatFreq.weekly && r.getRepeatDays() != null) {
            String raw = r.getRepeatDays().trim().toUpperCase();
            EnumSet<DayOfWeek> set = EnumSet.noneOf(DayOfWeek.class);
            if (!raw.isEmpty()) {
                for (String code : raw.split("\\s*,\\s*")) {
                    int i = DAY_CODES.indexOf(code);
                    if (i < 0) {
                        throw ApiException.badRequest("Unknown day \"" + code + "\" — use MO,TU,WE,TH,FR,SA,SU.");
                    }
                    set.add(DayOfWeek.of(i + 1));
                }
            }
            r.setRepeatDays(set.isEmpty() ? null : toCodes(set));
        } else {
            r.setRepeatDays(null);
        }
        Integer nth = r.getRepeatNth();
        if (rep == RepeatFreq.monthly && nth != null && nth != 0) {
            if (nth < -1 || nth > 5) {
                throw ApiException.badRequest("The nth weekday is 1 to 5, or -1 for the last.");
            }
        } else {
            r.setRepeatNth(null);
        }
        Integer count = r.getRepeatCount();
        if (rep != RepeatFreq.none && count != null && count != 0) {
            if (count < 1 || count > MAX_COUNT) {
                throw ApiException.badRequest("End after 1 to " + MAX_COUNT + " times.");
            }
        } else {
            r.setRepeatCount(null);
        }
    }

    /** "MO,WE,FR", Monday first — the stored form and RRULE's BYDAY. */
    static String toCodes(Set<DayOfWeek> days) {
        StringBuilder sb = new StringBuilder();
        for (DayOfWeek d : DayOfWeek.values()) {
            if (days.contains(d)) {
                if (sb.length() > 0) {
                    sb.append(',');
                }
                sb.append(DAY_CODES.get(d.getValue() - 1));
            }
        }
        return sb.toString();
    }

    static String codeOf(DayOfWeek d) {
        return DAY_CODES.get(d.getValue() - 1);
    }

    /** A weekly reminder's days; empty = the anchor's weekday. Unknown codes are dropped. */
    static Set<DayOfWeek> daysOf(String codes) {
        EnumSet<DayOfWeek> set = EnumSet.noneOf(DayOfWeek.class);
        if (codes == null) {
            return set;
        }
        for (String c : codes.split(",")) {
            int i = DAY_CODES.indexOf(c.trim().toUpperCase());
            if (i >= 0) {
                set.add(DayOfWeek.of(i + 1));
            }
        }
        return set;
    }

    /** Only the fields actually sent. {@code allowRepeat} is false for a one-off. */
    private void applyEdit(CalendarReminder r, UpdateReminderRequest req, boolean allowRepeat) {
        if (req == null) {
            return;
        }
        boolean clearTime = Boolean.TRUE.equals(req.allDay());
        boolean moved = clearTime
                ? r.getTime() != null
                : req.time() != null && !req.time().equals(r.getTime());
        if (StringUtils.hasText(req.text())) {
            r.setText(req.text().trim());
        }
        // A null time in a PATCH means "unchanged", so taking the time off a
        // reminder needs a word of its own. The end goes with it: an end with
        // no start is a block with nothing to begin at.
        //
        // A start time and its end are one field pair: sending the start sends the
        // end too, so a null end there means "no end" and turns a block back into
        // a plain reminder. Treating it as "unchanged" left a cleared end in place.
        if (clearTime) {
            r.setTime(null);
            r.setEndTime(null);
        } else if (req.time() != null) {
            r.setTime(req.time());
            r.setEndTime(endAfter(req.time(), req.endTime()));
        } else if (req.endTime() != null) {
            r.setEndTime(endAfter(r.getTime(), req.endTime()));
        }
        if (req.tag() != null) {
            r.setTag(req.tag());
        }
        if (req.sound() != null) {
            r.setSound(req.sound().isBlank() ? null : req.sound().trim());
        }
        if (req.notifyBefore() != null) {
            r.setNotifyBefore(req.notifyBefore() < 0 ? null : req.notifyBefore());
        }
        // A new time is a new moment to ring at: a snooze of the old one would
        // ring for a time the reminder no longer has.
        if (moved) {
            r.setSnoozedUntil(null);
        }
        if (req.notes() != null) {
            r.setNotes(blankToNull(req.notes()));
        }
        if (req.notifyBefore2() != null) {
            r.setNotifyBefore2(req.notifyBefore2() < 0 ? null : req.notifyBefore2());
        }
        if (allowRepeat && req.repeat() != null) {
            r.setRepeat(req.repeat());
        }
        // Null = unchanged, as everywhere in a PATCH; each has its own "clear":
        // interval 1, days "", nth 0, count 0. normalizeRule turns those into null.
        if (allowRepeat) {
            if (req.repeatInterval() != null) {
                r.setRepeatInterval(req.repeatInterval());
            }
            if (req.repeatDays() != null) {
                r.setRepeatDays(req.repeatDays());
            }
            if (req.repeatNth() != null) {
                r.setRepeatNth(req.repeatNth());
            }
            if (req.repeatCount() != null) {
                r.setRepeatCount(req.repeatCount());
            }
        }
        normalizeRule(r);
        if (r.getRepeat() == RepeatFreq.none) {
            // "until" only means something on a series; a stale one would come
            // back to life if the reminder were ever made recurring again.
            r.setUntilDate(null);
        } else if (allowRepeat && Boolean.TRUE.equals(req.clearUntil())) {
            r.setUntilDate(null);
        } else if (allowRepeat && req.until() != null) {
            if (req.until().isBefore(r.getAnchorDate())) {
                throw ApiException.badRequest(
                        "\"Repeat until\" can't be before the reminder's first date.");
            }
            r.setUntilDate(req.until());
        }
    }

    /** A block's end, which needs a start and must come after it. ponytail: no blocks past midnight. */
    static LocalTime endAfter(LocalTime start, LocalTime end) {
        if (end == null) {
            return null;
        }
        if (start == null || !end.isAfter(start)) {
            throw ApiException.badRequest("The end time has to be after the start time.");
        }
        return end;
    }

    /** The acting user's working week, or the default when they never chose one. */
    public WorkWeek workWeekOf(UUID userId) {
        if (users == null) {
            return WorkWeek.DEFAULT;
        }
        return users.findById(userId).map(u -> WorkWeek.fromPrefs(u.getUiPrefs())).orElse(WorkWeek.DEFAULT);
    }

    /**
     * Does {@code r} occur on {@code day}? Honors recurrence (interval, chosen
     * weekdays, nth weekday, count), bounds, and skips. scripts/recurrence.js
     * must agree with this day for day; scripts/recurrence.cases.json is the
     * shared list of cases both sides are tested against.
     */
    public boolean occursOn(CalendarReminder r, LocalDate day, WorkWeek workWeek) {
        if (r.getFromDate() != null && day.isBefore(r.getFromDate())) {
            return false;
        }
        if (r.getUntilDate() != null && day.isAfter(r.getUntilDate())) {
            return false;
        }
        if (r.getSkipDays().contains(day)) {
            return false;
        }
        if (!matchesRule(r, day, workWeek)) {
            return false;
        }
        Integer count = r.getRepeatCount();
        if (r.getRepeat() != RepeatFreq.none && count != null && count >= 1) {
            // ponytail: rescanned per call, from the anchor up to the Nth match —
            // cheap for the counts people set (a few dozen); cache per reminder if a
            // month view of many counted series ever shows up in a profile.
            LocalDate last = lastByCount(r, count, workWeek);
            return last == null || !day.isAfter(last);
        }
        return true;
    }

    /** The rule alone: no bounds, skips or count. */
    static boolean matchesRule(CalendarReminder r, LocalDate day, WorkWeek workWeek) {
        LocalDate anchor = r.getAnchorDate();
        if (day.isBefore(anchor)) {
            return false;
        }
        int n = r.getRepeatInterval() >= 2 && r.getRepeatInterval() <= MAX_INTERVAL ? r.getRepeatInterval() : 1;
        // An anchor on the 29th-31st clamps to the last day of a shorter month, so a
        // monthly reminder set for the 31st still fires in February, April, and friends.
        int lastOfMonth = day.lengthOfMonth();
        boolean dayMatches = day.getDayOfMonth() == anchor.getDayOfMonth()
                || (anchor.getDayOfMonth() > lastOfMonth && day.getDayOfMonth() == lastOfMonth);
        return switch (r.getRepeat()) {
            case daily -> ChronoUnit.DAYS.between(anchor, day) % n == 0;
            // The user's working week, not a hardcoded Mon-Fri. No interval: it is a
            // fixed set of days, not a period.
            case weekdays -> workWeek.includes(day.getDayOfWeek());
            case weekly -> {
                Set<DayOfWeek> days = daysOf(r.getRepeatDays());
                boolean onDay = days.isEmpty()
                        ? day.getDayOfWeek() == anchor.getDayOfWeek()
                        : days.contains(day.getDayOfWeek());
                // Weeks start on Monday (RRULE's WKST=MO).
                long weeks = ChronoUnit.DAYS.between(mondayOf(anchor), mondayOf(day)) / 7;
                yield onDay && weeks % n == 0;
            }
            case monthly -> {
                long months = (day.getYear() - anchor.getYear()) * 12L
                        + (day.getMonthValue() - anchor.getMonthValue());
                if (months % n != 0) {
                    yield false;
                }
                Integer nth = r.getRepeatNth();
                if (nth == null || nth == 0) {
                    yield dayMatches;
                }
                if (day.getDayOfWeek() != anchor.getDayOfWeek()) {
                    yield false;
                }
                yield nth == -1
                        ? day.getDayOfMonth() + 7 > lastOfMonth
                        : (day.getDayOfMonth() + 6) / 7 == nth;
            }
            case yearly -> (day.getYear() - anchor.getYear()) % n == 0
                    && day.getMonth() == anchor.getMonth() && dayMatches;
            case none -> day.isEqual(anchor);
        };
    }

    private static LocalDate mondayOf(LocalDate d) {
        return d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    }

    /**
     * The day of the {@code count}th occurrence of the rule, counted from the
     * anchor — skips and the "from" bound use one up, as RRULE COUNT treats an
     * EXDATE. Null when it isn't reached within a century (no practical end).
     */
    static LocalDate lastByCount(CalendarReminder r, int count, WorkWeek workWeek) {
        int seen = 0;
        LocalDate d = r.getAnchorDate();
        for (int i = 0; i < MAX_SCAN_DAYS; i++, d = d.plusDays(1)) {
            if (matchesRule(r, d, workWeek) && ++seen >= count) {
                return d;
            }
        }
        return null;
    }

    /** How many occurrences of the rule fall before {@code day} (from the anchor). */
    static int countBefore(CalendarReminder r, LocalDate day, WorkWeek workWeek) {
        int seen = 0;
        for (LocalDate d = r.getAnchorDate(); d.isBefore(day); d = d.plusDays(1)) {
            if (matchesRule(r, d, workWeek)) {
                seen++;
            }
        }
        return seen;
    }
}
