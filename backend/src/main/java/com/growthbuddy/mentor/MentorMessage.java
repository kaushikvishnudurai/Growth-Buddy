package com.growthbuddy.mentor;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "mentor_messages", indexes = {
        @Index(name = "ix_mentor_msg_thread_time", columnList = "thread_id, created_at")
})
@Getter
@Setter
@NoArgsConstructor
public class MentorMessage {

    @Id
    private UUID id;

    @Column(name = "thread_id", nullable = false)
    private UUID threadId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private MessageRole role;

    @Column(nullable = false, columnDefinition = "MEDIUMTEXT")
    private String content;

    /**
     * A canned reply (AI not configured, unreachable, or empty), not the model's
     * words. Kept so the chat reads back as it happened, but never replayed into
     * the model's history: it would learn to answer "I'm having trouble reaching
     * my brain" from its own past turns.
     */
    @Column(nullable = false)
    private boolean fallback;

    /**
     * The one-tap actions the model offered with this reply, as a JSON array
     * ({@link MentorActions#toJson}); null for none. The fenced block they came
     * in is already gone from {@link #content}.
     */
    @Column(name = "actions_json", columnDefinition = "TEXT")
    private String actionsJson;

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
