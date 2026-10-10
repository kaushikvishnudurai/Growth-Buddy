package com.growthbuddy.notification;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface CustomSoundRepository extends JpaRepository<CustomSound, UUID> {

    /** The list without the bytes: a device fetches only the files it doesn't already hold. */
    interface Summary {
        UUID getId();

        String getName();

        String getSource();

        Instant getUpdatedAt();
    }

    @Query("select s.id as id, s.name as name, s.source as source, s.updatedAt as updatedAt from CustomSound s"
            + " where s.userId = :userId order by s.updatedAt, s.id")
    List<Summary> summaries(@Param("userId") UUID userId);

    /**
     * Holds the owner's users row (SELECT ... FOR UPDATE) until the transaction
     * ends, so two uploads at once take turns at the count instead of both
     * seeing three and landing a fifth. The users row rather than these rows:
     * with none stored there is nothing here to lock, and TiDB takes no gap
     * locks to cover the insert.
     */
    @Query(value = "SELECT id FROM users WHERE id = :userId FOR UPDATE", nativeQuery = true)
    List<String> lockOwner(@Param("userId") String userId);

    /**
     * The count, as a locking read. It has to be one: a plain SELECT reads the
     * transaction's snapshot (MySQL takes it at the first read, TiDB at the
     * start), so after waiting on lockOwner it still saw the rows from before
     * the wait — eight simultaneous uploads all counted under four and all
     * landed. A locking read sees what is committed now.
     */
    @Query(value = "SELECT COUNT(*) FROM custom_sounds WHERE user_id = :userId FOR UPDATE", nativeQuery = true)
    long countForUpdate(@Param("userId") String userId);

    Optional<CustomSound> findByIdAndUserId(UUID id, UUID userId);

    /** The oldest one — what the pre-library endpoints, still called by cached builds, mean by "the" sound. */
    Optional<CustomSound> findFirstByUserIdOrderByUpdatedAtAscIdAsc(UUID userId);

    void deleteByIdAndUserId(UUID id, UUID userId);
}
