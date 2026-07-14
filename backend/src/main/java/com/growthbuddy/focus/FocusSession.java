package com.growthbuddy.focus;

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

/** One completed focus (or break) session. Retention-capped per user, so the
 *  table can't grow without bound — see FocusService.prune. */
@Entity
@Table(name = "focus_sessions", indexes = @Index(name = "ix_focus_user_time", columnList = "user_id, completed_at"))
@Getter
@Setter
@NoArgsConstructor
public class FocusSession {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "mode", nullable = false, length = 16)
    private String mode; // "focus" | "break"

    @Column(name = "duration_sec", nullable = false)
    private int durationSec;

    @Column(name = "completed_at", nullable = false)
    private Instant completedAt;

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
        if (completedAt == null) completedAt = Instant.now();
    }
}
