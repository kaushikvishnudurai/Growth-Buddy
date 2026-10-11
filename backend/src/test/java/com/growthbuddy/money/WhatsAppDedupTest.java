package com.growthbuddy.money;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.quickadd.QuickAddApplier;
import com.growthbuddy.quickadd.QuickAddService;
import com.growthbuddy.reminder.ReminderSnoozeService;
import com.growthbuddy.reminder.WhatsAppService;
import com.growthbuddy.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Set;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

/** SEC-19: a redelivered (or replayed) signed message acts once. */
class WhatsAppDedupTest {

    @Test
    void theSameMessageIdIsHandledOnce() throws Exception {
        UserRepository users = mock(UserRepository.class);
        RateLimiter seen = mock(RateLimiter.class);
        Set<String> keys = new HashSet<>();
        when(seen.allow(anyString(), org.mockito.ArgumentMatchers.eq(1), org.mockito.ArgumentMatchers.anyLong()))
                .thenAnswer(inv -> keys.add(inv.getArgument(0)));
        var controller = new WhatsAppWebhookController("s3cret", "", new ObjectMapper(), users,
                mock(MoneyService.class), mock(WhatsAppService.class), mock(ReminderSnoozeService.class),
                mock(QuickAddService.class), mock(QuickAddApplier.class), seen);

        byte[] body = ("{\"entry\":[{\"changes\":[{\"value\":{\"messages\":[{\"id\":\"wamid.1\",\"from\":\"919800000000\","
                + "\"type\":\"button\",\"button\":{\"payload\":\"paid:m1:2026-09\"}}]}}]}]}")
                .getBytes(StandardCharsets.UTF_8);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("s3cret".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String sig = "sha256=" + HexFormat.of().formatHex(mac.doFinal(body));

        controller.receive(body, sig);
        controller.receive(body, sig);

        verify(users, times(1)).findByWhatsappNumberAndWhatsappEnabledTrueAndWhatsappVerifiedTrue("+919800000000");
    }
}
