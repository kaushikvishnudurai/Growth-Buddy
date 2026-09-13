package com.growthbuddy.note;

import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

/**
 * Create body. Everything is optional: the composer saves the moment you stop
 * typing, and an untitled scrap is the most common note there is.
 */
record CreateNoteRequest(
        @Size(max = 200) String title,
        String body,
        @Size(max = 16) String color,
        Boolean pinned) {
}

/** Update body. Null fields are left unchanged. */
record UpdateNoteRequest(
        @Size(max = 200) String title,
        String body,
        @Size(max = 16) String color,
        Boolean pinned) {
}

record NoteResponse(
        UUID id,
        String title,
        String body,
        String color,
        boolean pinned,
        Instant createdAt,
        Instant updatedAt) {

    static NoteResponse from(Note n) {
        return new NoteResponse(n.getId(), n.getTitle(), n.getBody(), n.getColor(),
                n.isPinned(), n.getCreatedAt(), n.getUpdatedAt());
    }
}
