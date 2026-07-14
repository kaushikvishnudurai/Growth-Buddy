package com.growthbuddy.notification;

import com.growthbuddy.user.SessionService;
import java.security.Principal;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.util.StringUtils;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * Realtime notification channel.
 *
 * <p>STOMP over WebSocket at {@code /ws}. Clients CONNECT with
 * {@code Authorization: Bearer <token>} — the token is resolved via
 * {@link com.growthbuddy.user.SessionService} and set as the STOMP Principal,
 * so {@code SimpMessagingTemplate.convertAndSendToUser(userId, "/queue/notifications", ...)}
 * lands only on that user's subscribers.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final String allowedOrigins;
    private final SessionService sessions;

    public WebSocketConfig(@Value("${growthbuddy.cors.allowed-origins}") String allowedOrigins,
                           SessionService sessions) {
        this.allowedOrigins = allowedOrigins;
        this.sessions = sessions;
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // /user/queue/...    → per-user push (server → client)
        // /topic/...         → broadcast (unused right now, here for later)
        registry.enableSimpleBroker("/queue", "/topic");
        registry.setUserDestinationPrefix("/user");
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        String[] origins = parseAllowedOrigins();
        registry.addEndpoint("/ws")
            .setAllowedOriginPatterns(origins)
                .withSockJS();
        // Also expose a non-SockJS endpoint for a plain WebSocket client.
        registry.addEndpoint("/ws")
            .setAllowedOriginPatterns(origins);
    }

    /**
     * The only destination a client may subscribe to. Anything else (raw
     * {@code /queue/**}, {@code /topic/**}) is rejected so a client can't guess
     * another session's queue and siphon their notifications.
     */
    private static final String ALLOWED_SUBSCRIPTION = "/user/queue/notifications";

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor acc = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (acc == null) {
                    return message;
                }
                StompCommand cmd = acc.getCommand();
                if (StompCommand.CONNECT.equals(cmd)) {
                    // Reject the CONNECT outright when the token is missing/invalid,
                    // instead of letting an unauthenticated session linger.
                    String auth = firstHeader(acc, "Authorization");
                    Optional<UUID> userId = (StringUtils.hasText(auth)
                            && auth.regionMatches(true, 0, "Bearer ", 0, 7))
                            ? sessions.resolve(auth.substring(7).trim())
                            : Optional.empty();
                    if (userId.isEmpty()) {
                        throw new MessagingException("Unauthorized WebSocket connection");
                    }
                    acc.setUser(new StompPrincipal(userId.get().toString()));
                } else if (StompCommand.SUBSCRIBE.equals(cmd)) {
                    // Must be authenticated and may only subscribe to their own queue.
                    if (acc.getUser() == null || !ALLOWED_SUBSCRIPTION.equals(acc.getDestination())) {
                        throw new MessagingException("Subscription not allowed");
                    }
                }
                return message;
            }
        });
    }

    private static String firstHeader(StompHeaderAccessor acc, String name) {
        List<String> values = acc.getNativeHeader(name);
        return (values == null || values.isEmpty()) ? null : values.get(0);
    }

    private String[] parseAllowedOrigins() {
        return Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toArray(String[]::new);
    }

    /** Tiny Principal so Spring's user destination resolver can target this user. */
    record StompPrincipal(String name) implements Principal {
        @Override public String getName() { return name; }
    }
}
