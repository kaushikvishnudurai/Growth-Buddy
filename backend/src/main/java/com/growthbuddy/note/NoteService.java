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
     * Ceiling on a single note's HTML. Rich text is small — a long note is a few
     * KB — so this is a runaway guard, not a limit anyone should meet: paste a
     * whole page with images inlined as data URLs and the column (MEDIUMTEXT)
     * would take it, the phone rendering the list would not.
     *
     * <p>ponytail: one number, no per-user quota. Add one when a user has
     * enough notes for it to matter.
     */
    private static final int MAX_BODY = 64_000;

    private final NoteRepository repo;

    public NoteService(NoteRepository repo) {
        this.repo = repo;
    }

    @Transactional(readOnly = true)
    public List<NoteResponse> list(UUID userId) {
        return repo.findByUserIdAndDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc(userId).stream()
                .map(NoteResponse::from)
                .toList();
    }

    @Transactional
    public NoteResponse create(UUID userId, CreateNoteRequest req) {
        Note n = new Note();
        n.setUserId(userId);
        n.setTitle(trimToNull(req.title()));
        n.setBody(checkedBody(req.body()));
        n.setColor(trimToNull(req.color()));
        n.setPinned(Boolean.TRUE.equals(req.pinned()));
        return NoteResponse.from(repo.save(n));
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
        return NoteResponse.from(repo.save(n));
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
            throw ApiException.badRequest("That note is too long to save — try splitting it in two.");
        }
        return body;
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
