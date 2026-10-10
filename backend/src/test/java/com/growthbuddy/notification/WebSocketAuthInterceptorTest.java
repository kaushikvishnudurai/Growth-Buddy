package com.growthbuddy.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.user.SessionService;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;

/**
 * The socket's trust boundary: a CONNECT needs a live session token, a
 * SUBSCRIBE may only name the caller's own queue (or a client could listen in
 * on someone else's notifications), a SEND is never accepted (or it could forge
 * one into their bell), and a revoked token silences the socket it opened.
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

        connectAs("s1", "good");
        Message<byte[]> m = frame(subscribe("s1"));
        assertThat(interceptor.preSend(m, null)).isSameAs(m);
    }

    private void connectAs(String sessionId, String token) {
        when(sessions.resolve(token)).thenReturn(Optional.of(USER));
        StompHeaderAccessor acc = connect("Bearer " + token);
        acc.setSessionId(sessionId);
        interceptor.preSend(frame(acc), null);
    }

    private static StompHeaderAccessor subscribe(String sessionId) {
        StompHeaderAccessor acc = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        acc.setSessionId(sessionId);
        acc.setUser(new WebSocketConfig.StompPrincipal(USER.toString()));
        acc.setDestination("/user/queue/notifications");
        return acc;
    }

    private static Message<byte[]> pushTo(String sessionId) {
        SimpMessageHeaderAccessor acc = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        acc.setSessionId(sessionId);
        return MessageBuilder.createMessage(new byte[0], acc.getMessageHeaders());
    }

    /** Forging: a signed-in client SENDs into another user's queue. Nothing is SEND-able. */
    @Test
    void sendIsRefusedEvenWhenSignedIn() {
        connectAs("s1", "good");
        for (String dest : List.of("/user/" + UUID.randomUUID() + "/queue/notifications",
                "/queue/notifications", "/topic/anything", "/app/anything")) {
            StompHeaderAccessor send = StompHeaderAccessor.create(StompCommand.SEND);
            send.setSessionId("s1");
            send.setUser(new WebSocketConfig.StompPrincipal(USER.toString()));
            send.setDestination(dest);
            assertThatThrownBy(() -> interceptor.preSend(frame(send), null))
                    .as(dest).isInstanceOf(MessagingException.class);
        }
    }

    /** Password change / account deletion revokes the token: the open socket goes quiet. */
    @Test
    void aRevokedSessionStopsReceivingAndCannotResubscribe() {
        connectAs("s1", "good");
        assertThat(interceptor.mayDeliver(pushTo("s1"))).isTrue();

        when(sessions.resolve("good")).thenReturn(Optional.empty());
        assertThat(interceptor.mayDeliver(pushTo("s1"))).isFalse();
        assertThatThrownBy(() -> interceptor.preSend(frame(subscribe("s1")), null))
                .isInstanceOf(MessagingException.class);
        // A socket that never CONNECTed gets nothing either.
        assertThat(interceptor.mayDeliver(pushTo("unknown"))).isFalse();
    }

    @Test
    void disconnectForgetsTheToken() {
        connectAs("s1", "good");
        StompHeaderAccessor bye = StompHeaderAccessor.create(StompCommand.DISCONNECT);
        bye.setSessionId("s1");
        interceptor.preSend(frame(bye), null);
        assertThat(interceptor.mayDeliver(pushTo("s1"))).isFalse();
    }
}
