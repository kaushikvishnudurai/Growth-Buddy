package com.growthbuddy.reminder;

import com.fasterxml.jackson.annotation.JsonCreator;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

/** Request/response payloads for calendar reminders. Package-private records. */
final class ReminderDtos {
    private ReminderDtos() {
    }
}

/**
 * Body for creating a reminder. Mirrors the frontend's add-reminder form.
 *
 * <p>The recurrence details ({@code repeatInterval}, {@code repeatDays},
 * {@code repeatNth}, {@code repeatCount}) are all optional; see
 * {@link CalendarReminder} and {@code scripts/recurrence.js}. Any a repeat can't
 * use is dropped ({@code ReminderService.normalizeRule}).
 */
record CreateReminderRequest(
        @NotBlank @Size(max = 255) String text,
        LocalDate date,
        LocalTime time,
        LocalTime endTime,
        ReminderTag tag,
        RepeatFreq repeat,
        LocalDate until,
        /**
         * Chime key for this reminder alone; null or blank means the user's
         * default. Only length is checked here — the tone table lives in
         * {@code scripts/chime.js}, and duplicating it server-side would leave two
         * lists to keep in step. An unknown key resolves to the default on the
         * client, so the worst a bad one does is ring the usual tone.
         */
        @Size(max = 16) String sound,
        /** Minutes ahead of the time to notify; null = the user's default. */
        @Min(0) @Max(ReminderPrefs.MAX_LEAD) Integer notifyBefore,
        /** A second alert, minutes ahead; null = none. */
        @Min(0) @Max(ReminderPrefs.MAX_LEAD) Integer notifyBefore2,
        @Size(max = 1000) String notes,
        @Min(1) @Max(ReminderService.MAX_INTERVAL) Integer repeatInterval,
        @Size(max = 32) String repeatDays,
        @Min(-1) @Max(5) Integer repeatNth,
        @Min(0) @Max(ReminderService.MAX_COUNT) Integer repeatCount) {

    @JsonCreator
    CreateReminderRequest {
    }

    /** The shape before notes, a second alert and the richer rule. */
    CreateReminderRequest(String text, LocalDate date, LocalTime time, LocalTime endTime, ReminderTag tag,
                          RepeatFreq repeat, LocalDate until, String sound, Integer notifyBefore) {
        this(text, date, time, endTime, tag, repeat, until, sound, notifyBefore,
                null, null, null, null, null, null);
    }
}

/**
 * Body for a scoped edit. Every field is optional — only what is sent is changed,
 * so a caller that just wants a new time doesn't have to echo the text back.
 */
record UpdateReminderRequest(
        @Size(max = 255) String text,
        LocalTime time,
        LocalTime endTime,
        ReminderTag tag,
        RepeatFreq repeat,
        LocalDate until,
        @Size(max = 16) String sound,
        /** Null leaves it alone; -1 goes back to the user's default (an Integer has no blank). */
        @Min(-1) @Max(ReminderPrefs.MAX_LEAD) Integer notifyBefore,
        /**
         * True takes the time (and end) off: a null {@code time} means "unchanged",
         * so it can't also mean "no time".
         */
        Boolean allDay,
        /** A new day for a one-off, or for the one-off a scope=this edit leaves; ignored on a series. */
        LocalDate date,
        /** True removes "repeat until", which a null {@code until} can't say for the same reason. */
        Boolean clearUntil,
        /** Null leaves it alone; -1 removes the second alert. */
        @Min(-1) @Max(ReminderPrefs.MAX_LEAD) Integer notifyBefore2,
        /** Null leaves it alone; blank clears it. */
        @Size(max = 1000) String notes,
        /** Null leaves it; 1 = every. */
        @Min(1) @Max(ReminderService.MAX_INTERVAL) Integer repeatInterval,
        /** Null leaves it; "" = back to the anchor's weekday. */
        @Size(max = 32) String repeatDays,
        /** Null leaves it; 0 = by date again. */
        @Min(-1) @Max(5) Integer repeatNth,
        /** Null leaves it; 0 = no count. */
        @Min(0) @Max(ReminderService.MAX_COUNT) Integer repeatCount) {

    @JsonCreator
    UpdateReminderRequest {
    }

    /** The shape before notes, a second alert and the richer rule. */
    UpdateReminderRequest(String text, LocalTime time, LocalTime endTime, ReminderTag tag, RepeatFreq repeat,
                          LocalDate until, String sound, Integer notifyBefore, Boolean allDay, LocalDate date,
                          Boolean clearUntil) {
        this(text, time, endTime, tag, repeat, until, sound, notifyBefore, allDay, date, clearUntil,
                null, null, null, null, null, null);
    }
}

/** Body for a snooze; no minutes means the user's default length. */
record SnoozeRequest(@Min(1) @Max(ReminderPrefs.MAX_SNOOZE) Integer minutes) {
}

/** A snooze from a push notification's button: the signed token stands in for the session. */
record SnoozeLinkRequest(@NotBlank @Size(max = 300) String token) {
}

/**
 * The stored reminder definition (raw, not expanded). {@code doneDates} is the
 * occurrences checked off since {@link ReminderService#DONE_LOOKBACK_DAYS} ago —
 * only on the list; a single-reminder answer (create, edit, snooze) carries null,
 * and the client keeps the dates it already had.
 */
record ReminderResponse(
        UUID id,
        String text,
        LocalDate date,
        LocalTime time,
        LocalTime endTime,
        ReminderTag tag,
        RepeatFreq repeat,
        LocalDate from,
        LocalDate until,
        Set<LocalDate> skip,
        String sound,
        Integer notifyBefore,
        Instant snoozedUntil,
        Integer notifyBefore2,
        String notes,
        int repeatInterval,
        String repeatDays,
        Integer repeatNth,
        Integer repeatCount,
        Set<LocalDate> doneDates) {

    static ReminderResponse from(CalendarReminder r) {
        return from(r, null);
    }

    static ReminderResponse from(CalendarReminder r, Set<LocalDate> doneDates) {
        return new ReminderResponse(r.getId(), r.getText(), r.getAnchorDate(), r.getTime(),
                r.getEndTime(), r.getTag(), r.getRepeat(), r.getFromDate(), r.getUntilDate(), r.getSkipDays(),
                r.getSound(), r.getNotifyBefore(), r.getSnoozedUntil(), r.getNotifyBefore2(), r.getNotes(),
                r.getRepeatInterval(), r.getRepeatDays(), r.getRepeatNth(), r.getRepeatCount(), doneDates);
    }
}

/** A single concrete occurrence of a (possibly recurring) reminder on a date. */
record OccurrenceResponse(
        UUID reminderId,
        LocalDate date,
        LocalTime time,
        LocalTime endTime,
        String text,
        ReminderTag tag,
        RepeatFreq repeat,
        LocalDate until) {

    static OccurrenceResponse of(CalendarReminder r, LocalDate date) {
        return new OccurrenceResponse(r.getId(), date, r.getTime(), r.getEndTime(), r.getText(),
                r.getTag(), r.getRepeat(), r.getUntilDate());
    }
}
