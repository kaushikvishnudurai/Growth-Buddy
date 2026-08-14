package com.growthbuddy.reminder;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/**
 * Recurrence semantics for {@link ReminderService#occursOn}. The frontend mirrors this
 * logic in {@code scripts/calendar.js} (occursOn) for display — keep both in step; this
 * side is what actually drives WhatsApp/push delivery.
 */
class ReminderRecurrenceTest {

    private final ReminderService service = new ReminderService(null);

    private static CalendarReminder reminder(String anchor, RepeatFreq repeat) {
        CalendarReminder r = new CalendarReminder();
        r.setAnchorDate(LocalDate.parse(anchor));
        r.setRepeat(repeat);
        return r;
    }

    private boolean occurs(CalendarReminder r, String day) {
        return service.occursOn(r, LocalDate.parse(day));
    }

    @Test
    void monthlyAnchorOnThe31stClampsToShorterMonths() {
        CalendarReminder rent = reminder("2026-01-31", RepeatFreq.monthly);

        assertTrue(occurs(rent, "2026-01-31"), "fires on its own anchor");
        assertTrue(occurs(rent, "2026-03-31"), "fires on the 31st of a 31-day month");
        // The regression: February has no 31st, so a naive day-of-month match never fired.
        assertTrue(occurs(rent, "2026-02-28"), "clamps to the last day of February");
        assertTrue(occurs(rent, "2026-04-30"), "clamps to the last day of a 30-day month");

        assertFalse(occurs(rent, "2026-02-27"), "does not fire twice in February");
        assertFalse(occurs(rent, "2026-03-30"), "no clamp when the 31st exists");
    }

    @Test
    void monthlyClampsOnlyOnceInALeapFebruary() {
        CalendarReminder r = reminder("2024-01-30", RepeatFreq.monthly);

        assertTrue(occurs(r, "2024-02-29"), "leap February clamps to the 29th");
        assertFalse(occurs(r, "2024-02-28"), "and not to the 28th as well");
    }

    @Test
    void yearlyLeapDayFallsBackToFeb28() {
        CalendarReminder anniversary = reminder("2024-02-29", RepeatFreq.yearly);

        assertTrue(occurs(anniversary, "2028-02-29"), "fires on the next leap day");
        assertTrue(occurs(anniversary, "2026-02-28"), "falls back in a non-leap year");
        assertFalse(occurs(anniversary, "2026-03-01"), "does not spill into March");
    }

    @Test
    void ordinaryRecurrenceIsUnchanged() {
        assertTrue(occurs(reminder("2026-08-14", RepeatFreq.daily), "2026-09-02"));

        CalendarReminder weekly = reminder("2026-08-14", RepeatFreq.weekly); // a Friday
        assertTrue(occurs(weekly, "2026-08-21"), "same weekday");
        assertFalse(occurs(weekly, "2026-08-20"), "different weekday");

        CalendarReminder once = reminder("2026-08-14", RepeatFreq.none);
        assertTrue(occurs(once, "2026-08-14"));
        assertFalse(occurs(once, "2026-08-15"));

        assertFalse(occurs(reminder("2026-08-14", RepeatFreq.daily), "2026-08-13"),
                "never fires before its anchor");
    }

    @Test
    void boundsAndSkipsStillWin() {
        CalendarReminder r = reminder("2026-01-31", RepeatFreq.monthly);

        r.setUntilDate(LocalDate.parse("2026-02-01"));
        assertFalse(occurs(r, "2026-02-28"), "a clamped day past 'until' is excluded");

        r.setUntilDate(null);
        r.getSkipDays().add(LocalDate.parse("2026-02-28"));
        assertFalse(occurs(r, "2026-02-28"), "an explicitly skipped clamped day is excluded");

        r.getSkipDays().clear();
        r.setFromDate(LocalDate.parse("2026-03-01"));
        assertFalse(occurs(r, "2026-02-28"), "a clamped day before 'from' is excluded");
    }
}
