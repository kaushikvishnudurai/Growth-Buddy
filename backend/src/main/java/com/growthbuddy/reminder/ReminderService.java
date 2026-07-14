package com.growthbuddy.reminder;

import com.growthbuddy.common.ApiException;
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

    public ReminderService(CalendarReminderRepository repo) {
        this.repo = repo;
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
        CalendarReminder r = new CalendarReminder();
        r.setUserId(userId);
        r.setText(req.text().trim());
        r.setAnchorDate(req.date());
        r.setTime(req.time());
        r.setTag(req.tag() != null ? req.tag() : ReminderTag.personal);
        r.setRepeat(req.repeat() != null ? req.repeat() : RepeatFreq.none);
        // "until" only applies to recurring reminders.
        if (r.getRepeat() != RepeatFreq.none) {
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
        List<OccurrenceResponse> out = new ArrayList<>();
        for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
            for (CalendarReminder r : reminders) {
                if (occursOn(r, day)) {
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

    /** Does {@code r} occur on {@code day}? Honors recurrence, bounds, and skips. */
    boolean occursOn(CalendarReminder r, LocalDate day) {
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
        return switch (r.getRepeat()) {
            case daily -> true;
            case weekly -> day.getDayOfWeek() == anchor.getDayOfWeek();
            case monthly -> day.getDayOfMonth() == anchor.getDayOfMonth();
            case yearly -> day.getMonth() == anchor.getMonth()
                    && day.getDayOfMonth() == anchor.getDayOfMonth();
            case none -> day.isEqual(anchor);
        };
    }
}
