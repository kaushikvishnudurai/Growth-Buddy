package com.growthbuddy.family;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * "Something in your family changed — refetch it." A transient frame on the
 * existing per-user notifications queue, so two people shopping from the same
 * list see each other's ticks without a reload.
 *
 * <p>Deliberately NOT a {@code Notification} row: it carries no message, it
 * would flood the bell, and {@code notifications.kind} is a MySQL ENUM this
 * would have to widen. The client recognises {@code kind: "family_changed"}
 * and refreshes the Family screen instead of adding a bell card (app.js,
 * {@code connectWebSocket}).
 *
 * <p>Sent after commit, so the refetch it triggers can't read the old rows.
 * Best effort: a member who misses one sees the change on their next load.
 */
@Component
public class FamilyEvents {

    private static final Logger log = LoggerFactory.getLogger(FamilyEvents.class);
    static final String KIND = "family_changed";

    private final SimpMessagingTemplate broker;

    public FamilyEvents(SimpMessagingTemplate broker) {
        this.broker = broker;
    }

    /** Tell {@code recipients} that {@code section} (members / chores / shopping / pantry / plan / weekly / recipes) changed. */
    public void changed(Collection<UUID> recipients, String section) {
        if (recipients == null || recipients.isEmpty()) {
            return;
        }
        Runnable send = () -> {
            Map<String, Object> frame = Map.of("kind", KIND, "section", section, "transient", true);
            for (UUID id : recipients) {
                try {
                    broker.convertAndSendToUser(id.toString(), "/queue/notifications", frame);
                } catch (RuntimeException ex) {
                    log.debug("family_changed push to {} failed", id, ex);
                }
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
