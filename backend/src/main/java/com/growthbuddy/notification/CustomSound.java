package com.growthbuddy.notification;

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
 * A notification sound a user brought themselves — an uploaded file or a voice
 * recording made in the picker — so it follows the account
 * rather than living on whichever device they picked it on.
 *
 * <p>Stored as the raw audio bytes plus their content type; the API still speaks
 * the data URL the browser keeps in CacheStorage and hands to {@code new Audio(...)},
 * built on the way out. It used to store that string itself, a third larger in
 * base64. Rows from then still carry it in {@code data_url}, and the first read
 * moves them over (see CustomSoundService.toStored); new rows leave it empty.
 *
 * <p>Up to {@link CustomSoundService#MAX_PER_USER} rows per user. The id is
 * minted by the client, so a retried save lands on the same row instead of
 * filling a slot twice, and the client keys a reminder's tone off it.
 *
 * <p>ponytail: the bytes live in the row — at most 300 kB each, the ceiling
 * {@code chime.js} enforces, so 1.2 MB a user at most, and the list query never
 * selects them (see CustomSoundRepository.Summary). Object storage is the
 * upgrade if the cap ever grows much past four.
 */
@Entity
// Named here, not left to Hibernate: an anonymous index gets a name like
// IDXnjkb6kydonrf3uok3x6qkwbu1, so a dev database (ddl-auto: update) and prod
// (built from tableCreationQueries.sql) would carry the same key under two names.
@Table(name = "custom_sounds", indexes = @Index(name = "idx_custom_sounds_user", columnList = "user_id"))
@Getter
@Setter
@NoArgsConstructor
public class CustomSound {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** What the picker shows: the file's name, or "Recording 2". */
    @Column(name = "name", length = 60)
    private String name;

    /**
     * {@code recording} (made with the picker's recorder) or {@code file}
     * (uploaded); null on rows from before it was kept. Stored rather than
     * guessed from the name, because the name can be changed.
     */
    @Column(name = "source", length = 16)
    private String source;

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
