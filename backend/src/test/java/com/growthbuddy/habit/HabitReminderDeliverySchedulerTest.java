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
                    whatsapp);

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
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), today())).thenReturn(false);
        when(push.isConfigured()).thenReturn(false);

        scheduler.dispatchHabitReminders();

        verify(notifications).publish(eq(userId), eq(NotificationKind.habit_reminder),
                eq("Workout"), any(), eq(habit.getId()));
        verify(dispatchLog).save(any());
    }

    @Test
    void skipsAHabitAlreadyCheckedInToday() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
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
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
    }

    @Test
    void sendsPushTooWhenConfigured() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, true)).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), today())).thenReturn(false);
        when(push.isConfigured()).thenReturn(true);
        when(push.sendToUser(userId, "Habit reminder", "Workout", "/#habits")).thenReturn(1);

        scheduler.dispatchHabitReminders();

        verify(push).sendToUser(userId, "Habit reminder", "Workout", "/#habits");
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
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(whatsapp.isConfigured()).thenReturn(true);

        scheduler.dispatchHabitReminders();

        verify(whatsapp, never()).sendReminder(any(), any());
    }
}
