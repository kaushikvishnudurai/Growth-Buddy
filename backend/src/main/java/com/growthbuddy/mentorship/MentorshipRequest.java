package com.growthbuddy.mentorship;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "mentorship_requests")
@Getter
@Setter
@NoArgsConstructor
public class MentorshipRequest {

    public enum Direction { offer, request }
    public enum Status { pending, accepted, rejected, cancelled }

    @Id
    private UUID id;

    @Column(name = "from_user_id", nullable = false)
    private UUID fromUserId;

    @Column(name = "to_user_id", nullable = false)
    private UUID toUserId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Direction direction;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Status status = Status.pending;

    @Column(length = 500)
    private String note;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "responded_at")
    private Instant respondedAt;

    /**
     * Last time the MENTOR opened this mentee's progress. Drives the "checked
     * today" tick on the Circle screen; only ever set on the mentor's side of a
     * pair, so the mentee's own row stays null.
     *
     * <p>An instant, not a date, on purpose: "today" is the reader's local day
     * and the server has no idea what timezone they're in. The client compares.
     */
    @Column(name = "checked_at")
    private Instant checkedAt;

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
    }
}
