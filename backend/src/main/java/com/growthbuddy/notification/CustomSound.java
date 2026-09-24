package com.growthbuddy.notification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * The notification sound a user brought themselves, so it follows the account
 * rather than living on whichever device they picked it on.
 *
 * <p>Stored as the data URL the browser already keeps in CacheStorage and hands
 * straight to {@code new Audio(...)} — the same string on both sides, so
 * neither end reassembles anything and there is no content-type to keep in
 * sync with the bytes.
 *
 * <p>One row per user: the picker offers "Replace your sound", not a library,
 * and the unique key on {@code user_id} is what makes that true rather than
 * hopeful.
 *
 * <p>ponytail: the bytes live in the row — about 400 kB of base64 at the 300 kB
 * ceiling {@code chime.js} enforces, read once per login and never in a list
 * query. Object storage is the upgrade if a user ever gets more than one sound.
 */
@Entity
// The constraint is named here, not left to `unique = true`: Hibernate invents
// a name like UKnjkb6kydonrf3uok3x6qkwbu1 for an anonymous one, so a dev
// database (ddl-auto: update) and prod (built from tableCreationQueries.sql)
// ended up with the same key under two different names.
@Table(name = "custom_sounds",
        uniqueConstraints = @UniqueConstraint(name = "uq_custom_sounds_user", columnNames = "user_id"))
@Getter
@Setter
@NoArgsConstructor
public class CustomSound {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** {@code data:audio/<type>;base64,…} — exactly what the client stores and plays. */
    @Column(name = "data_url", nullable = false, columnDefinition = "MEDIUMTEXT")
    private String dataUrl;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
        if (updatedAt == null) updatedAt = Instant.now();
    }
}
