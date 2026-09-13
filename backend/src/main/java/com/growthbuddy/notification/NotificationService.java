package com.growthbuddy.notification;

import com.growthbuddy.common.ApiException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    static final int READ_TTL_DAYS = 30;
    static final int ANY_TTL_DAYS = 90;

    private final NotificationRepository repo;
    private final SimpMessagingTemplate broker;

    public NotificationService(NotificationRepository repo, SimpMessagingTemplate broker) {
        this.repo = repo;
        this.broker = broker;
    }

    public record NotificationDto(
            UUID id, NotificationKind kind, String title, String body,
            UUID relatedId, Instant readAt, Instant createdAt) {

        static NotificationDto from(Notification n) {
            return new NotificationDto(n.getId(), n.getKind(), n.getTitle(), n.getBody(),
                    n.getRelatedId(), n.getReadAt(), n.getCreatedAt());
        }
    }

    @Transactional(readOnly = true)
    public List<NotificationDto> list(UUID userId) {
        return repo.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(NotificationDto::from).toList();
    }

    @Transactional(readOnly = true)
    public long unreadCount(UUID userId) {
        return repo.countByUserIdAndReadAtIsNull(userId);
    }

    @Transactional
    public Notification publish(UUID userId, NotificationKind kind, String title, String body, UUID relatedId) {
        Notification n = new Notification();
        n.setUserId(userId);
        n.setKind(kind);
        n.setTitle(title);
        n.setBody(body);
        n.setRelatedId(relatedId);
        Notification saved = repo.save(n);
        // Realtime push: subscribed clients on /user/queue/notifications get this.
        broker.convertAndSendToUser(userId.toString(), "/queue/notifications", NotificationDto.from(saved));
        return saved;
    }

    @Transactional
    public NotificationDto markRead(UUID userId, UUID id) {
        Notification n = repo.findById(id).orElseThrow(() -> ApiException.notFound("Notification"));
        if (!n.getUserId().equals(userId)) {
            throw ApiException.notFound("Notification");
        }
        if (n.getReadAt() == null) {
            n.setReadAt(Instant.now());
            repo.save(n);
        }
        return NotificationDto.from(n);
    }

    /**
     * "Clear all": the user is done with the list, so the rows go.
     *
     * <p>It used to stamp readAt and keep every row, which meant the table only
     * ever grew — a daily digest alone is 365 rows a year per user that nobody
     * will ever read again. A notification is a nudge with a lifetime, not a
     * record: acting on it is the end of it.
     */
    @Transactional
    public void clearAll(UUID userId) {
        repo.deleteAllForUser(userId);
    }

    /**
     * Retention sweep for the ones nobody clears by hand — read notifications
     * after {@value #READ_TTL_DAYS} days, and anything at all after
     * {@value #ANY_TTL_DAYS}, because an unread nudge from three months ago is
     * not a nudge any more.
     *
     * <p>ponytail: fixed windows, no per-user setting. Deletes in two statements
     * rather than loading rows to delete them one by one.
     */
    @Scheduled(cron = "0 20 3 * * *")
    @Transactional
    public void sweepOldNotifications() {
        Instant now = Instant.now();
        int read = repo.deleteReadBefore(now.minus(READ_TTL_DAYS, ChronoUnit.DAYS));
        int old = repo.deleteCreatedBefore(now.minus(ANY_TTL_DAYS, ChronoUnit.DAYS));
        if (read + old > 0) {
            log.info("Notification sweep removed {} read and {} expired rows", read, old);
        }
    }

    @Transactional
    public void delete(UUID userId, UUID id) {
        repo.findById(id).ifPresent(n -> {
            if (n.getUserId().equals(userId)) repo.delete(n);
        });
    }

    /**
     * Used by services that resolve a workflow (e.g. accepting a mentorship
     * invite): drops every notification tied to that domain row so the bell
     * doesn't keep stale "request pending" cards around.
     */
    @Transactional
    public void deleteByRelated(UUID relatedId) {
        for (Notification n : repo.findByRelatedId(relatedId)) {
            repo.delete(n);
        }
    }
}
