package com.growthbuddy.note;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Unsaved edits to an existing note, one row per note. The composer's
 * {@link NoteDraft} only ever covered a NEW note; an edit lived in the open
 * sheet alone, so a reload, a killed app or a dead battery lost it. Save (any
 * PATCH that writes the note) and deleting the note both drop this row.
 */
@Entity
@Table(name = "note_edit_drafts")
@Getter
@Setter
@NoArgsConstructor
public class NoteEditDraft {

    @Id
    @Column(name = "note_id")
    private UUID noteId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(length = 200)
    private String title;

    /** Same HTML as {@link Note#getBody()}, photos included; sanitised where rendered. */
    @Column(columnDefinition = "MEDIUMTEXT")
    private String body;

    @Column(length = 16)
    private String color;

    /**
     * The sheet's label chips, comma-joined like {@link Note#getLabels()} (through
     * {@link NoteLabels}). Null on a row from before labels were drafted: the
     * restore then leaves the note's own labels alone.
     */
    @Column(length = 500)
    private String labels;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
