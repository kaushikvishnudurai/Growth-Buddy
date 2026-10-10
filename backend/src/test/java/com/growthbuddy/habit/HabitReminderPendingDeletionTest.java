package com.growthbuddy.habit;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.notification.NotifyCategory;
import com.growthbuddy.push.PushService;
import com.growthbuddy.reminder.WhatsAppService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** A habit reminder never reaches an account scheduled for deletion, on any channel. */
class HabitReminderPendingDeletionTest {

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

    private Habit dueFor(User owner) {
        Habit h = new Habit();
        h.setId(UUID.randomUUID());
        h.setUserId(owner.getId());
        h.setName("Workout");
        h.setReminderTime(LocalTime.now(UTC));
        when(push.isConfigured()).thenReturn(true);
        when(whatsapp.isConfigured()).thenReturn(true);
        when(habits.findDeliverable(true, true)).thenReturn(List.of(h));
        when(habits.findAllById(any())).thenReturn(List.of(h));
        when(users.findAllById(any())).thenReturn(List.of(owner));
        return h;
    }

    private static User owner(Instant deletionRequestedAt) {
        User u = new User();
        u.setId(UUID.randomUUID());
        u.setTimezone("UTC");
        u.setWhatsappEnabled(true);
        u.setWhatsappNumber("+15550001111");
        u.setDeletionRequestedAt(deletionRequestedAt);
        return u;
    }

    @Test
    void anAccountScheduledForDeletionIsSkipped() {
        dueFor(owner(Instant.now()));

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
        verify(whatsapp, never()).sendReminder(anyString(), anyString());
        verify(push, never()).sendToUser(any(UUID.class), any(NotifyCategory.class), any(String.class),
                any(String.class), any(String.class));
        verify(dispatchLog, never()).saveAndFlush(any());
    }

    @Test
    void aLiveAccountStillGetsIt() {
        User live = owner(null);
        Habit h = dueFor(live);

        scheduler.dispatchHabitReminders();

        verify(notifications).publish(eq(live.getId()), eq(NotificationKind.habit_reminder),
                eq("Workout"), any(), eq(h.getId()));
    }
}
