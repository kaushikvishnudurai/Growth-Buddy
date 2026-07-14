package com.growthbuddy.notification;

import com.growthbuddy.common.ApiException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationService {

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

    @Transactional
    public void markAllRead(UUID userId) {
        Instant now = Instant.now();
        for (Notification n : repo.findByUserIdOrderByCreatedAtDesc(userId)) {
            if (n.getReadAt() == null) {
                n.setReadAt(now);
                repo.save(n);
            }
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
