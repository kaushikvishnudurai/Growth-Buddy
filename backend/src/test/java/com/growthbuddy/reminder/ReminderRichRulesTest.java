package com.growthbuddy.reminder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.WorkWeek;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.push.PushService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The richer recurrence (interval, chosen weekdays, nth weekday, count), the
 * per-occurrence "done" tick and what it suppresses, the second alert, quiet
 * hours, and the .ics export. The day-by-day agreement with recurrence.js is
 * SharedRecurrenceCasesTest's job; this covers the Java-only parts around it.
 */
class ReminderRichRulesTest {

    private static final ZoneId UTC = ZoneId.of("UTC");
    private static final UUID USER = UUID.randomUUID();
    private static final LocalDate MON = LocalDate.of(2026, 9, 14);

    private final ReminderService pure = new ReminderService(null, null, null);

    private static CalendarReminder rule(LocalDate anchor, RepeatFreq repeat) {
        CalendarReminder r = new CalendarReminder();
        r.setId(UUID.randomUUID());
        r.setUserId(USER);
        r.setText("Standup");
        r.setAnchorDate(anchor);
        r.setRepeat(repeat);
        return r;
    }

    private boolean on(CalendarReminder r, LocalDate d) {
        return pure.occursOn(r, d, WorkWeek.DEFAULT);
    }

    /* ---- occursOn, new modes ---- */

    @Test
    void everyTwoWeeksOnChosenDays() {
        CalendarReminder r = rule(MON, RepeatFreq.weekly);
        r.setRepeatDays("MO,TH");
        r.setRepeatInterval(2);
        assertThat(on(r, MON.plusDays(3))).isTrue();   // Thu, week 0
        assertThat(on(r, MON.plusDays(7))).isFalse();  // Mon, week 1
        assertThat(on(r, MON.plusDays(14))).isTrue();  // Mon, week 2
        assertThat(on(r, MON.plusDays(15))).isFalse(); // Tue
    }

    @Test
    void lastWeekdayOfTheMonth() {
        CalendarReminder r = rule(LocalDate.of(2026, 9, 25), RepeatFreq.monthly); // last Fri
        r.setRepeatNth(-1);
        assertThat(on(r, LocalDate.of(2026, 10, 30))).isTrue();
        assertThat(on(r, LocalDate.of(2026, 10, 23))).isFalse();
        assertThat(on(r, LocalDate.of(2026, 10, 25))).as("not the anchor's date").isFalse();
    }

    @Test
    void countEndsTheSeriesAndSkipsUseOneUp() {
        CalendarReminder r = rule(MON, RepeatFreq.daily);
        r.setRepeatCount(3);
        r.setSkipDays(Set.of(MON.plusDays(1)));
        assertThat(on(r, MON.plusDays(2))).isTrue();
        assertThat(on(r, MON.plusDays(3))).isFalse();
        assertThat(ReminderService.lastByCount(r, 3, WorkWeek.DEFAULT)).isEqualTo(MON.plusDays(2));
        assertThat(ReminderService.countBefore(r, MON.plusDays(2), WorkWeek.DEFAULT)).isEqualTo(2);
    }

    @Test
    void normalizeRuleDropsWhatTheRepeatCannotUseAndRefusesNonsense() {
        CalendarReminder r = rule(MON, RepeatFreq.monthly);
        r.setRepeatDays("MO,WE");
        r.setRepeatNth(2);
        r.setRepeatCount(0);
        ReminderService.normalizeRule(r);
        assertThat(r.getRepeatDays()).as("days are weekly-only").isNull();
        assertThat(r.getRepeatNth()).isEqualTo(2);
        assertThat(r.getRepeatCount()).as("0 = no count").isNull();

        CalendarReminder w = rule(MON, RepeatFreq.weekly);
        w.setRepeatDays("fr, mo,MO");
        ReminderService.normalizeRule(w);
        assertThat(w.getRepeatDays()).as("deduped, Monday first").isEqualTo("MO,FR");

        CalendarReminder bad = rule(MON, RepeatFreq.weekly);
        bad.setRepeatDays("MO,XX");
        assertThatThrownBy(() -> ReminderService.normalizeRule(bad)).isInstanceOf(ApiException.class);

        CalendarReminder nth = rule(MON, RepeatFreq.monthly);
        nth.setRepeatNth(6);
        assertThatThrownBy(() -> ReminderService.normalizeRule(nth)).isInstanceOf(ApiException.class);
    }

    @Test
    void aFutureSplitCarriesTheCountThatIsLeft() {
        CalendarReminderRepository repo = mock(CalendarReminderRepository.class);
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        UserClock clock = mock(UserClock.class);
        when(clock.today(any())).thenReturn(MON);
        ReminderService service = new ReminderService(repo, clock, null);
        CalendarReminder r = rule(MON, RepeatFreq.daily);
        r.setRepeatCount(10);
        when(repo.findByIdAndUserId(r.getId(), USER)).thenReturn(Optional.of(r));

        // The edit dialog sends the series' total back with the rule, as RuleExtras.get() does.
        ReminderResponse rest = service.update(USER, r.getId(), "future", MON.plusDays(4), withCount(10));

        assertThat(rest.repeatCount()).as("ten in all, four already used").isEqualTo(6);
        assertThat(r.getUntilDate()).isEqualTo(MON.plusDays(3));
    }

    private static UpdateReminderRequest withCount(Integer count) {
        return new UpdateReminderRequest("Later", null, null, null, RepeatFreq.daily, null, null, null, null, null,
                null, null, null, 1, "", 0, count);
    }

    private ReminderService splitter(CalendarReminder r) {
        CalendarReminderRepository repo = mock(CalendarReminderRepository.class);
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        when(repo.findByIdAndUserId(r.getId(), USER)).thenReturn(Optional.of(r));
        UserClock clock = mock(UserClock.class);
        when(clock.today(any())).thenReturn(MON);
        return new ReminderService(repo, clock, null);
    }

    @Test
    void aFutureSplitReadsAChangedCountAsANewTotal() {
        CalendarReminder r = rule(MON, RepeatFreq.daily);
        r.setRepeatCount(10);
        ReminderService service = splitter(r);

        assertThat(service.update(USER, r.getId(), "future", MON.plusDays(4), withCount(12)).repeatCount())
                .as("twelve in all now, four used").isEqualTo(8);
        CalendarReminder again = rule(MON, RepeatFreq.daily);
        again.setRepeatCount(10);
        assertThat(splitter(again).update(USER, again.getId(), "future", MON.plusDays(4), withCount(0)).repeatCount())
                .as("0 clears the count").isNull();
    }

    @Test
    void aFutureSplitFromAClampedDayKeepsTheSeriesDay() {
        // Monthly on the 31st; February's occurrence is the 28th.
        CalendarReminder r = rule(LocalDate.of(2026, 1, 31), RepeatFreq.monthly);
        r.setRepeatCount(6);
        LocalDate feb = LocalDate.of(2026, 2, 28);
        ReminderResponse rest = splitter(r).update(USER, r.getId(), "future", feb,
                new UpdateReminderRequest("Rent", null, null, null, RepeatFreq.monthly, null, null, null, null, null,
                        null, null, null, 1, "", 0, 6));

        CalendarReminder c = new CalendarReminder();
        c.setAnchorDate(rest.date());
        c.setFromDate(rest.from());
        c.setRepeat(rest.repeat());
        c.setRepeatCount(rest.repeatCount());
        assertThat(rest.date()).isEqualTo(LocalDate.of(2026, 1, 31));
        assertThat(on(c, LocalDate.of(2026, 1, 31))).as("the old row owns January").isFalse();
        assertThat(on(c, feb)).isTrue();
        assertThat(on(c, LocalDate.of(2026, 3, 31))).as("back on the 31st, not the 28th").isTrue();
        assertThat(on(c, LocalDate.of(2026, 3, 28))).isFalse();
        assertThat(on(c, LocalDate.of(2026, 6, 30))).as("six in all: Jan..Jun").isTrue();
        assertThat(on(c, LocalDate.of(2026, 7, 31))).isFalse();

        // Yearly on Feb 29, split from 2027's Feb 28.
        CalendarReminder y = rule(LocalDate.of(2024, 2, 29), RepeatFreq.yearly);
        ReminderResponse ry = splitter(y).update(USER, y.getId(), "future", LocalDate.of(2027, 2, 28),
                new UpdateReminderRequest("Leap", null, null, null, null, null, null, null, null, null, null));
        assertThat(ry.date()).isEqualTo(LocalDate.of(2024, 2, 29));
        assertThat(ry.from()).isEqualTo(LocalDate.of(2027, 2, 28));
    }

    @Test
    void aThisDayEditTakesThatDaysSnoozeAlong() {
        CalendarReminder r = rule(MON, RepeatFreq.daily);
        r.setTime(LocalTime.of(9, 0));
        r.setSnoozedUntil(Instant.parse("2026-09-15T09:10:00Z"));
        ReminderResponse one = splitter(r).update(USER, r.getId(), "this", MON.plusDays(1),
                new UpdateReminderRequest("New text", null, null, null, null, null, null, null, null, null, null));
        assertThat(one.snoozedUntil()).as("rings again with the new text").isEqualTo(Instant.parse("2026-09-15T09:10:00Z"));
        assertThat(r.getSnoozedUntil()).isNull();

        CalendarReminder other = rule(MON, RepeatFreq.daily);
        other.setTime(LocalTime.of(9, 0));
        other.setSnoozedUntil(Instant.parse("2026-09-15T09:10:00Z"));
        ReminderResponse moved = splitter(other).update(USER, other.getId(), "this", MON.plusDays(2),
                new UpdateReminderRequest("Wed", null, null, null, null, null, null, null, null, null, null));
        assertThat(moved.snoozedUntil()).as("Tuesday's snooze isn't Wednesday's").isNull();
        assertThat(other.getSnoozedUntil()).isNotNull();
    }

    /* ---- done ---- */

    @Test
    void doneNeedsARealOccurrenceAndDropsThePendingSnooze() {
        CalendarReminderRepository repo = mock(CalendarReminderRepository.class);
        ReminderDoneRepository done = mock(ReminderDoneRepository.class);
        ReminderService service = new ReminderService(repo, mock(UserClock.class), null, done);
        CalendarReminder r = rule(MON, RepeatFreq.weekly);
        r.setSnoozedUntil(Instant.parse("2026-09-14T09:10:00Z"));
        when(repo.findByIdAndUserId(r.getId(), USER)).thenReturn(Optional.of(r));

        assertThatThrownBy(() -> service.setDone(USER, r.getId(), MON.plusDays(1), true))
                .as("a Tuesday the weekly Monday reminder isn't on")
                .isInstanceOf(ApiException.class);

        service.setDone(USER, r.getId(), MON.plusDays(7), true);
        verify(done).save(any(ReminderDone.class));
        assertThat(r.getSnoozedUntil()).isNull();

        ReminderDone row = new ReminderDone();
        when(done.findByReminderIdAndOccurrenceDate(r.getId(), MON.plusDays(7))).thenReturn(Optional.of(row));
        service.setDone(USER, r.getId(), MON.plusDays(7), false);
        verify(done).delete(row);
    }

    @Test
    void theListCarriesDoneDates() {
        CalendarReminderRepository repo = mock(CalendarReminderRepository.class);
        ReminderDoneRepository done = mock(ReminderDoneRepository.class);
        UserClock clock = mock(UserClock.class);
        when(clock.today(USER)).thenReturn(MON);
        ReminderService service = new ReminderService(repo, clock, null, done);
        CalendarReminder r = rule(MON, RepeatFreq.daily);
        when(repo.findByUserId(USER)).thenReturn(List.of(r));
        ReminderDone d = new ReminderDone();
        d.setReminderId(r.getId());
        d.setOccurrenceDate(MON);
        when(done.findByUserIdAndOccurrenceDateGreaterThanEqual(USER, MON.minusDays(90))).thenReturn(List.of(d));

        assertThat(service.list(USER).get(0).doneDates()).containsExactly(MON);
    }

    @Test
    void tickingAnotherDayLeavesTodaysSnooze() {
        CalendarReminderRepository repo = mock(CalendarReminderRepository.class);
        ReminderDoneRepository done = mock(ReminderDoneRepository.class);
        ReminderService service = new ReminderService(repo, mock(UserClock.class), null, done);
        CalendarReminder r = rule(MON, RepeatFreq.daily);
        r.setTime(LocalTime.of(9, 0));
        Instant snooze = Instant.parse("2026-09-14T09:10:00Z");
        r.setSnoozedUntil(snooze);
        when(repo.findByIdAndUserId(r.getId(), USER)).thenReturn(Optional.of(r));

        service.setDone(USER, r.getId(), MON.plusDays(1), true);
        assertThat(r.getSnoozedUntil()).as("tomorrow ticked ahead of time").isEqualTo(snooze);
        service.setDone(USER, r.getId(), MON, true);
        assertThat(r.getSnoozedUntil()).isNull();
    }

    /* ---- the scheduler: done suppression and the second alert ---- */

    private final CalendarReminderRepository reminders = mock(CalendarReminderRepository.class);
    private final ReminderDispatchLogRepository dispatchLog = mock(ReminderDispatchLogRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final WhatsAppService whatsapp = mock(WhatsAppService.class);
    private final PushService push = mock(PushService.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final ReminderDoneRepository doneRepo = mock(ReminderDoneRepository.class);
    private final ReminderDeliveryScheduler scheduler = new ReminderDeliveryScheduler(reminders, dispatchLog,
            pure, users, whatsapp, push, notifications, new SnoozeLinks("test-secret"), doneRepo);

    private CalendarReminder timedAt(ZonedDateTime at) {
        CalendarReminder r = rule(at.toLocalDate(), RepeatFreq.none);
        r.setTime(at.toLocalTime());
        r.setNotifyBefore(0);
        User u = new User();
        u.setId(USER);
        u.setTimezone("UTC");
        when(reminders.findDeliverable(true, false, false)).thenReturn(List.of(r));
        when(reminders.findAllById(any())).thenReturn(List.of(r));
        when(users.findAllById(any())).thenReturn(List.of(u));
        return r;
    }

    @Test
    void aCheckedOffOccurrenceIsNotDelivered() {
        ZonedDateTime now = ZonedDateTime.now(UTC);
        CalendarReminder r = timedAt(now);
        when(doneRepo.findDone(any(), any())).thenReturn(List.<Object[]>of(new Object[] {r.getId(), now.toLocalDate()}));

        scheduler.dispatchTimedWhatsAppReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
        verify(dispatchLog, never()).saveAndFlush(any());
    }

    @Test
    void anOpenOccurrenceIsDelivered() {
        CalendarReminder r = timedAt(ZonedDateTime.now(UTC));

        scheduler.dispatchTimedWhatsAppReminders();

        verify(notifications).publish(eq(USER), eq(NotificationKind.reminder), eq("Standup"), any(), eq(r.getId()));
    }

    @Test
    void theSecondAlertRingsUnderItsOwnLogKey() {
        ZonedDateTime due = ZonedDateTime.now(UTC).plusMinutes(30);
        CalendarReminder r = timedAt(due);
        r.setNotifyBefore2(30);

        scheduler.dispatchTimedWhatsAppReminders();

        UUID second = ReminderDeliveryScheduler.secondAlertId(r.getId());
        verify(dispatchLog).findByReminderIdAndOccurrenceDate(second, due.toLocalDate());
        verify(dispatchLog, never()).findByReminderIdAndOccurrenceDate(r.getId(), due.toLocalDate());
        verify(notifications, times(1)).publish(eq(USER), eq(NotificationKind.reminder), any(), any(), eq(r.getId()));
        assertThat(second).isEqualTo(ReminderDeliveryScheduler.secondAlertId(r.getId())).isNotEqualTo(r.getId());
    }

    /** Edited into its own lead (createdAt long ago): the early ring had gone, so it rings on time, as push.js does. */
    @Test
    void anEarlyRingMissedByAnEditRingsOnTime() {
        CalendarReminder r = timedAt(ZonedDateTime.now(UTC));
        r.setNotifyBefore(10);
        r.setCreatedAt(Instant.now().minusSeconds(86400));

        scheduler.dispatchTimedWhatsAppReminders();

        verify(notifications).publish(eq(USER), eq(NotificationKind.reminder), eq("Standup"), any(), eq(r.getId()));
    }

    @Test
    void anEarlyRingAlreadySentBlocksTheOnTimeOne() {
        ZonedDateTime now = ZonedDateTime.now(UTC);
        CalendarReminder r = timedAt(now);
        r.setNotifyBefore(10);
        when(dispatchLog.findDelivered(any(), any()))
                .thenReturn(List.<Object[]>of(new Object[] {r.getId(), now.toLocalDate()}));

        scheduler.dispatchTimedWhatsAppReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
    }

    /** Two instances both read 'failed': the conditional UPDATE lets one of them send. */
    @Test
    void aFailedRowIsRetriedOnlyByTheInstanceThatClaimsIt() {
        ZonedDateTime now = ZonedDateTime.now(UTC);
        CalendarReminder r = timedAt(now);
        ReminderDispatchLog failed = new ReminderDispatchLog();
        failed.setId(UUID.randomUUID());
        failed.setReminderId(r.getId());
        failed.setOccurrenceDate(now.toLocalDate());
        failed.setStatus("failed");
        when(dispatchLog.findByReminderIdAndOccurrenceDate(r.getId(), now.toLocalDate()))
                .thenReturn(Optional.of(failed));

        when(dispatchLog.claimFailed(failed.getId())).thenReturn(0);
        scheduler.dispatchTimedWhatsAppReminders();
        verify(notifications, never()).publish(any(), any(), any(), any(), any());

        when(dispatchLog.claimFailed(failed.getId())).thenReturn(1);
        scheduler.dispatchTimedWhatsAppReminders();
        verify(notifications).publish(eq(USER), eq(NotificationKind.reminder), eq("Standup"), any(), eq(r.getId()));
        verify(dispatchLog, never()).saveAndFlush(any());
        assertThat(failed.getStatus()).isEqualTo("sent");
    }

    @Test
    void aSecondAlertEqualToTheFirstIsNotASecondRing() {
        CalendarReminder r = rule(MON, RepeatFreq.none);
        r.setNotifyBefore2(10);
        assertThat(ReminderPrefs.secondLeadFor(r, 10)).isNull();
        assertThat(ReminderPrefs.secondLeadFor(r, 0)).isEqualTo(10);
        r.setNotifyBefore2(null);
        assertThat(ReminderPrefs.secondLeadFor(r, 0)).isNull();
    }

    /* ---- quiet hours ---- */

    @Test
    void quietHoursWrapMidnightAndIgnoreNonsense() {
        Map<String, Object> night = Map.of("quietStart", "22:00", "quietEnd", "07:00");
        assertThat(ReminderPrefs.isQuiet(night, LocalTime.of(23, 30))).isTrue();
        assertThat(ReminderPrefs.isQuiet(night, LocalTime.of(6, 59))).isTrue();
        assertThat(ReminderPrefs.isQuiet(night, LocalTime.of(7, 0))).as("end exclusive").isFalse();
        assertThat(ReminderPrefs.isQuiet(night, LocalTime.of(12, 0))).isFalse();
        Map<String, Object> lunch = Map.of("quietStart", "12:00", "quietEnd", "13:00");
        assertThat(ReminderPrefs.isQuiet(lunch, LocalTime.of(12, 30))).isTrue();
        assertThat(ReminderPrefs.isQuiet(lunch, LocalTime.of(13, 30))).isFalse();
        assertThat(ReminderPrefs.isQuiet(Map.of("quietStart", "9:00", "quietEnd", "9:00"), LocalTime.of(9, 0)))
                .as("equal ends = off").isFalse();
        assertThat(ReminderPrefs.isQuiet(Map.of("quietStart", "late"), LocalTime.of(23, 0))).isFalse();
        assertThat(ReminderPrefs.isQuiet(null, LocalTime.of(23, 0))).isFalse();
    }

    /* A timed reminder the user set still rings inside quiet hours. */
    @Test
    void quietHoursDoNotSilenceAnExplicitReminder() {
        ZonedDateTime now = ZonedDateTime.now(UTC);
        CalendarReminder r = timedAt(now);
        User u = new User();
        u.setId(USER);
        u.setTimezone("UTC");
        u.setUiPrefs(Map.of("quietStart", now.minusHours(1).toLocalTime().toString().substring(0, 5),
                "quietEnd", now.plusHours(1).toLocalTime().toString().substring(0, 5)));
        when(users.findAllById(any())).thenReturn(List.of(u));

        scheduler.dispatchTimedWhatsAppReminders();

        verify(notifications).publish(eq(USER), eq(NotificationKind.reminder), any(), any(), eq(r.getId()));
    }

    /* ---- .ics ---- */

    @Test
    void rruleMapsEveryMode() {
        ZoneId zone = ZoneId.of("Asia/Kolkata");
        CalendarReminder w = rule(MON, RepeatFreq.weekly);
        w.setRepeatDays("MO,WE,FR");
        w.setRepeatInterval(2);
        assertThat(ReminderIcs.rrule(w, null, zone, WorkWeek.DEFAULT))
                .isEqualTo("FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE,FR;INTERVAL=2");

        CalendarReminder rent = rule(LocalDate.of(2026, 1, 31), RepeatFreq.monthly);
        assertThat(ReminderIcs.rrule(rent, null, zone, WorkWeek.DEFAULT))
                .as("clamped to the month's last day, like occursOn")
                .isEqualTo("FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");

        CalendarReminder nth = rule(LocalDate.of(2026, 9, 25), RepeatFreq.monthly);
        nth.setRepeatNth(-1);
        assertThat(ReminderIcs.rrule(nth, null, zone, WorkWeek.DEFAULT)).isEqualTo("FREQ=MONTHLY;BYDAY=-1FR");

        CalendarReminder wd = rule(MON, RepeatFreq.weekdays);
        assertThat(ReminderIcs.rrule(wd, null, zone, WorkWeek.of("sun_thu")))
                .isEqualTo("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,SU");

        CalendarReminder both = rule(MON, RepeatFreq.daily);
        both.setTime(LocalTime.of(9, 0));
        both.setRepeatCount(3);
        both.setUntilDate(MON.plusDays(10));
        assertThat(ReminderIcs.rrule(both, 3, zone, WorkWeek.DEFAULT))
                .as("the count ends it first, and RRULE may carry only one")
                .isEqualTo("FREQ=DAILY;COUNT=3");
        both.setUntilDate(MON.plusDays(1));
        assertThat(ReminderIcs.rrule(both, 3, zone, WorkWeek.DEFAULT))
                .as("until in UTC: 23:59:59 IST is 18:29:59Z")
                .isEqualTo("FREQ=DAILY;UNTIL=20260915T182959Z");
    }

    @Test
    void theFileUsesLocalTimesWithTheUsersZone() {
        CalendarReminder r = rule(MON, RepeatFreq.weekly);
        r.setRepeatDays("TU");
        r.setTime(LocalTime.of(9, 30));
        r.setNotes("Bring the deck; and, coffee\nline two");
        r.setNotifyBefore(10);
        r.setNotifyBefore2(1440);
        r.setSkipDays(Set.of(MON.plusDays(8)));
        String ics = ReminderIcs.build(List.of(r), ZoneId.of("Europe/London"), WorkWeek.DEFAULT, 0,
                Instant.parse("2026-09-10T00:00:00Z"));

        assertThat(ics).startsWith("BEGIN:VCALENDAR\r\n").endsWith("END:VCALENDAR\r\n");
        assertThat(ics).as("DTSTART is the first real occurrence, the Tuesday")
                .contains("DTSTART;TZID=Europe/London:20260915T093000");
        assertThat(ics).contains("RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=TU");
        assertThat(ics).contains("EXDATE;TZID=Europe/London:20260922T093000");
        assertThat(ics).contains("DESCRIPTION:Bring the deck\\; and\\, coffee\\nline two");
        assertThat(ics).contains("TRIGGER:-PT10M").contains("TRIGGER:-PT1440M");
        for (String line : ics.split("\r\n")) {
            assertThat(line.getBytes(java.nio.charset.StandardCharsets.UTF_8).length).isLessThanOrEqualTo(75);
        }
    }
}
