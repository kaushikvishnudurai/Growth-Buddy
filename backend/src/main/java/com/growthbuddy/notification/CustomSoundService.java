package com.growthbuddy.notification;

import com.growthbuddy.common.ApiException;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * The account's own notification sounds: store them, hand them back, forget them.
 *
 * <p>The client keeps the files locally too — that copy is what actually plays,
 * so the sound still works offline and the picker stays instant. This is the
 * copy that lets a second device find them at all.
 */
@Service
public class CustomSoundService {

    /**
     * The same ceiling {@code chime.js} enforces on the picker
     * ({@code CUSTOM_MAX_BYTES}), applied again here because a client-side
     * limit is a courtesy and this is the trust boundary. Measured on the
     * decoded bytes, not the base64, so the two numbers mean the same thing.
     */
    static final int MAX_BYTES = 300 * 1024;

    /**
     * How many a user may keep: the one place to change it here. The client's
     * twin is {@code CUSTOM_MAX_COUNT} in scripts/chime.js, and
     * CustomSoundLimitsTest fails the build if the two differ.
     */
    static final int MAX_PER_USER = 5;

    /** The column's width. */
    static final int MAX_NAME = 60;

    /** What a row from before names existed is called. */
    static final String DEFAULT_NAME = "Your sound";

    /** What a browser's FileReader produces for an audio file, and nothing else. */
    private static final Pattern DATA_URL = Pattern.compile("^data:(audio/[A-Za-z0-9.+-]+);base64,(.+)$");

    /** An upload, decoded: what the row stores. */
    record Parsed(String contentType, byte[] bytes) {
    }

    private final CustomSoundRepository repo;

    public CustomSoundService(CustomSoundRepository repo) {
        this.repo = repo;
    }

    /** One entry of the list — no bytes. The timestamp is how a device knows whose copy is newer. */
    public record SoundInfo(UUID id, String name, String source, Instant updatedAt) {
    }

    /** One sound, bytes included, as the data URL the client stores. */
    public record StoredSound(UUID id, String name, String source, String dataUrl, Instant updatedAt) {
    }

    public List<SoundInfo> list(UUID userId) {
        return repo.summaries(userId).stream()
                .map(s -> new SoundInfo(s.getId(), displayName(s.getName()), s.getSource(), s.getUpdatedAt()))
                .toList();
    }

    @Transactional
    public StoredSound get(UUID userId, UUID id) {
        return repo.findByIdAndUserId(id, userId).map(this::toStored)
                .orElseThrow(() -> ApiException.notFound("that sound"));
    }

    /**
     * Save one under the id the client minted. The same id twice replaces, so a
     * retry never costs a slot; a new id past the cap is refused. An id that
     * belongs to someone else answers as if it didn't exist.
     */
    @Transactional
    public Instant put(UUID userId, UUID id, String name, String source, String dataUrl) {
        Parsed p = validate(dataUrl);
        // First, before any read: see lockOwner and countForUpdate.
        repo.lockOwner(userId.toString());
        CustomSound row = repo.findById(id).orElse(null);
        if (row != null && !row.getUserId().equals(userId)) {
            throw ApiException.notFound("that sound");
        }
        if (row == null) {
            if (repo.countForUpdate(userId.toString()) >= MAX_PER_USER) {
                throw ApiException.badRequest(
                        "You can keep " + MAX_PER_USER + " sounds of your own. Remove one to add another.");
            }
            row = new CustomSound();
            row.setId(id);
            row.setUserId(userId);
        }
        row.setSource(normalizeSource(source));
        return save(row, normalizeName(name), p);
    }

    /**
     * Change only the name. The bytes and updatedAt stay as they are: updatedAt
     * is how another device decides to re-download the audio, and the audio
     * didn't change — the new name reaches it through the list.
     */
    @Transactional
    public SoundInfo rename(UUID userId, UUID id, String name) {
        String clean = normalizeName(name);
        if (clean == null) {
            throw ApiException.badRequest("Give it a name.");
        }
        CustomSound row = repo.findByIdAndUserId(id, userId)
                .orElseThrow(() -> ApiException.notFound("that sound"));
        row.setName(clean);
        repo.save(row);
        return new SoundInfo(row.getId(), clean, row.getSource(), row.getUpdatedAt());
    }

    @Transactional
    public void delete(UUID userId, UUID id) {
        repo.deleteByIdAndUserId(id, userId);
    }

    /* ---- The one-sound API, for builds cached on phones from before the library.
       "The" sound is the oldest; these never touch the others. ---- */

    @Transactional
    public Optional<StoredSound> getFirst(UUID userId) {
        return repo.findFirstByUserIdOrderByUpdatedAtAscIdAsc(userId).map(this::toStored);
    }

    @Transactional
    public Instant putFirst(UUID userId, String dataUrl) {
        Parsed p = validate(dataUrl);
        CustomSound row = repo.findFirstByUserIdOrderByUpdatedAtAscIdAsc(userId).orElseGet(() -> {
            CustomSound s = new CustomSound();
            s.setUserId(userId);
            return s;
        });
        return save(row, row.getName(), p);
    }

    @Transactional
    public void deleteFirst(UUID userId) {
        repo.findFirstByUserIdOrderByUpdatedAtAscIdAsc(userId).ifPresent(repo::delete);
    }

    private Instant save(CustomSound row, String name, Parsed p) {
        row.setName(name);
        row.setContentType(p.contentType());
        row.setAudio(p.bytes());
        row.setDataUrl("");
        row.setUpdatedAt(Instant.now());
        return repo.save(row).getUpdatedAt();
    }

    /** Also moves a pre-bytes row over, once; updatedAt is left alone, since the sound is the same. */
    private StoredSound toStored(CustomSound s) {
        String name = displayName(s.getName());
        if (s.getAudio() == null) {
            String legacy = s.getDataUrl();
            try {
                Parsed p = validate(legacy);
                s.setContentType(p.contentType());
                s.setAudio(p.bytes());
                s.setDataUrl("");
            } catch (ApiException ignored) {
                // Stored under older rules (say, before the size cap): keep serving
                // it as it is rather than fail every login over a sound.
            }
            return new StoredSound(s.getId(), name, s.getSource(), legacy, s.getUpdatedAt());
        }
        return new StoredSound(s.getId(), name, s.getSource(), toDataUrl(s.getContentType(), s.getAudio()),
                s.getUpdatedAt());
    }

    static String toDataUrl(String contentType, byte[] bytes) {
        return "data:" + contentType + ";base64," + Base64.getEncoder().encodeToString(bytes);
    }

    private static String displayName(String stored) {
        return stored == null || stored.isBlank() ? DEFAULT_NAME : stored;
    }

    /** Only the two values the client sends; anything else is stored as unknown. */
    static String normalizeSource(String source) {
        return "recording".equals(source) || "file".equals(source) ? source : null;
    }

    /** Trimmed, control characters out, cut to the column. Blank is fine — it reads as {@link #DEFAULT_NAME}. */
    static String normalizeName(String name) {
        if (name == null) return null;
        String clean = name.replaceAll("\\p{Cntrl}", "").strip();
        if (clean.isEmpty()) return null;
        return clean.length() > MAX_NAME ? clean.substring(0, MAX_NAME).strip() : clean;
    }

    /**
     * Static and package-private so the rules can be tested without a Spring
     * context or a database — they are the whole of this class worth guarding.
     *
     * <p>Every refusal is an {@link ApiException}, which the global handler
     * turns into the 400 it is. A bare {@code IllegalArgumentException} would
     * fall through to the catch-all and reach the user as "Something went
     * wrong" with a 500, which is neither true nor actionable.
     */
    static Parsed validate(String dataUrl) {
        if (dataUrl == null || dataUrl.isBlank()) {
            throw ApiException.badRequest("No sound to save.");
        }
        Matcher m = DATA_URL.matcher(dataUrl);
        if (!m.matches()) {
            throw ApiException.badRequest("That isn’t an audio file — pick an mp3, m4a, ogg or wav.");
        }
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(m.group(2));
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("That file didn’t upload cleanly. Try picking it again.");
        }
        if (bytes.length > MAX_BYTES) {
            throw ApiException.badRequest(
                    "Keep it under " + (MAX_BYTES / 1024) + " KB — a notification is a second or two, not a track.");
        }
        return new Parsed(m.group(1), bytes);
    }
}
