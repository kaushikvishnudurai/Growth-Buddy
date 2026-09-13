package com.growthbuddy.note;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A jotting. Deliberately not a task: no due date, no done flag, and nothing
 * here touches the daily score — a note you never act on is still a note that
 * did its job.
 */
@Entity
@Table(name = "notes", indexes = {
        @Index(name = "ix_notes_user_pinned", columnList = "user_id, pinned, updated_at")
})
@Getter
@Setter
@NoArgsConstructor
public class Note {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(length = 200)
    private String title;

    /**
     * Rich text as HTML, from the editor on the Notes screen.
     *
     * <p>Stored as given and sanitised where it is rendered — see {@code sanitize()}
     * in scripts/notes.js, which rebuilds the fragment from an allow-list of tags
     * and attributes. That is the boundary that matters: a note is only ever
     * painted by its own author's browser, and the allow-list walk is a real
     * parser rather than the regex this would have to be in Java.
     */
    @Column(columnDefinition = "MEDIUMTEXT")
    private String body;

    /** Swatch key from the shared palette (the habit colour picker's), or null. */
    @Column(length = 16)
    private String color;

    @Column(nullable = false)
    private boolean pinned = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
