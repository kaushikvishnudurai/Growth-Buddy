package com.growthbuddy.notification;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    List<Notification> findByUserIdOrderByCreatedAtDesc(UUID userId);

    long countByUserIdAndReadAtIsNull(UUID userId);

    List<Notification> findByRelatedId(UUID relatedId);

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
}
