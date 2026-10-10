package com.growthbuddy.mentorship;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One line in a mentor ↔ mentee thread. The thread belongs to the LINK (the
 * accepted {@link MentorshipRequest}), not to the pair: the two directions are
 * independent links, and each gets its own conversation.
 *
 * <p>{@code kind} is {@code message}, or {@code cheer} / {@code nudge} — a
 * nudge is stored here too, so it shows in the thread and the daily cap
 * ({@link MentorshipChatService#DAILY_NUDGES}) is a count of these rows rather
 * than of bell notifications the recipient can clear.
 */
@Entity
@Table(name = "mentorship_messages", indexes = {
        @Index(name = "ix_mm_link_time", columnList = "link_id, created_at")
})
@Getter
@Setter
@NoArgsConstructor
public class MentorshipMessage {

    @Id
    private UUID id;

    @Column(name = "link_id", nullable = false)
    private UUID linkId;

    @Column(name = "sender_id", nullable = false)
    private UUID senderId;

    @Column(nullable = false, length = 8)
    private String kind = "message";

    /** Up to 2,000 characters; null for a cheer or nudge sent without text. */
    @Column(length = 2000)
    private String body;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
