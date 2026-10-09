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
 * The Notes composer's unsaved note, one per user. Kept on the server so a
 * half-written note survives leaving the screen, a reload and a change of
 * device. Not a {@link Note}: it never shows in the list, search or counts,
 * and Save turns it into a real note and deletes this row.
 */
@Entity
@Table(name = "note_drafts")
@Getter
@Setter
@NoArgsConstructor
public class NoteDraft {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(length = 200)
    private String title;

    /** Same HTML as {@link Note#getBody()}, photos included; sanitised where rendered. */
    @Column(columnDefinition = "MEDIUMTEXT")
    private String body;

    @Column(length = 16)
    private String color;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
