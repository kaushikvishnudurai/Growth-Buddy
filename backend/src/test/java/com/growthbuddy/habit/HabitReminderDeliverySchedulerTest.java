package com.growthbuddy.habit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.notification.NotifyCategory;
import com.growthbuddy.push.PushService;
import com.growthbuddy.reminder.WhatsAppService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

class HabitReminderDeliverySchedulerTest {

    private static final ZoneId UTC = ZoneId.of("UTC");

    private final HabitRepository habits = mock(HabitRepository.class);
    private final HabitCheckinRepository checkins = mock(HabitCheckinRepository.class);
    private final HabitReminderDispatchLogRepository dispatchLog =
            mock(HabitReminderDispatchLogRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final PushService push = mock(PushService.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final WhatsAppService whatsapp = mock(WhatsAppService.class);

    private final HabitReminderDeliveryScheduler scheduler =
            new HabitReminderDeliveryScheduler(habits, checkins, dispatchLog, users, push, notifications,
                    whatsapp, new com.growthbuddy.reminder.SnoozeLinks("test-secret"));

    /** A habit whose reminder time is "right now" in UTC, so it always falls
     *  inside the scheduler's catch-up window regardless of wall-clock time. */
    private Habit dueHabit(UUID userId) {
        Habit h = new Habit();
        h.setId(UUID.randomUUID());
        h.setUserId(userId);
        h.setName("Workout");
        h.setReminderTime(LocalTime.now(UTC));
        return h;
    }

    private User user(UUID id) {
        User u = new User();
        u.setId(id);
        u.setTimezone("UTC");
        return u;
    }

    private LocalDate today() {
        return LocalDate.now(UTC);
    }

    @Test
    void firesForADueHabitNotYetCheckedInOrDispatched() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), today())).thenReturn(false);
        when(push.isConfigured()).thenReturn(false);

        scheduler.dispatchHabitReminders();

        verify(notifications).publish(eq(userId), eq(NotificationKind.habit_reminder),
                eq("Workout"), any(), eq(habit.getId()));
        verify(dispatchLog).save(any());
    }

    /** A 3-per-week habit done three times this week is not owed again until next week. */
    @Test
    void skipsANPerWeekHabitWhoseWeekIsMet() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        habit.setCadence(Cadence.custom);
        habit.setTargetPerWeek(3);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(checkins.countByHabitIdAndDoneTrueAndLogDateBetween(
                habit.getId(), HabitService.weekStartOf(today()), today())).thenReturn(3L);

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
        verify(dispatchLog, never()).saveAndFlush(any());
    }

    @Test
    void stillRemindsAWeeklyHabitNotYetDoneThisWeek() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        habit.setCadence(Cadence.weekly);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));

        scheduler.dispatchHabitReminders();

        verify(notifications).publish(eq(userId), eq(NotificationKind.habit_reminder),
                eq("Workout"), any(), eq(habit.getId()));
    }

    /** I-08: a break quiets habit reminders on every channel, in the user's own day. */
    @Test
    void staysQuietOnABreakDay() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        User u = user(userId);
        u.setUiPrefs(new java.util.HashMap<>(java.util.Map.of(
                "breakFrom", today().minusDays(1).toString(), "breakUntil", today().plusDays(1).toString())));
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(u));

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
        verify(dispatchLog, never()).saveAndFlush(any());
    }

    @Test
    void skipsAHabitAlreadyCheckedInToday() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), today())).thenReturn(true);

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
        verify(dispatchLog, never()).save(any());
    }

    @Test
    void skipsAHabitAlreadySentToday() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), today())).thenReturn(false);
        when(dispatchLog.findByHabitIdAndOccurrenceDate(habit.getId(), today()))
                .thenReturn(Optional.of(logRow(habit, "sent")));

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
    }

    /** A crash between claim and send leaves 'sending'; resending could repeat it. */
    @Test
    void treatsAClaimLeftByACrashAsDelivered() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(dispatchLog.findByHabitIdAndOccurrenceDate(habit.getId(), today()))
                .thenReturn(Optional.of(logRow(habit, "sending")));

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
        verify(dispatchLog, never()).saveAndFlush(any());
    }

    /** A retry used to insert a second row, hit the unique key, and so never record
     *  that it had sent — which resent it on every tick of the catch-up window. */
    @Test
    void retriesAFailedSendOnTheSameRow() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        HabitReminderDispatchLog failed = logRow(habit, "failed");
        failed.setErrorMessage("timeout");
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(dispatchLog.findByHabitIdAndOccurrenceDate(habit.getId(), today()))
                .thenReturn(Optional.of(failed));

        scheduler.dispatchHabitReminders();

        verify(dispatchLog).saveAndFlush(failed);
        verify(dispatchLog).save(failed);
        assertThat(failed.getStatus()).isEqualTo("sent");
        assertThat(failed.getErrorMessage()).isNull();
    }

    @Test
    void claimsTheDayBeforeSending() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(dispatchLog.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("dup"));

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
    }

    private HabitReminderDispatchLog logRow(Habit habit, String status) {
        HabitReminderDispatchLog row = new HabitReminderDispatchLog();
        row.setId(UUID.randomUUID());
        row.setHabitId(habit.getId());
        row.setOccurrenceDate(today());
        row.setChannel("app");
        row.setStatus(status);
        return row;
    }

    @Test
    void skipsAHabitWhoseTimeHasNotArrivedYet() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        habit.setReminderTime(LocalTime.now(UTC).plusHours(2));
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
    }

    @Test
    void sendsPushTooWhenConfigured() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, true)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), today())).thenReturn(false);
        when(push.isConfigured()).thenReturn(true);
        when(push.sendToUser(eq(userId), eq(NotifyCategory.habits), eq("Habit reminder"), eq("Workout"),
                eq("/#habits"), any())).thenReturn(1);

        scheduler.dispatchHabitReminders();

        // A plain habit's push carries its Done button: a ticket and where to send it.
        org.mockito.ArgumentCaptor<java.util.Map<String, String>> extra =
                org.mockito.ArgumentCaptor.forClass(java.util.Map.class);
        verify(push).sendToUser(eq(userId), eq(NotifyCategory.habits), eq("Habit reminder"), eq("Workout"),
                eq("/#habits"), extra.capture());
        assertThat(extra.getValue()).containsEntry("doneLink", "/api/habits/done-link").containsKey("done");
    }

    /* The reported bug: WhatsApp on, calendar reminders arrived there, habit
       reminders only reached the app. */
    @Test
    void alsoSendsToWhatsAppForAUserWhoTurnedItOn() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        User u = user(userId);
        u.setWhatsappEnabled(true);
        u.setWhatsappNumber("+919800000000");
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(u));
        when(whatsapp.isConfigured()).thenReturn(true);

        scheduler.dispatchHabitReminders();

        verify(whatsapp).sendReminder(eq("+919800000000"), eq("Time for your habit: Workout"));
        verify(dispatchLog).save(org.mockito.ArgumentMatchers.argThat(r ->
                "app+whatsapp".equals(r.getChannel()) && "sent".equals(r.getStatus())));
    }

    @Test
    void skipsWhatsAppWhenTheUserHasNotTurnedItOn() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(whatsapp.isConfigured()).thenReturn(true);

        scheduler.dispatchHabitReminders();

        verify(whatsapp, never()).sendReminder(any(), any());
    }

    /* The candidate list is cached (DeliveryCache): a quiet minute must not
       re-read every habit, but any write must be seen on the very next tick. */
    @Test
    void reusesTheCandidateListUntilSomethingChanges() {
        UUID userId = UUID.randomUUID();
        Habit later = dueHabit(userId);
        later.setReminderTime(LocalTime.now(UTC).plusHours(2));
        when(habits.findDeliverable(true, false)).thenReturn(List.of(later));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));

        scheduler.dispatchHabitReminders();
        scheduler.dispatchHabitReminders();
        verify(habits, times(1)).findDeliverable(true, false);
        verify(habits, never()).findAllById(any()); // nothing due: no fresh read either

        com.growthbuddy.common.DeliveryCache.changed();
        scheduler.dispatchHabitReminders();
        verify(habits, times(2)).findDeliverable(true, false);
    }

    /* Due in the cached list, but deleted since (bulk SQL skips the listener):
       the fresh read before sending drops it. */
    @Test
    void doesNotSendAHabitGoneSinceTheListWasLoaded() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(habits.findAllById(any())).thenReturn(List.of());

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
    }

    /* Quiet hours hold a habit reminder back on every server channel (the
       window here wraps midnight when the test runs late in the day). */
    @Test
    void quietHoursHoldAHabitReminderBack() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        User u = user(userId);
        java.time.format.DateTimeFormatter hhmm = java.time.format.DateTimeFormatter.ofPattern("HH:mm");
        u.setUiPrefs(java.util.Map.of(
                "quietStart", habit.getReminderTime().minusHours(1).format(hhmm),
                "quietEnd", habit.getReminderTime().plusHours(1).format(hhmm)));
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(habits.findAllById(any())).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(u));

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
        verify(dispatchLog, never()).save(any());
    }
}
