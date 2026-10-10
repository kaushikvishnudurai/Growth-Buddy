package com.growthbuddy.money;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.reminder.ReminderDispatchLogRepository;
import com.growthbuddy.reminder.WhatsAppService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** No bill-due WhatsApp goes to an account scheduled for deletion. */
class SubscriptionDuePendingDeletionTest {

    private final UserRepository users = mock(UserRepository.class);
    private final MoneyRepository money = mock(MoneyRepository.class);
    private final ReminderDispatchLogRepository dispatchLog = mock(ReminderDispatchLogRepository.class);
    private final WhatsAppService whatsapp = mock(WhatsAppService.class);
    private final SubscriptionDueScheduler scheduler =
            new SubscriptionDueScheduler(users, money, dispatchLog, whatsapp);

    /** A subscription due today, in a zone where it is noon now — past SEND_HOUR whatever the clock says. */
    private User dueNow(Instant deletionRequestedAt) throws Exception {
        ZoneOffset noon = ZoneOffset.ofHours(12 - ZonedDateTime.now(ZoneOffset.UTC).getHour());
        int today = ZonedDateTime.now(noon).getDayOfMonth();
        User u = new User();
        u.setId(UUID.randomUUID());
        u.setTimezone(noon.getId());
        u.setWhatsappEnabled(true);
        u.setWhatsappVerified(true);
        u.setWhatsappNumber("+15550001111");
        u.setDeletionRequestedAt(deletionRequestedAt);
        MoneyState state = new MoneyState();
        state.setUserId(u.getId());
        state.setSubDueDays(1 << (today - 1));
        state.setData(new ObjectMapper().readTree(
                "{\"subscriptions\":[{\"id\":\"s1\",\"name\":\"Gym\",\"amount\":900,\"dueDay\":" + today + "}]}"));
        when(whatsapp.isConfigured()).thenReturn(true);
        when(money.findWhatsappUserIdsDueOn(anyInt())).thenReturn(List.of(u.getId().toString()));
        when(users.findAllById(any())).thenReturn(List.of(u));
        when(money.findById(u.getId())).thenReturn(Optional.of(state));
        return u;
    }

    @Test
    void anAccountScheduledForDeletionGetsNoBillDue() throws Exception {
        dueNow(Instant.now());

        scheduler.dispatch();

        verify(whatsapp, never()).sendBillDue(anyString(), anyString(), anyString());
        verify(dispatchLog, never()).save(any());
    }

    @Test
    void aLiveAccountStillDoes() throws Exception {
        dueNow(null);

        scheduler.dispatch();

        verify(whatsapp).sendBillDue(eq("+15550001111"), anyString(), anyString());
    }
}
