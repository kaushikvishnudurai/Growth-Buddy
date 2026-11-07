package com.growthbuddy.note;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NoteEditDraftRepository extends JpaRepository<NoteEditDraft, UUID> {

    Optional<NoteEditDraft> findByNoteIdAndUserId(UUID noteId, UUID userId);

    /** Which notes have a draft, without reading the bodies (MEDIUMTEXT, photos and all). */
    @Query("select new com.growthbuddy.note.NoteEditDraftMark(d.noteId, d.updatedAt) "
            + "from NoteEditDraft d where d.userId = :userId")
    List<NoteEditDraftMark> marksFor(@Param("userId") UUID userId);

    /* Explicit rather than the FK's ON DELETE CASCADE: TiDB only enforces
       foreign keys from v6.6 (same reason as DataCleanupJob's signup purge). */
    @Modifying
    @Query("delete from NoteEditDraft d where d.noteId in "
            + "(select n.id from Note n where n.deletedAt is not null and n.deletedAt < :cutoff)")
    int purgeForNotesDeletedBefore(@Param("cutoff") Instant cutoff);
}
