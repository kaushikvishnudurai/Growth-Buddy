package com.growthbuddy.reminder;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.push.PushService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * An account scheduled for deletion gets nothing in its 7-day grace period: no
 * bell, no WhatsApp, no push, not even a dispatch-log claim. Its sessions are
 * revoked; a reminder ringing a phone it signed out of says it isn't gone.
 */
class ReminderPendingDeletionTest {

    private static final ZoneId UTC = ZoneId.of("UTC");
    private static final UUID USER = UUID.randomUUID();

    private final CalendarReminderRepository reminders = mock(CalendarReminderRepository.class);
    private final ReminderDispatchLogRepository dispatchLog = mock(ReminderDispatchLogRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final WhatsAppService whatsapp = mock(WhatsAppService.class);
    private final PushService push = mock(PushService.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final ReminderDoneRepository doneRepo = mock(ReminderDoneRepository.class);
    private final ReminderDeliveryScheduler scheduler = new ReminderDeliveryScheduler(reminders, dispatchLog,
            new ReminderService(null, null, null), users, whatsapp, push, notifications,
            new SnoozeLinks("test-secret"), doneRepo);

    private CalendarReminder dueNow(User owner) {
        ZonedDateTime at = ZonedDateTime.now(UTC);
        CalendarReminder r = new CalendarReminder();
        r.setId(UUID.randomUUID());
        r.setUserId(USER);
        r.setText("Standup");
        r.setAnchorDate(at.toLocalDate());
        r.setRepeat(RepeatFreq.none);
        r.setTime(at.toLocalTime());
        r.setNotifyBefore(0);
        when(whatsapp.isConfigured()).thenReturn(true);
        when(push.isConfigured()).thenReturn(true);
        when(reminders.findDeliverable(true, true, true)).thenReturn(List.of(r));
        when(reminders.findAllById(any())).thenReturn(List.of(r));
        when(users.findAllById(any())).thenReturn(List.of(owner));
        return r;
    }

    private static User owner(Instant deletionRequestedAt) {
        User u = new User();
        u.setId(USER);
        u.setTimezone("UTC");
        u.setWhatsappEnabled(true);
        u.setWhatsappNumber("+15550001111");
        u.setDeletionRequestedAt(deletionRequestedAt);
        return u;
    }

    @Test
    void anAccountScheduledForDeletionIsNotDeliveredTo() {
        dueNow(owner(Instant.now().minusSeconds(3600)));

        scheduler.dispatchTimedWhatsAppReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
        verify(whatsapp, never()).sendSnoozableReminder(anyString(), anyString(), any(), anyInt());
        verify(push, never()).sendToUser(any(UUID.class), any(String.class), any(String.class), any(String.class),
                any(java.util.Map.class));
        verify(dispatchLog, never()).saveAndFlush(any());
    }

    @Test
    void theSameReminderOnALiveAccountStillRings() {
        CalendarReminder r = dueNow(owner(null));

        scheduler.dispatchTimedWhatsAppReminders();

        verify(notifications).publish(eq(USER), eq(NotificationKind.reminder), eq("Standup"), any(), eq(r.getId()));
    }
}
