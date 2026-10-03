package com.growthbuddy.notification;

import com.growthbuddy.common.ApiException;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * The account's own notification sound: store it, hand it back, forget it.
 *
 * <p>The client keeps the file locally too — that copy is what actually plays,
 * so the sound still works offline and the picker stays instant. This is the
 * copy that lets a second device find it at all.
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

    /** What a browser's FileReader produces for an audio file, and nothing else. */
    private static final Pattern DATA_URL = Pattern.compile("^data:(audio/[A-Za-z0-9.+-]+);base64,(.+)$");

    /** An upload, decoded: what the row stores. */
    record Parsed(String contentType, byte[] bytes) {
    }

    private final CustomSoundRepository repo;

    public CustomSoundService(CustomSoundRepository repo) {
        this.repo = repo;
    }

    /** What the client stored, and when — the timestamp is how a device knows whose copy is newer. */
    public record StoredSound(String dataUrl, Instant updatedAt) {
    }

    /** Also moves a pre-bytes row over, once; updatedAt is left alone, since the sound is the same. */
    @Transactional
    public Optional<StoredSound> get(UUID userId) {
        return repo.findByUserId(userId).map(s -> {
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
                return new StoredSound(legacy, s.getUpdatedAt());
            }
            return new StoredSound(toDataUrl(s.getContentType(), s.getAudio()), s.getUpdatedAt());
        });
    }

    static String toDataUrl(String contentType, byte[] bytes) {
        return "data:" + contentType + ";base64," + Base64.getEncoder().encodeToString(bytes);
    }

    /** Replace whatever this account had. Returns the moment it landed. */
    @Transactional
    public Instant put(UUID userId, String dataUrl) {
        Parsed p = validate(dataUrl);
        CustomSound row = repo.findByUserId(userId).orElseGet(CustomSound::new);
        row.setUserId(userId);
        row.setContentType(p.contentType());
        row.setAudio(p.bytes());
        row.setDataUrl("");
        row.setUpdatedAt(Instant.now());
        return repo.save(row).getUpdatedAt();
    }

    @Transactional
    public void delete(UUID userId) {
        repo.deleteByUserId(userId);
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
