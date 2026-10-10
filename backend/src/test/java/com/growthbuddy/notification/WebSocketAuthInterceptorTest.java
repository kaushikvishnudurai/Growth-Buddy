package com.growthbuddy.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.user.SessionService;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;

/**
 * The socket's trust boundary: a CONNECT needs a live session token, and a
 * SUBSCRIBE may only name the caller's own queue — anything else would let a
 * client listen in on someone else's notifications.
 */
class WebSocketAuthInterceptorTest {

    private static final UUID USER = UUID.randomUUID();

    private final SessionService sessions = mock(SessionService.class);
    private final WebSocketConfig.AuthInterceptor interceptor = new WebSocketConfig.AuthInterceptor(sessions);

    private static Message<byte[]> frame(StompHeaderAccessor acc) {
        acc.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], acc.getMessageHeaders());
    }

    private static StompHeaderAccessor connect(String authorization) {
        StompHeaderAccessor acc = StompHeaderAccessor.create(StompCommand.CONNECT);
        if (authorization != null) {
            acc.addNativeHeader("Authorization", authorization);
        }
        return acc;
    }

    @Test
    void aValidTokenConnectsAsThatUser() {
        when(sessions.resolve("good")).thenReturn(Optional.of(USER));
        StompHeaderAccessor acc = connect("Bearer good");
        interceptor.preSend(frame(acc), null);
        assertThat(acc.getUser()).isNotNull();
        assertThat(acc.getUser().getName()).isEqualTo(USER.toString());
    }

    @Test
    void aMissingOrDeadTokenIsRefused() {
        when(sessions.resolve(anyString())).thenReturn(Optional.empty());
        assertThatThrownBy(() -> interceptor.preSend(frame(connect(null)), null))
                .isInstanceOf(MessagingException.class);
        assertThatThrownBy(() -> interceptor.preSend(frame(connect("Bearer stale")), null))
                .isInstanceOf(MessagingException.class);
        assertThatThrownBy(() -> interceptor.preSend(frame(connect("Basic abc")), null))
                .isInstanceOf(MessagingException.class);
    }

    @Test
    void subscribingNeedsAUserAndOnlyTheOwnQueue() {
        StompHeaderAccessor anon = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        anon.setDestination("/user/queue/notifications");
        assertThatThrownBy(() -> interceptor.preSend(frame(anon), null)).isInstanceOf(MessagingException.class);

        StompHeaderAccessor snoop = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        snoop.setUser(new WebSocketConfig.StompPrincipal(USER.toString()));
        snoop.setDestination("/queue/notifications-user" + UUID.randomUUID());
        assertThatThrownBy(() -> interceptor.preSend(frame(snoop), null)).isInstanceOf(MessagingException.class);

        StompHeaderAccessor ok = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        ok.setUser(new WebSocketConfig.StompPrincipal(USER.toString()));
        ok.setDestination("/user/queue/notifications");
        Message<byte[]> m = frame(ok);
        assertThat(interceptor.preSend(m, null)).isSameAs(m);
    }
}
