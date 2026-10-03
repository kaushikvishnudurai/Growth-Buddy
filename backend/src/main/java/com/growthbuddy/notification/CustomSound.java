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
 * <p>Stored as the raw audio bytes plus their content type; the API still speaks
 * the data URL the browser keeps in CacheStorage and hands to {@code new Audio(...)},
 * built on the way out. It used to store that string itself, a third larger in
 * base64. Rows from then still carry it in {@code data_url}, and the first read
 * moves them over (see CustomSoundService.get); new rows leave it empty.
 *
 * <p>One row per user: the picker offers "Replace your sound", not a library,
 * and the unique key on {@code user_id} is what makes that true rather than
 * hopeful.
 *
 * <p>ponytail: the bytes live in the row — at most 300 kB, the ceiling
 * {@code chime.js} enforces, read once per login and never in a list query.
 * Object storage is the upgrade if a user ever gets more than one sound.
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

    /** Legacy: the whole data URL, from before {@link #audio}. Empty on every row written since. */
    @Column(name = "data_url", nullable = false, columnDefinition = "MEDIUMTEXT")
    private String dataUrl;

    /** {@code audio/<type>}, as the upload's data URL declared it. */
    @Column(name = "content_type", length = 64)
    private String contentType;

    @Column(name = "audio", columnDefinition = "MEDIUMBLOB")
    private byte[] audio;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
        if (updatedAt == null) updatedAt = Instant.now();
    }
}
