package com.growthbuddy.note;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NoteRepository extends JpaRepository<Note, UUID> {

    /* Pinned first, then most recently touched — the order the screen shows. */
    List<Note> findByUserIdAndDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc(UUID userId);

    Optional<Note> findByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);
}
