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
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class HabitReminderDeliverySchedulerTest {

    private static final ZoneId UTC = ZoneId.of("UTC");

    private final HabitRepository habits = mock(HabitRepository.class);
    private final HabitCheckinRepository checkins = mock(HabitCheckinRepository.class);
    private final HabitReminderDispatchLogRepository dispatchLog =
            mock(HabitReminderDispatchLogRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final PushService push = mock(PushService.class);
    private final NotificationService notifications = mock(NotificationService.class);

    private final HabitReminderDeliveryScheduler scheduler =
            new HabitReminderDeliveryScheduler(habits, checkins, dispatchLog, users, push, notifications);

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
        when(dispatchLog.existsByHabitIdAndOccurrenceDateAndStatus(habit.getId(), today(), "sent"))
                .thenReturn(false);
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
        when(dispatchLog.existsByHabitIdAndOccurrenceDateAndStatus(habit.getId(), today(), "sent"))
                .thenReturn(true);

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
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
        when(dispatchLog.existsByHabitIdAndOccurrenceDateAndStatus(habit.getId(), today(), "sent"))
                .thenReturn(false);
        when(push.isConfigured()).thenReturn(true);
        when(push.sendToUser(userId, "Habit reminder", "Workout", "/#habits")).thenReturn(1);

        scheduler.dispatchHabitReminders();

        verify(push).sendToUser(userId, "Habit reminder", "Workout", "/#habits");
    }
}
