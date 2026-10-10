package com.growthbuddy.notification;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    /** Read cards, unless the user picked another window (NotificationPrefs.keepReadDays). */
    static final int READ_TTL_DAYS = NotificationPrefs.DEFAULT_KEEP_READ_DAYS;
    /** Anything at all, read or not, whatever the user picked. */
    public static final int ANY_TTL_DAYS = 90;
    /** The most one "Load older" page may ask for. */
    static final int PAGE_MAX = 100;
    /** Each IN (...) of the retention sweep. */
    private static final int ID_CHUNK = 500;

    private final NotificationRepository repo;
    private final SimpMessagingTemplate broker;
    private final UserRepository users;

    public NotificationService(NotificationRepository repo, SimpMessagingTemplate broker, UserRepository users) {
        this.repo = repo;
        this.broker = broker;
        this.users = users;
    }

    public record NotificationDto(
            UUID id, NotificationKind kind, String title, String body,
            UUID relatedId, Instant readAt, Instant createdAt, NotifyCategory category) {

        static NotificationDto from(Notification n) {
            return new NotificationDto(n.getId(), n.getKind(), n.getTitle(), n.getBody(),
                    n.getRelatedId(), n.getReadAt(), n.getCreatedAt(), n.effectiveCategory());
        }
    }

    @Transactional(readOnly = true)
    public List<NotificationDto> list(UUID userId) {
        return repo.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(NotificationDto::from).toList();
    }

    /**
     * One page of the bell, newest first, at or before {@code before} (null =
     * now); {@code category} null = every category. The boundary row comes back
     * again on the next page (see NotificationRepository.findPage) and the
     * client drops it by id.
     */
    @Transactional(readOnly = true)
    public List<NotificationDto> page(UUID userId, Instant before, int limit, NotifyCategory category) {
        Instant at = before != null ? before : Instant.now();
        PageRequest page = PageRequest.of(0, Math.max(1, Math.min(PAGE_MAX, limit)));
        List<Notification> rows;
        if (category == null) {
            rows = repo.findPage(userId, at, page);
        } else if (category.legacyKinds().isEmpty()) {
            rows = repo.findPageStampedCategory(userId, at, category, page);
        } else {
            rows = repo.findPageInCategory(userId, at, category, category.legacyKinds(), page);
        }
        return rows.stream().map(NotificationDto::from).toList();
    }

    @Transactional(readOnly = true)
    public long unreadCount(UUID userId) {
        return repo.countByUserIdAndReadAtIsNull(userId);
    }

    @Transactional
    public Notification publish(UUID userId, NotificationKind kind, String title, String body, UUID relatedId) {
        return publish(userId, kind, NotifyCategory.of(kind), title, body, relatedId);
    }

    /**
     * The same, saying what it is about when the kind can't: a family or
     * mentorship-chat card is {@code system} kind but {@link NotifyCategory#people}.
     * Always recorded, muted or not — the mute is for push (PushService).
     */
    @Transactional
    public Notification publish(UUID userId, NotificationKind kind, NotifyCategory category,
                                String title, String body, UUID relatedId) {
        Notification n = new Notification();
        n.setUserId(userId);
        n.setKind(kind);
        n.setCategory(category != null ? category : NotifyCategory.of(kind));
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

    /** "Mark all read": the caller's unread cards only. Returns how many changed. */
    @Transactional
    public int markAllRead(UUID userId) {
        return repo.markAllReadForUser(userId, Instant.now());
    }

    /** "Clear read": the caller's read cards go; unread ones stay. */
    @Transactional
    public int clearRead(UUID userId) {
        return repo.deleteReadForUser(userId);
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
     * after the user's own window (Settings → Alerts, {@code ui_prefs.notifyKeepReadDays}:
     * 7 / 30 / 90, default {@value #READ_TTL_DAYS}), and anything at all after
     * {@value #ANY_TTL_DAYS}, because an unread nudge from three months ago is
     * not a nudge any more.
     *
     * <p>Bulk statements, never row by row: one for everyone on the default
     * (less those who keep longer), one per shorter window for the users who
     * picked it, and the 90-day cap. ponytail: the users who keep longer ride in
     * a NOT IN — fine while they're a handful; past that, invert to per-window IN lists.
     */
    @Scheduled(cron = "0 20 3 * * *")
    @Transactional
    public void sweepOldNotifications() {
        sweep(Instant.now());
    }

    /** {@link #sweepOldNotifications()} at a given instant — what the tests drive. */
    int sweep(Instant now) {
        Map<Integer, List<UUID>> byDays = new HashMap<>();
        for (Object[] row : users.findIdsWithUiPrefs()) {
            @SuppressWarnings("unchecked")
            Map<String, Object> prefs = row[1] instanceof Map<?, ?> m ? (Map<String, Object>) m : null;
            int days = NotificationPrefs.keepReadDays(prefs);
            if (days != READ_TTL_DAYS) byDays.computeIfAbsent(days, d -> new ArrayList<>()).add((UUID) row[0]);
        }
        List<UUID> keepLonger = new ArrayList<>();
        byDays.forEach((days, ids) -> {
            if (days > READ_TTL_DAYS) keepLonger.addAll(ids);
        });

        Instant defaultCutoff = now.minus(READ_TTL_DAYS, ChronoUnit.DAYS);
        int read = keepLonger.isEmpty()
                ? repo.deleteReadBefore(defaultCutoff)
                : repo.deleteReadBeforeExcept(defaultCutoff, keepLonger);
        for (Map.Entry<Integer, List<UUID>> e : byDays.entrySet()) {
            int days = e.getKey();
            if (days >= ANY_TTL_DAYS) continue; // the cap below already covers it
            Instant cutoff = now.minus(days, ChronoUnit.DAYS);
            List<UUID> ids = e.getValue();
            for (int i = 0; i < ids.size(); i += ID_CHUNK) {
                read += repo.deleteReadBeforeForUsers(cutoff, ids.subList(i, Math.min(ids.size(), i + ID_CHUNK)));
            }
        }
        int old = repo.deleteCreatedBefore(now.minus(ANY_TTL_DAYS, ChronoUnit.DAYS));
        if (read + old > 0) {
            log.info("Notification sweep removed {} read and {} expired rows", read, old);
        }
        return read + old;
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
