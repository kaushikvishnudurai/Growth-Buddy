package com.growthbuddy.gcal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One row per user who connected their Google Calendar (read-only). */
@Entity
@Table(name = "google_calendar_links")
@Getter
@Setter
@NoArgsConstructor
public class GoogleCalendarLink {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    /** Google account email, shown in Settings so the user knows what's linked. */
    @Column(name = "google_email", length = 254)
    private String googleEmail;

    @Column(name = "refresh_token", nullable = false, length = 512)
    private String refreshToken;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
