package com.growthbuddy.reminder;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for reminder recurrence expansion ({@link ReminderService#occursOn}).
 * The method is pure (no DB access), so we construct the service with a null
 * repository and exercise the recurrence rules directly.
 */
class ReminderServiceOccursOnTest {

    private final ReminderService service = new ReminderService(null);

    private CalendarReminder reminder(LocalDate anchor, RepeatFreq repeat) {
        CalendarReminder r = new CalendarReminder();
        r.setAnchorDate(anchor);
        r.setRepeat(repeat);
        return r;
    }

    @Test
    void nonRepeatingOccursOnlyOnAnchor() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.none);
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 15))).isTrue();
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 16))).isFalse();
    }

    @Test
    void dailyOccursEveryDayFromAnchor() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.daily);
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 15))).isTrue();
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 20))).isTrue();
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 14))).isFalse(); // before anchor
    }

    @Test
    void weeklyMatchesDayOfWeek() {
        // 2026-06-15 is a Monday.
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.weekly);
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 22))).isTrue(); // next Monday
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 23))).isFalse(); // Tuesday
    }

    @Test
    void monthlyMatchesDayOfMonth() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.monthly);
        assertThat(service.occursOn(r, LocalDate.of(2026, 7, 15))).isTrue();
        assertThat(service.occursOn(r, LocalDate.of(2026, 7, 16))).isFalse();
    }

    @Test
    void yearlyMatchesMonthAndDay() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.yearly);
        assertThat(service.occursOn(r, LocalDate.of(2027, 6, 15))).isTrue();
        assertThat(service.occursOn(r, LocalDate.of(2027, 7, 15))).isFalse();
    }

    @Test
    void untilDateEndsTheSeries() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.daily);
        r.setUntilDate(LocalDate.of(2026, 6, 17));
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 17))).isTrue();
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 18))).isFalse();
    }

    @Test
    void fromDateDelaysTheSeries() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.daily);
        r.setFromDate(LocalDate.of(2026, 6, 18));
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 17))).isFalse();
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 18))).isTrue();
    }

    @Test
    void skipDaysAreExcluded() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.daily);
        r.setSkipDays(Set.of(LocalDate.of(2026, 6, 16)));
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 16))).isFalse();
        assertThat(service.occursOn(r, LocalDate.of(2026, 6, 17))).isTrue();
    }
}
