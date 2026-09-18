package com.growthbuddy.reminder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.WorkWeek;
import com.growthbuddy.user.UserClock;
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

    private final ReminderService service = new ReminderService(null, null, null);

    /* create() asks the clock what day it is for this user, so every create test
       pins "today" instead of hardcoding a date that quietly becomes the past. */
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 14); // a Monday

    private static ReminderService serviceWith(CalendarReminderRepository repo) {
        UserClock clock = mock(UserClock.class);
        when(clock.today(any())).thenReturn(TODAY);
        return new ReminderService(repo, clock, null);
    }

    private static CalendarReminderRepository savingRepo() {
        CalendarReminderRepository repo = mock(CalendarReminderRepository.class);
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        return repo;
    }

    /** Every case below is Mon-Fri unless it is about the work week itself. */
    private boolean occurs(CalendarReminder r, LocalDate day) {
        return service.occursOn(r, day, WorkWeek.DEFAULT);
    }

    private CalendarReminder reminder(LocalDate anchor, RepeatFreq repeat) {
        CalendarReminder r = new CalendarReminder();
        r.setAnchorDate(anchor);
        r.setRepeat(repeat);
        return r;
    }

    @Test
    void nonRepeatingOccursOnlyOnAnchor() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.none);
        assertThat(occurs(r, LocalDate.of(2026, 6, 15))).isTrue();
        assertThat(occurs(r, LocalDate.of(2026, 6, 16))).isFalse();
    }

    @Test
    void dailyOccursEveryDayFromAnchor() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.daily);
        assertThat(occurs(r, LocalDate.of(2026, 6, 15))).isTrue();
        assertThat(occurs(r, LocalDate.of(2026, 6, 20))).isTrue();
        assertThat(occurs(r, LocalDate.of(2026, 6, 14))).isFalse(); // before anchor
    }

    @Test
    void weeklyMatchesDayOfWeek() {
        // 2026-06-15 is a Monday.
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.weekly);
        assertThat(occurs(r, LocalDate.of(2026, 6, 22))).isTrue(); // next Monday
        assertThat(occurs(r, LocalDate.of(2026, 6, 23))).isFalse(); // Tuesday
    }

    @Test
    void monthlyMatchesDayOfMonth() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.monthly);
        assertThat(occurs(r, LocalDate.of(2026, 7, 15))).isTrue();
        assertThat(occurs(r, LocalDate.of(2026, 7, 16))).isFalse();
    }

    @Test
    void yearlyMatchesMonthAndDay() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.yearly);
        assertThat(occurs(r, LocalDate.of(2027, 6, 15))).isTrue();
        assertThat(occurs(r, LocalDate.of(2027, 7, 15))).isFalse();
    }

    @Test
    void untilDateEndsTheSeries() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.daily);
        r.setUntilDate(LocalDate.of(2026, 6, 17));
        assertThat(occurs(r, LocalDate.of(2026, 6, 17))).isTrue();
        assertThat(occurs(r, LocalDate.of(2026, 6, 18))).isFalse();
    }

    @Test
    void fromDateDelaysTheSeries() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.daily);
        r.setFromDate(LocalDate.of(2026, 6, 18));
        assertThat(occurs(r, LocalDate.of(2026, 6, 17))).isFalse();
        assertThat(occurs(r, LocalDate.of(2026, 6, 18))).isTrue();
    }

    @Test
    void skipDaysAreExcluded() {
        CalendarReminder r = reminder(LocalDate.of(2026, 6, 15), RepeatFreq.daily);
        r.setSkipDays(Set.of(LocalDate.of(2026, 6, 16)));
        assertThat(occurs(r, LocalDate.of(2026, 6, 16))).isFalse();
        assertThat(occurs(r, LocalDate.of(2026, 6, 17))).isTrue();
    }

    /* ---- Month-end anchors ----
       The cases the day-15 anchors above can't reach: a naive day-of-month match
       silently skipped every month too short to contain the anchor day. ---- */

    @Test
    void monthlyAnchorOnThe31stClampsToShorterMonths() {
        CalendarReminder rent = reminder(LocalDate.of(2026, 1, 31), RepeatFreq.monthly);
        assertThat(occurs(rent, LocalDate.of(2026, 1, 31))).isTrue();
        assertThat(occurs(rent, LocalDate.of(2026, 3, 31))).isTrue();
        // February has no 31st — clamp to its last day instead of never firing.
        assertThat(occurs(rent, LocalDate.of(2026, 2, 28))).isTrue();
        assertThat(occurs(rent, LocalDate.of(2026, 4, 30))).isTrue();
        // ...but only once, and only where the anchor day is genuinely missing.
        assertThat(occurs(rent, LocalDate.of(2026, 2, 27))).isFalse();
        assertThat(occurs(rent, LocalDate.of(2026, 3, 30))).isFalse();
    }

    @Test
    void monthlyClampsToTheLastDayOfALeapFebruary() {
        CalendarReminder r = reminder(LocalDate.of(2024, 1, 30), RepeatFreq.monthly);
        assertThat(occurs(r, LocalDate.of(2024, 2, 29))).isTrue();
        assertThat(occurs(r, LocalDate.of(2024, 2, 28))).isFalse();
    }

    @Test
    void yearlyLeapDayFallsBackToFeb28InCommonYears() {
        CalendarReminder anniversary = reminder(LocalDate.of(2024, 2, 29), RepeatFreq.yearly);
        assertThat(occurs(anniversary, LocalDate.of(2028, 2, 29))).isTrue();
        assertThat(occurs(anniversary, LocalDate.of(2026, 2, 28))).isTrue();
        assertThat(occurs(anniversary, LocalDate.of(2026, 3, 1))).isFalse();
    }

    @Test
    void boundsAndSkipsStillWinOverAClampedDay() {
        CalendarReminder r = reminder(LocalDate.of(2026, 1, 31), RepeatFreq.monthly);

        r.setUntilDate(LocalDate.of(2026, 2, 1));
        assertThat(occurs(r, LocalDate.of(2026, 2, 28))).isFalse();

        r.setUntilDate(null);
        r.setSkipDays(Set.of(LocalDate.of(2026, 2, 28)));
        assertThat(occurs(r, LocalDate.of(2026, 2, 28))).isFalse();

        r.setSkipDays(new java.util.HashSet<>());
        r.setFromDate(LocalDate.of(2026, 3, 1));
        assertThat(occurs(r, LocalDate.of(2026, 2, 28))).isFalse();
    }

    @Test
    void neverFiresBeforeItsAnchor() {
        CalendarReminder r = reminder(LocalDate.of(2026, 1, 31), RepeatFreq.monthly);
        assertThat(occurs(r, LocalDate.of(2025, 12, 31))).isFalse();
    }

    /* A "repeat until" before the first date makes a reminder that can never
       fire — occursOn() says false for every day — so it sits in the list
       forever advertising an end date in 2007. The form guards it, but the form
       isn't the authority. */
    @Test
    void rejectsAnUntilDateBeforeTheStart() {
        ReminderService svc = serviceWith(null); // never reaches the repo
        CreateReminderRequest req = new CreateReminderRequest("Test", TODAY,
                null, ReminderTag.personal, RepeatFreq.daily, LocalDate.of(2007, 6, 19), null);
        assertThatThrownBy(() -> svc.create(UUID.randomUUID(), req))
                .hasMessageContaining("can't be before");
    }

    @Test
    void acceptsAnUntilDateOnTheStartItself() {
        LocalDate start = TODAY;
        CreateReminderRequest req = new CreateReminderRequest("Test", start, null,
                ReminderTag.personal, RepeatFreq.daily, start, null);
        assertThat(serviceWith(savingRepo()).create(UUID.randomUUID(), req).until()).isEqualTo(start);
    }

    /* Non-repeating reminders drop `until` entirely, so a stale value in the
       payload must not be able to trip the new guard. */
    @Test
    void ignoresUntilWhenTheReminderDoesNotRepeat() {
        CreateReminderRequest req = new CreateReminderRequest("Test", TODAY,
                null, ReminderTag.personal, RepeatFreq.none, LocalDate.of(2007, 6, 19), null);
        assertThat(serviceWith(savingRepo()).create(UUID.randomUUID(), req).until()).isNull();
    }

    /* Mon-Fri. Mirrors scripts/recurrence.test.mjs — if you change one, change
       both, or Home's dots and WhatsApp delivery start disagreeing. */
    @Test
    void weekdaysFireMondayToFridayAndSkipTheWeekend() {
        CalendarReminder r = reminder(LocalDate.of(2026, 9, 14), RepeatFreq.weekdays); // a Monday
        for (int d = 14; d <= 18; d++) {
            assertThat(occurs(r, LocalDate.of(2026, 9, d)))
                    .as("2026-09-%02d should fire", d).isTrue();
        }
        assertThat(occurs(r, LocalDate.of(2026, 9, 19))).as("Saturday").isFalse();
        assertThat(occurs(r, LocalDate.of(2026, 9, 20))).as("Sunday").isFalse();
    }

    @Test
    void weekdaysAnchoredOnASaturdayFirstFireOnTheMonday() {
        CalendarReminder r = reminder(LocalDate.of(2026, 9, 12), RepeatFreq.weekdays); // a Saturday
        assertThat(occurs(r, LocalDate.of(2026, 9, 12))).isFalse();
        assertThat(occurs(r, LocalDate.of(2026, 9, 14))).isTrue();
    }

    /* The calendar hides the form on past days. This is the same rule for the
       API, which anyone can POST to — a one-off back there can never fire, and a
       recurrence anchored back there starts before the user chose to. */
    @Test
    void refusesADateInThePast() {
        CreateReminderRequest req = new CreateReminderRequest("Test", TODAY.minusDays(2),
                null, ReminderTag.personal, RepeatFreq.daily, null, null);
        assertThatThrownBy(() -> serviceWith(savingRepo()).create(UUID.randomUUID(), req))
                .hasMessageContaining("already passed");
    }

    /* A reminder can ring with its own tone. Blank and absent both have to store
       as null — "" would be a tone key nobody can play, and every read would then
       have to know that "" means "the user's default" as well as null does. */
    @Test
    void keepsItsOwnToneAndStoresNoChoiceAsNull() {
        assertThat(created(RepeatFreq.none, "droplet").sound()).isEqualTo("droplet");
        assertThat(created(RepeatFreq.none, "  droplet  ").sound()).isEqualTo("droplet");
        assertThat(created(RepeatFreq.none, "   ").sound()).isNull();
        assertThat(created(RepeatFreq.none, null).sound()).isNull();
    }

    private ReminderResponse created(RepeatFreq repeat, String sound) {
        return serviceWith(savingRepo()).create(UUID.randomUUID(),
                new CreateReminderRequest("Test", TODAY, null, ReminderTag.personal, repeat, null, sound));
    }

    /* One day of slack, on purpose: a user whose timezone was never captured is
       compared against UTC, which is already on tomorrow for half the planet. */
    @Test
    void acceptsTodayAndTheDayBeforeIt() {
        for (LocalDate d : new LocalDate[] { TODAY, TODAY.minusDays(1), TODAY.plusDays(30) }) {
            CreateReminderRequest req = new CreateReminderRequest("Test", d, null,
                    ReminderTag.personal, RepeatFreq.none, null, null);
            assertThat(serviceWith(savingRepo()).create(UUID.randomUUID(), req).date())
                    .as("create on %s", d).isEqualTo(d);
        }
    }
}
