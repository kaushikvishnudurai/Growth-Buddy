package com.growthbuddy.note;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * "A note draft changed in another session." After a draft autosave or discard,
 * the writer's other open sessions get a transient {@code note_draft} frame on
 * the per-user notifications queue, so a half-written note shows up there as a
 * draft while it is still being typed (notes.js {@code onRemoteDraft}).
 *
 * <p>Not {@code data_changed}: that one reloads every screen, and drafts are
 * excluded from it because two open devices reloading each other's autosaves
 * never stopped. This frame reloads nothing. It names WHICH draft moved
 * ({@code note}: {@code "composer"} or the note's id) and never carries its
 * text: the other session reads the draft through the ordinary authenticated
 * GET, so the socket never holds note content.
 *
 * <p>{@code origin} echoes the writer's {@code X-GB-Client} (one per page load),
 * so the session typing doesn't react to its own autosave. {@code device} is the
 * writer's {@code X-GB-Device} label when it sent one ("Growth Buddy on
 * SM-S918B"), for "Draft from …". Best effort: a missed frame is caught up when
 * the screen or the note is next opened.
 */
@Component
public class NoteDraftEvents {

    private static final Logger log = LoggerFactory.getLogger(NoteDraftEvents.class);
    static final String KIND = "note_draft";
    static final String COMPOSER = "composer";
    private static final Pattern CLIENT_ID = Pattern.compile("[A-Za-z0-9-]{1,64}");
    private static final int DEVICE_MAX = 80;

    private final SimpMessagingTemplate broker;

    public NoteDraftEvents(SimpMessagingTemplate broker) {
        this.broker = broker;
    }

    /** {@code noteId} null = the composer's new-note draft. */
    public void changed(UUID userId, UUID noteId, String origin, String device) {
        try {
            broker.convertAndSendToUser(userId.toString(), "/queue/notifications", frame(noteId, origin, device));
        } catch (RuntimeException e) {
            log.debug("note_draft push to {} failed", userId, e);
        }
    }

    static Map<String, Object> frame(UUID noteId, String origin, String device) {
        Map<String, Object> f = new HashMap<>();
        f.put("kind", KIND);
        f.put("transient", true);
        f.put("note", noteId == null ? COMPOSER : noteId.toString());
        if (origin != null && CLIENT_ID.matcher(origin).matches()) f.put("origin", origin);
        if (device != null && !device.isBlank()) {
            String d = device.strip();
            f.put("device", d.length() > DEVICE_MAX ? d.substring(0, DEVICE_MAX) : d);
        }
        return f;
    }
}
