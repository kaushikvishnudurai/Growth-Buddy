package com.growthbuddy.note;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NoteRepository extends JpaRepository<Note, UUID> {

    /* The main list: not deleted, not archived. Pinned first, then most
       recently touched — the order the screen shows. */
    List<Note> findByUserIdAndDeletedAtIsNullAndArchivedAtIsNullOrderByPinnedDescUpdatedAtDesc(UUID userId);

    /* The Archived view: most recently archived first. */
    List<Note> findByUserIdAndDeletedAtIsNullAndArchivedAtIsNotNullOrderByArchivedAtDesc(UUID userId);

    long countByUserIdAndDeletedAtIsNullAndArchivedAtIsNotNull(UUID userId);

    /* The Trash view: deleted after the cutoff (NoteService.trashCutoff). */
    List<Note> findByUserIdAndDeletedAtAfterOrderByDeletedAtDesc(UUID userId, Instant cutoff);

    long countByUserIdAndDeletedAtAfter(UUID userId, Instant cutoff);

    Optional<Note> findByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);

    /** Deleted or not — what restore and delete-forever need. */
    Optional<Note> findByIdAndUserId(UUID id, UUID userId);

    /** The nightly purge: notes in the trash longer than its 30 days. Returns rows removed. */
    @Modifying
    @Query("delete from Note n where n.deletedAt is not null and n.deletedAt < :cutoff")
    int purgeDeletedBefore(@Param("cutoff") Instant cutoff);
}
