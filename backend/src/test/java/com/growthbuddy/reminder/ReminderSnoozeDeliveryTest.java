package com.growthbuddy.reminder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
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
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * A snooze rings at least once and not five times: the claim writes a 'pending'
 * dispatch-log row keyed on the snooze, the send marks it 'sent', and the sweeper
 * rings again a claim whose instance died before it could — up to its cap.
 */
class ReminderSnoozeDeliveryTest {

    private static final UUID USER = UUID.randomUUID();

    private final CalendarReminderRepository reminders = mock(CalendarReminderRepository.class);
    private final ReminderDispatchLogRepository dispatchLog = mock(ReminderDispatchLogRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final WhatsAppService whatsapp = mock(WhatsAppService.class);
    private final PushService push = mock(PushService.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final ReminderDoneRepository doneRepo = mock(ReminderDoneRepository.class);
    private final ReminderService pure = new ReminderService(null, null, null);

    private ReminderDeliveryScheduler scheduler() {
        return new ReminderDeliveryScheduler(reminders, dispatchLog, pure, users, whatsapp, push,
                notifications, new SnoozeLinks("test-secret"), doneRepo);
    }

    /** A reminder hours away from its own time, with a snooze due this minute. */
    private CalendarReminder snoozed(Instant at) {
        CalendarReminder r = new CalendarReminder();
        r.setId(UUID.randomUUID());
        r.setUserId(USER);
        r.setText("Call mom");
        r.setAnchorDate(LocalDate.now(ZoneOffset.UTC));
        r.setRepeat(RepeatFreq.none);
        r.setTime(at.plus(Duration.ofHours(3)).atZone(ZoneOffset.UTC).toLocalTime());
        r.setNotifyBefore(0);
        r.setSnoozedUntil(at);
        User u = new User();
        u.setId(USER);
        u.setTimezone("UTC");
        when(reminders.findDeliverable(true, false, false)).thenReturn(List.of(r));
        when(reminders.findAllById(any())).thenReturn(List.of(r));
        when(users.findAllById(any())).thenReturn(List.of(u));
        when(reminders.findById(r.getId())).thenReturn(Optional.of(r));
        when(users.findById(USER)).thenReturn(Optional.of(u));
        return r;
    }

    private static ReminderDispatchLog stuck(CalendarReminder r, int attempts, String status, Instant created) {
        ReminderDispatchLog row = new ReminderDispatchLog();
        row.setId(UUID.randomUUID());
        row.setReminderId(ReminderDeliveryScheduler.snoozeLogId(r.getId(), r.getSnoozedUntil()));
        row.setOccurrenceDate(LocalDate.now(ZoneOffset.UTC));
        row.setSnoozeOf(r.getId());
        row.setChannel("none");
        row.setStatus(status);
        row.setAttempts(attempts);
        row.setCreatedAt(created);
        return row;
    }

    private void verifyRang(int n, CalendarReminder r) {
        verify(notifications, times(n)).publish(eq(USER), eq(NotificationKind.reminder), eq("Call mom"), any(),
                eq(r.getId()));
    }

    @Test
    void theClaimWritesAPendingRowThenTheSendMarksItSent() {
        Instant at = Instant.now().truncatedTo(ChronoUnit.MINUTES);
        CalendarReminder r = snoozed(at);
        when(reminders.claimSnooze(r.getId(), at)).thenReturn(1);

        scheduler().dispatchTimedWhatsAppReminders();

        ArgumentCaptor<ReminderDispatchLog> row = ArgumentCaptor.forClass(ReminderDispatchLog.class);
        verify(dispatchLog).saveAndFlush(row.capture());
        assertThat(row.getValue().getStatus()).isEqualTo("pending");
        assertThat(row.getValue().getSnoozeOf()).isEqualTo(r.getId());
        assertThat(row.getValue().getAttempts()).isEqualTo(1);
        assertThat(row.getValue().getReminderId())
                .isEqualTo(ReminderDeliveryScheduler.snoozeLogId(r.getId(), at))
                .as("never the occurrence's own key").isNotEqualTo(r.getId());
        verifyRang(1, r);
        verify(dispatchLog).settleSnooze(any(), eq("sent"), eq("app"), isNull());
    }

    @Test
    void aClaimWhoseInstanceDiedIsRungAgainBySweeper() {
        Instant now = Instant.now();
        CalendarReminder r = snoozed(now.truncatedTo(ChronoUnit.MINUTES));
        // The claim committed (snoozed_until is already cleared), then the instance died.
        r.setSnoozedUntil(null);
        ReminderDispatchLog row = stuck(r, 1, "pending", now.minus(Duration.ofMinutes(3)));
        when(dispatchLog.findStuckSnoozes(any())).thenReturn(List.of(row));
        when(dispatchLog.claimResend(row.getId(), 1)).thenReturn(1);

        scheduler().resendStuckSnoozes(now);

        verifyRang(1, r);
        verify(dispatchLog).settleSnooze(eq(row.getId()), eq("sent"), eq("app"), isNull());
    }

    @Test
    void aSentRowIsNotResentAndAFreshClaimIsLeftToItsSender() {
        Instant now = Instant.now();
        CalendarReminder r = snoozed(now.truncatedTo(ChronoUnit.MINUTES));
        ReminderDispatchLog sent = stuck(r, 1, "sent", now.minus(Duration.ofMinutes(10)));
        // Second try made 3 minutes after the claim: its own 2 minutes are not up yet.
        ReminderDispatchLog retried = stuck(r, 2, "pending", now.minus(Duration.ofMinutes(3)));
        when(dispatchLog.findStuckSnoozes(any())).thenReturn(List.of(sent, retried));

        scheduler().resendStuckSnoozes(now);

        verifyRang(0, r);
        verify(dispatchLog, never()).claimResend(any(), anyInt());
        verify(dispatchLog, never()).settleSnooze(any(), any(), any(), any());
    }

    @Test
    void theSweeperStopsAtItsCap() {
        Instant now = Instant.now();
        CalendarReminder r = snoozed(now.truncatedTo(ChronoUnit.MINUTES));
        int all = 1 + ReminderDeliveryScheduler.SNOOZE_RESENDS;
        ReminderDispatchLog spent = stuck(r, all, "pending", now.minus(Duration.ofMinutes(30)));
        when(dispatchLog.findStuckSnoozes(any())).thenReturn(List.of(spent));

        scheduler().resendStuckSnoozes(now);

        verifyRang(0, r);
        verify(dispatchLog, never()).claimResend(any(), anyInt());
        verify(dispatchLog).settleSnooze(eq(spent.getId()), eq("failed"), any(), any());
    }

    @Test
    void theLastResendFailingMarksItFailed() {
        Instant now = Instant.now();
        CalendarReminder r = snoozed(now.truncatedTo(ChronoUnit.MINUTES));
        ReminderDispatchLog last = stuck(r, ReminderDeliveryScheduler.SNOOZE_RESENDS, "pending",
                now.minus(Duration.ofMinutes(5)));
        when(dispatchLog.findStuckSnoozes(any())).thenReturn(List.of(last));
        when(dispatchLog.claimResend(last.getId(), last.getAttempts())).thenReturn(1);
        doThrow(new RuntimeException("bell down")).when(notifications)
                .publish(any(), any(), any(), any(), any());

        scheduler().resendStuckSnoozes(now);

        verify(dispatchLog).settleSnooze(eq(last.getId()), eq("failed"), eq("none"), any());
    }

    @Test
    void twoInstancesRacingForOneSnoozeRingItOnce() {
        Instant at = Instant.now().truncatedTo(ChronoUnit.MINUTES);
        CalendarReminder r = snoozed(at);
        // Both read the same snoozed_until; the unique key admits only the first row.
        when(reminders.claimSnooze(r.getId(), at)).thenReturn(1);
        when(dispatchLog.saveAndFlush(any()))
                .thenAnswer(inv -> inv.getArgument(0))
                .thenThrow(new DataIntegrityViolationException("ux_rem_dispatch_unique"));

        scheduler().dispatchTimedWhatsAppReminders();
        scheduler().dispatchTimedWhatsAppReminders();

        ArgumentCaptor<ReminderDispatchLog> rows = ArgumentCaptor.forClass(ReminderDispatchLog.class);
        verify(dispatchLog, times(2)).saveAndFlush(rows.capture());
        assertThat(rows.getAllValues().get(1).getReminderId()).isEqualTo(rows.getAllValues().get(0).getReminderId());
        assertThat(rows.getAllValues().get(1).getOccurrenceDate())
                .isEqualTo(rows.getAllValues().get(0).getOccurrenceDate());
        verify(reminders, times(1)).claimSnooze(r.getId(), at);
        verifyRang(1, r);
    }

    @Test
    void twoSweepersOnOneStuckRowResendItOnce() {
        Instant now = Instant.now();
        CalendarReminder r = snoozed(now.truncatedTo(ChronoUnit.MINUTES));
        ReminderDispatchLog row = stuck(r, 1, "pending", now.minus(Duration.ofMinutes(3)));
        when(dispatchLog.findStuckSnoozes(any())).thenReturn(List.of(row));
        when(dispatchLog.claimResend(row.getId(), 1)).thenReturn(1, 0);

        scheduler().resendStuckSnoozes(now);
        scheduler().resendStuckSnoozes(now);

        verifyRang(1, r);
    }
}
