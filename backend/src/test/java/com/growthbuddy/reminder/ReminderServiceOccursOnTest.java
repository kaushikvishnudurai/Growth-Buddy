package com.growthbuddy.reminder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.LocalDate;
import java.util.UUID;
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

    /* ---- Month-end anchors ----
       The cases the day-15 anchors above can't reach: a naive day-of-month match
       silently skipped every month too short to contain the anchor day. ---- */

    @Test
    void monthlyAnchorOnThe31stClampsToShorterMonths() {
        CalendarReminder rent = reminder(LocalDate.of(2026, 1, 31), RepeatFreq.monthly);
        assertThat(service.occursOn(rent, LocalDate.of(2026, 1, 31))).isTrue();
        assertThat(service.occursOn(rent, LocalDate.of(2026, 3, 31))).isTrue();
        // February has no 31st — clamp to its last day instead of never firing.
        assertThat(service.occursOn(rent, LocalDate.of(2026, 2, 28))).isTrue();
        assertThat(service.occursOn(rent, LocalDate.of(2026, 4, 30))).isTrue();
        // ...but only once, and only where the anchor day is genuinely missing.
        assertThat(service.occursOn(rent, LocalDate.of(2026, 2, 27))).isFalse();
        assertThat(service.occursOn(rent, LocalDate.of(2026, 3, 30))).isFalse();
    }

    @Test
    void monthlyClampsToTheLastDayOfALeapFebruary() {
        CalendarReminder r = reminder(LocalDate.of(2024, 1, 30), RepeatFreq.monthly);
        assertThat(service.occursOn(r, LocalDate.of(2024, 2, 29))).isTrue();
        assertThat(service.occursOn(r, LocalDate.of(2024, 2, 28))).isFalse();
    }

    @Test
    void yearlyLeapDayFallsBackToFeb28InCommonYears() {
        CalendarReminder anniversary = reminder(LocalDate.of(2024, 2, 29), RepeatFreq.yearly);
        assertThat(service.occursOn(anniversary, LocalDate.of(2028, 2, 29))).isTrue();
        assertThat(service.occursOn(anniversary, LocalDate.of(2026, 2, 28))).isTrue();
        assertThat(service.occursOn(anniversary, LocalDate.of(2026, 3, 1))).isFalse();
    }

    @Test
    void boundsAndSkipsStillWinOverAClampedDay() {
        CalendarReminder r = reminder(LocalDate.of(2026, 1, 31), RepeatFreq.monthly);

        r.setUntilDate(LocalDate.of(2026, 2, 1));
        assertThat(service.occursOn(r, LocalDate.of(2026, 2, 28))).isFalse();

        r.setUntilDate(null);
        r.setSkipDays(Set.of(LocalDate.of(2026, 2, 28)));
        assertThat(service.occursOn(r, LocalDate.of(2026, 2, 28))).isFalse();

        r.setSkipDays(new java.util.HashSet<>());
        r.setFromDate(LocalDate.of(2026, 3, 1));
        assertThat(service.occursOn(r, LocalDate.of(2026, 2, 28))).isFalse();
    }

    @Test
    void neverFiresBeforeItsAnchor() {
        CalendarReminder r = reminder(LocalDate.of(2026, 1, 31), RepeatFreq.monthly);
        assertThat(service.occursOn(r, LocalDate.of(2025, 12, 31))).isFalse();
    }

    /* A "repeat until" before the first date makes a reminder that can never
       fire — occursOn() says false for every day — so it sits in the list
       forever advertising an end date in 2007. The form guards it, but the form
       isn't the authority. */
    @Test
    void rejectsAnUntilDateBeforeTheStart() {
        ReminderService svc = new ReminderService(null); // never reaches the repo
        CreateReminderRequest req = new CreateReminderRequest("Test", LocalDate.of(2026, 9, 14),
                null, ReminderTag.personal, RepeatFreq.daily, LocalDate.of(2007, 6, 19));
        assertThatThrownBy(() -> svc.create(UUID.randomUUID(), req))
                .hasMessageContaining("can't be before");
    }

    @Test
    void acceptsAnUntilDateOnTheStartItself() {
        CalendarReminderRepository repo = mock(CalendarReminderRepository.class);
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        LocalDate start = LocalDate.of(2026, 9, 14);
        CreateReminderRequest req = new CreateReminderRequest("Test", start, null,
                ReminderTag.personal, RepeatFreq.daily, start);
        assertThat(new ReminderService(repo).create(UUID.randomUUID(), req).until()).isEqualTo(start);
    }

    /* Non-repeating reminders drop `until` entirely, so a stale value in the
       payload must not be able to trip the new guard. */
    @Test
    void ignoresUntilWhenTheReminderDoesNotRepeat() {
        CalendarReminderRepository repo = mock(CalendarReminderRepository.class);
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        CreateReminderRequest req = new CreateReminderRequest("Test", LocalDate.of(2026, 9, 14),
                null, ReminderTag.personal, RepeatFreq.none, LocalDate.of(2007, 6, 19));
        assertThat(new ReminderService(repo).create(UUID.randomUUID(), req).until()).isNull();
    }

    /* Mon-Fri. Mirrors scripts/recurrence.test.mjs — if you change one, change
       both, or Home's dots and WhatsApp delivery start disagreeing. */
    @Test
    void weekdaysFireMondayToFridayAndSkipTheWeekend() {
        CalendarReminder r = reminder(LocalDate.of(2026, 9, 14), RepeatFreq.weekdays); // a Monday
        for (int d = 14; d <= 18; d++) {
            assertThat(service.occursOn(r, LocalDate.of(2026, 9, d)))
                    .as("2026-09-%02d should fire", d).isTrue();
        }
        assertThat(service.occursOn(r, LocalDate.of(2026, 9, 19))).as("Saturday").isFalse();
        assertThat(service.occursOn(r, LocalDate.of(2026, 9, 20))).as("Sunday").isFalse();
    }

    @Test
    void weekdaysAnchoredOnASaturdayFirstFireOnTheMonday() {
        CalendarReminder r = reminder(LocalDate.of(2026, 9, 12), RepeatFreq.weekdays); // a Saturday
        assertThat(service.occursOn(r, LocalDate.of(2026, 9, 12))).isFalse();
        assertThat(service.occursOn(r, LocalDate.of(2026, 9, 14))).isTrue();
    }
}
