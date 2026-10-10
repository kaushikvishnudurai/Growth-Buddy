package com.growthbuddy.mentorship;

import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * "A line landed in your mentorship thread" — a transient frame on the per-user
 * notifications queue, the same pattern as {@code FamilyEvents}. It carries the
 * message itself, so an open chat sheet appends it without a refetch.
 *
 * <p>Not a {@code Notification} row (the bell card is published separately, and
 * {@code notifications.kind} is a MySQL ENUM). app.js recognises
 * {@code kind: "mentorship_message"} and re-dispatches it as
 * {@code gb:mentorship-message} instead of adding a bell card.
 *
 * <p>Sent after commit; best effort — the thread's GET is the source of truth.
 */
@Component
public class MentorshipEvents {

    private static final Logger log = LoggerFactory.getLogger(MentorshipEvents.class);
    static final String KIND = "mentorship_message";

    private final SimpMessagingTemplate broker;

    public MentorshipEvents(SimpMessagingTemplate broker) {
        this.broker = broker;
    }

    public void message(UUID recipient, MentorshipChatService.MessageDto message) {
        Runnable send = () -> {
            Map<String, Object> frame = Map.of("kind", KIND, "transient", true,
                    "linkId", message.linkId(), "message", message);
            try {
                broker.convertAndSendToUser(recipient.toString(), "/queue/notifications", frame);
            } catch (RuntimeException ex) {
                log.debug("mentorship_message push to {} failed", recipient, ex);
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    send.run();
                }
            });
        } else {
            send.run();
        }
    }
}
