package com.growthbuddy.reminder;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

/** Request/response payloads for calendar reminders. Package-private records. */
final class ReminderDtos {
    private ReminderDtos() {
    }
}

/** Body for creating a reminder. Mirrors the frontend's add-reminder form. */
record CreateReminderRequest(
        @NotBlank @Size(max = 255) String text,
        LocalDate date,
        LocalTime time,
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
        @Size(max = 16) String sound) {
}

/**
 * Body for a scoped edit. Every field is optional — only what is sent is changed,
 * so a caller that just wants a new time doesn't have to echo the text back.
 */
record UpdateReminderRequest(
        @Size(max = 255) String text,
        LocalTime time,
        ReminderTag tag,
        RepeatFreq repeat,
        LocalDate until,
        @Size(max = 16) String sound) {
}

/** The stored reminder definition (raw, not expanded). */
record ReminderResponse(
        UUID id,
        String text,
        LocalDate date,
        LocalTime time,
        ReminderTag tag,
        RepeatFreq repeat,
        LocalDate from,
        LocalDate until,
        Set<LocalDate> skip,
        String sound) {

    static ReminderResponse from(CalendarReminder r) {
        return new ReminderResponse(r.getId(), r.getText(), r.getAnchorDate(), r.getTime(),
                r.getTag(), r.getRepeat(), r.getFromDate(), r.getUntilDate(), r.getSkipDays(),
                r.getSound());
    }
}

/** A single concrete occurrence of a (possibly recurring) reminder on a date. */
record OccurrenceResponse(
        UUID reminderId,
        LocalDate date,
        LocalTime time,
        String text,
        ReminderTag tag,
        RepeatFreq repeat,
        LocalDate until) {

    static OccurrenceResponse of(CalendarReminder r, LocalDate date) {
        return new OccurrenceResponse(r.getId(), date, r.getTime(), r.getText(),
                r.getTag(), r.getRepeat(), r.getUntilDate());
    }
}
