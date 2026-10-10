package com.growthbuddy.notification;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    List<Notification> findByUserIdOrderByCreatedAtDesc(UUID userId);

    long countByUserIdAndReadAtIsNull(UUID userId);

    List<Notification> findByRelatedId(UUID relatedId);

    /** The newest card of one kind since {@code after} — "which reminder did SNOOZE mean?" */
    java.util.Optional<Notification> findFirstByUserIdAndKindAndCreatedAtAfterOrderByCreatedAtDesc(
            UUID userId, NotificationKind kind, Instant after);

    /* Bulk deletes, one statement each — the row-at-a-time loops these replace
       issued a DELETE per notification. */

    @Modifying
    @Query("delete from Notification n where n.userId = :userId")
    int deleteAllForUser(@Param("userId") UUID userId);

    @Modifying
    @Query("delete from Notification n where n.readAt is not null and n.readAt < :cutoff")
    int deleteReadBefore(@Param("cutoff") Instant cutoff);

    @Modifying
    @Query("delete from Notification n where n.createdAt < :cutoff")
    int deleteCreatedBefore(@Param("cutoff") Instant cutoff);

    /* Per-user retention (ui_prefs.notifyKeepReadDays, see NotificationPrefs). */

    @Modifying
    @Query("delete from Notification n where n.readAt is not null and n.readAt < :cutoff "
            + "and n.userId in :userIds")
    int deleteReadBeforeForUsers(@Param("cutoff") Instant cutoff, @Param("userIds") Collection<UUID> userIds);

    @Modifying
    @Query("delete from Notification n where n.readAt is not null and n.readAt < :cutoff "
            + "and n.userId not in :userIds")
    int deleteReadBeforeExcept(@Param("cutoff") Instant cutoff, @Param("userIds") Collection<UUID> userIds);

    /* The bell's own bulk actions — always scoped to the caller. */

    @Modifying
    @Query("update Notification n set n.readAt = :now where n.userId = :userId and n.readAt is null")
    int markAllReadForUser(@Param("userId") UUID userId, @Param("now") Instant now);

    @Modifying
    @Query("delete from Notification n where n.userId = :userId and n.readAt is not null")
    int deleteReadForUser(@Param("userId") UUID userId);

    /* Pages for "Load older". `<=` on purpose: created_at is a second-precision
       TIMESTAMP, so a strict `<` cursor skipped every row sharing the boundary
       second. The client drops the repeats by id. */

    @Query("select n from Notification n where n.userId = :userId and n.createdAt <= :before "
            + "order by n.createdAt desc")
    List<Notification> findPage(@Param("userId") UUID userId, @Param("before") Instant before, Pageable page);

    /** A category whose pre-column rows (NULL category) are told by their kind. */
    @Query("select n from Notification n where n.userId = :userId and n.createdAt <= :before "
            + "and (n.category = :category or (n.category is null and n.kind in :legacyKinds)) "
            + "order by n.createdAt desc")
    List<Notification> findPageInCategory(@Param("userId") UUID userId, @Param("before") Instant before,
            @Param("category") NotifyCategory category,
            @Param("legacyKinds") Collection<NotificationKind> legacyKinds, Pageable page);

    /** A category no kind implies (money): only rows stamped with it. */
    @Query("select n from Notification n where n.userId = :userId and n.createdAt <= :before "
            + "and n.category = :category order by n.createdAt desc")
    List<Notification> findPageStampedCategory(@Param("userId") UUID userId, @Param("before") Instant before,
            @Param("category") NotifyCategory category, Pageable page);
}
