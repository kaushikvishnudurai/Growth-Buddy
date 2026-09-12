package com.growthbuddy.reminder;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.WorkWeek;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Calendar-reminder logic. Recurrence expansion and scoped deletes mirror the
 * frontend ({@code scripts/calendar.js} and {@code app.js}) so behavior is identical.
 */
@Service
public class ReminderService {

    private final CalendarReminderRepository repo;
    private final UserClock clock;
    private final UserRepository users;

    public ReminderService(CalendarReminderRepository repo, UserClock clock, UserRepository users) {
        this.repo = repo;
        this.clock = clock;
        this.users = users;
    }

    @Transactional(readOnly = true)
    public List<ReminderResponse> list(UUID userId) {
        return repo.findByUserId(userId).stream().map(ReminderResponse::from).toList();
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
        r.setTag(req.tag() != null ? req.tag() : ReminderTag.personal);
        r.setRepeat(req.repeat() != null ? req.repeat() : RepeatFreq.none);
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
            repo.delete(r);
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
                r.setUntilDate(occ.minusDays(1));
                if (r.getFromDate() != null && r.getFromDate().isAfter(r.getUntilDate())) {
                    repo.delete(r);
                } else {
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

    /** The acting user's working week, or the default when they never chose one. */
    public WorkWeek workWeekOf(UUID userId) {
        return users.findById(userId).map(u -> WorkWeek.fromPrefs(u.getUiPrefs())).orElse(WorkWeek.DEFAULT);
    }

    /** Does {@code r} occur on {@code day}? Honors recurrence, bounds, and skips. */
    public boolean occursOn(CalendarReminder r, LocalDate day, WorkWeek workWeek) {
        LocalDate anchor = r.getAnchorDate();
        if (day.isBefore(anchor)) {
            return false;
        }
        if (r.getFromDate() != null && day.isBefore(r.getFromDate())) {
            return false;
        }
        if (r.getUntilDate() != null && day.isAfter(r.getUntilDate())) {
            return false;
        }
        if (r.getSkipDays().contains(day)) {
            return false;
        }
        // An anchor on the 29th-31st clamps to the last day of a shorter month, so a
        // monthly reminder set for the 31st still fires in February, April, and friends.
        int lastOfMonth = day.lengthOfMonth();
        boolean dayMatches = day.getDayOfMonth() == anchor.getDayOfMonth()
                || (anchor.getDayOfMonth() > lastOfMonth && day.getDayOfMonth() == lastOfMonth);
        return switch (r.getRepeat()) {
            case daily -> true;
            // The user's working week, not a hardcoded Mon-Fri. scripts/recurrence.js
            // must agree with this switch day for day; scripts/recurrence.cases.json
            // is the shared list of cases both sides are tested against.
            case weekdays -> workWeek.includes(day.getDayOfWeek());
            case weekly -> day.getDayOfWeek() == anchor.getDayOfWeek();
            case monthly -> dayMatches;
            case yearly -> day.getMonth() == anchor.getMonth() && dayMatches;
            case none -> day.isEqual(anchor);
        };
    }
}
