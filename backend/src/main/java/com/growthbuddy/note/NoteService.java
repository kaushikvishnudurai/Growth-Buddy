package com.growthbuddy.note;

import com.growthbuddy.common.ApiException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NoteService {

    /**
     * Ceiling on a single note's HTML. Text alone is a few KB; photos are
     * embedded as data URLs (scripts/notes.js shrinks each to ~200 KB), so this
     * holds about eight. NOTE_MAX there sits just under it and refuses the
     * photo that would not fit before Save runs. Well under TiDB's 6 MB row limit.
     *
     * <p>ponytail: photos live inside the body. list() sends the phone a cover
     * thumbnail instead of them, but still reads every full body from the
     * database to cut them out. Fine for a few dozen photo notes; if heap or
     * query time says otherwise, move photos to their own table.
     */
    private static final int MAX_BODY = 2_000_000;

    /** A cover is a 640x320 JPEG, 25-50 KB of base64; this fits the TEXT column. */
    static final int MAX_COVER = 60_000;

    private final NoteRepository repo;

    public NoteService(NoteRepository repo) {
        this.repo = repo;
    }

    @Transactional(readOnly = true)
    public List<NoteResponse> list(UUID userId) {
        return repo.findByUserIdAndDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc(userId).stream()
                .map(NoteResponse::listItem)
                .toList();
    }

    /** The whole note, photos included — what the editor opens. */
    @Transactional(readOnly = true)
    public NoteResponse get(UUID userId, UUID id) {
        return NoteResponse.from(require(userId, id));
    }

    @Transactional
    public NoteResponse create(UUID userId, CreateNoteRequest req) {
        Note n = new Note();
        n.setUserId(userId);
        n.setTitle(trimToNull(req.title()));
        n.setBody(checkedBody(req.body()));
        n.setColor(trimToNull(req.color()));
        n.setPinned(Boolean.TRUE.equals(req.pinned()));
        n.setCover(checkedCover(req.cover()));
        // Trimmed like the list: the client already has the body it just sent.
        return NoteResponse.listItem(repo.save(n));
    }

    @Transactional
    public NoteResponse update(UUID userId, UUID id, UpdateNoteRequest req) {
        Note n = require(userId, id);
        if (req.title() != null) {
            n.setTitle(trimToNull(req.title()));
        }
        if (req.body() != null) {
            n.setBody(checkedBody(req.body()));
        }
        if (req.color() != null) {
            // "" clears the swatch — a colour you can set but not unset is a trap.
            n.setColor(trimToNull(req.color()));
        }
        if (req.pinned() != null) {
            n.setPinned(req.pinned());
        }
        if (req.cover() != null) {
            n.setCover(checkedCover(req.cover()));
        }
        return NoteResponse.listItem(repo.save(n));
    }

    /** Soft delete, like tasks: the row stays, the note stops existing. */
    @Transactional
    public void delete(UUID userId, UUID id) {
        Note n = require(userId, id);
        n.setDeletedAt(Instant.now());
        repo.save(n);
    }

    private Note require(UUID userId, UUID id) {
        return repo.findByIdAndUserIdAndDeletedAtIsNull(id, userId)
                .orElseThrow(() -> ApiException.notFound("Note"));
    }

    private static String checkedBody(String body) {
        if (body != null && body.length() > MAX_BODY) {
            throw ApiException.badRequest("That note is too big to save. Remove a photo or split it in two.");
        }
        return body;
    }

    /** "" clears it. Anything else must be an image, since it lands in an <img src>. */
    private static String checkedCover(String cover) {
        String c = trimToNull(cover);
        if (c != null && !c.startsWith("data:image/")) {
            throw ApiException.badRequest("That cover is not an image.");
        }
        return c;
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
