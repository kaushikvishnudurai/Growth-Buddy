package com.growthbuddy.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SEC-03: the endpoint is a URL the server POSTs to, so only real push services pass. */
class PushEndpointTest {

    @Test
    void onlyHttpsPushServicesPass() {
        assertThat(PushService.allowedEndpoint("https://fcm.googleapis.com/fcm/send/abc")).isTrue();
        assertThat(PushService.allowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).isTrue();
        assertThat(PushService.allowedEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).isTrue();
        assertThat(PushService.allowedEndpoint("https://web.push.apple.com/QK")).isTrue();

        assertThat(PushService.allowedEndpoint("http://fcm.googleapis.com/fcm/send/abc")).as("plain http").isFalse();
        assertThat(PushService.allowedEndpoint("https://169.254.169.254/latest/meta-data")).isFalse();
        assertThat(PushService.allowedEndpoint("https://app:8080/api/auth/me")).isFalse();
        assertThat(PushService.allowedEndpoint("https://localhost/x")).isFalse();
        assertThat(PushService.allowedEndpoint("https://fcm.googleapis.com.evil.com/x")).isFalse();
        assertThat(PushService.allowedEndpoint("https://evilfcm.googleapis.com/x")).isFalse();
        assertThat(PushService.allowedEndpoint("https://fcm.googleapis.com:8443/x")).as("odd port").isFalse();
        assertThat(PushService.allowedEndpoint("https://user@fcm.googleapis.com/x")).isFalse();
        assertThat(PushService.allowedEndpoint("not a url")).isFalse();
        assertThat(PushService.allowedEndpoint(null)).isFalse();
    }

    private final PushRepository repo = mock(PushRepository.class);
    private final PushService service = new PushService(repo, mock(UserRepository.class), "", "", "mailto:x@y.z");

    @Test
    void aBadEndpointIsRefusedAndNothingStored() {
        assertThatThrownBy(() -> service.subscribe(UUID.randomUUID(), "http://10.0.0.1/", "k", "a"))
                .isInstanceOf(ApiException.class);
        verify(repo, never()).save(any());
    }

    @Test
    void pastTheCapTheOldestDevicesGo() {
        UUID me = UUID.randomUUID();
        List<PushSubscription> mine = new ArrayList<>();
        for (int i = 0; i < PushService.MAX_SUBSCRIPTIONS + 2; i++) {
            PushSubscription s = new PushSubscription();
            s.setUserId(me);
            s.setEndpoint("https://fcm.googleapis.com/fcm/send/" + i);
            s.setCreatedAt(Instant.ofEpochSecond(1000 + i));
            mine.add(s);
        }
        when(repo.findByEndpoint(any())).thenReturn(Optional.empty());
        when(repo.findByUserId(me)).thenReturn(mine);

        service.subscribe(me, "https://fcm.googleapis.com/fcm/send/new", "k", "a");

        verify(repo).deleteAll(List.of(mine.get(0), mine.get(1)));
    }

    @Test
    void unsubscribeTouchesOnlyYourOwn() {
        PushSubscription theirs = new PushSubscription();
        theirs.setUserId(UUID.randomUUID());
        when(repo.findByEndpoint("https://fcm.googleapis.com/fcm/send/t")).thenReturn(Optional.of(theirs));
        service.unsubscribe(UUID.randomUUID(), "https://fcm.googleapis.com/fcm/send/t");
        verify(repo, never()).delete(any());
    }
}
