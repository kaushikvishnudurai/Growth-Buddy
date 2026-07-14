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
        LocalDate until) {
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
        Set<LocalDate> skip) {

    static ReminderResponse from(CalendarReminder r) {
        return new ReminderResponse(r.getId(), r.getText(), r.getAnchorDate(), r.getTime(),
                r.getTag(), r.getRepeat(), r.getFromDate(), r.getUntilDate(), r.getSkipDays());
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
