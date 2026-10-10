package com.growthbuddy.note;

import com.growthbuddy.common.ApiException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
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

    /** Days a deleted note waits in the Trash before the nightly purge removes it for good. */
    static final int TRASH_DAYS = 30;

    private final NoteRepository repo;
    private final NoteDraftRepository drafts;
    private final NoteEditDraftRepository editDrafts;

    public NoteService(NoteRepository repo, NoteDraftRepository drafts, NoteEditDraftRepository editDrafts) {
        this.repo = repo;
        this.drafts = drafts;
        this.editDrafts = editDrafts;
    }

    /** Unsaved edits to note {@code id}, or null. */
    @Transactional(readOnly = true)
    public NoteDraftResponse editDraft(UUID userId, UUID id) {
        return editDrafts.findByNoteIdAndUserId(id, userId).map(NoteDraftResponse::from).orElse(null);
    }

    /** Autosave of an open edit. The note must be the user's and still exist. */
    @Transactional
    public void saveEditDraft(UUID userId, UUID id, NoteDraftRequest req) {
        require(userId, id);
        NoteEditDraft d = editDrafts.findByNoteIdAndUserId(id, userId).orElseGet(NoteEditDraft::new);
        d.setNoteId(id);
        d.setUserId(userId);
        d.setTitle(trimToNull(req.title()));
        d.setBody(checkedBody(req.body()));
        d.setColor(trimToNull(req.color()));
        d.setLabels(draftLabels(req.labels(), d.getLabels()));
        editDrafts.save(d);
    }

    /**
     * The edit draft's labels column: "" for "all removed" (so it differs from null,
     * "none drafted"), the joined list otherwise. Null from an older client keeps
     * what is stored. Labels past {@link NoteLabels}' limits keep the last good set
     * rather than 400 the autosave and lose the body with them; Save enforces them.
     */
    static String draftLabels(List<String> labels, String stored) {
        if (labels == null) {
            return stored;
        }
        try {
            List<String> clean = NoteLabels.normalize(labels);
            return clean.isEmpty() ? "" : NoteLabels.join(clean);
        } catch (ApiException e) {
            return stored;
        }
    }

    @Transactional
    public void deleteEditDraft(UUID userId, UUID id) {
        editDrafts.findByNoteIdAndUserId(id, userId).ifPresent(editDrafts::delete);
    }

    /** The composer's unsaved note, or null. */
    @Transactional(readOnly = true)
    public NoteDraftResponse draft(UUID userId) {
        return drafts.findById(userId).map(NoteDraftResponse::from).orElse(null);
    }

    /** Autosave. A draft with nothing in it is no draft: the row goes. */
    @Transactional
    public void saveDraft(UUID userId, NoteDraftRequest req) {
        String title = trimToNull(req.title());
        String body = checkedBody(req.body());
        if (title == null && (body == null || body.isBlank())) {
            drafts.deleteById(userId);
            return;
        }
        NoteDraft d = drafts.findById(userId).orElseGet(NoteDraft::new);
        d.setUserId(userId);
        d.setTitle(title);
        d.setBody(body);
        d.setColor(trimToNull(req.color()));
        drafts.save(d);
    }

    @Transactional
    public void deleteDraft(UUID userId) {
        drafts.deleteById(userId);
    }

    /** The main list, or with {@code archived} the Archived view. */
    @Transactional(readOnly = true)
    public List<NoteResponse> list(UUID userId, boolean archived) {
        List<Note> rows = archived
                ? repo.findByUserIdAndDeletedAtIsNullAndArchivedAtIsNotNullOrderByArchivedAtDesc(userId)
                : repo.findByUserIdAndDeletedAtIsNullAndArchivedAtIsNullOrderByPinnedDescUpdatedAtDesc(userId);
        return rows.stream().map(NoteResponse::listItem).toList();
    }

    @Transactional(readOnly = true)
    public List<NoteResponse> list(UUID userId) {
        return list(userId, false);
    }

    /** Deleted in the last {@value #TRASH_DAYS} days, most recent first. */
    @Transactional(readOnly = true)
    public List<NoteResponse> trash(UUID userId) {
        return repo.findByUserIdAndDeletedAtAfterOrderByDeletedAtDesc(userId, trashCutoff(Instant.now()))
                .stream()
                .map(NoteResponse::listItem)
                .toList();
    }

    @Transactional(readOnly = true)
    public NoteCountsResponse counts(UUID userId) {
        return new NoteCountsResponse(
                repo.countByUserIdAndDeletedAtIsNullAndArchivedAtIsNotNull(userId),
                repo.countByUserIdAndDeletedAtAfter(userId, trashCutoff(Instant.now())));
    }

    /** The one definition of "too old for the Trash", shared by the view and the purge. */
    static Instant trashCutoff(Instant now) {
        return now.minus(Duration.ofDays(TRASH_DAYS));
    }

    /**
     * Hard delete, from the Trash only: a live note has to be deleted (soft)
     * first, so no single tap can lose one for good.
     */
    @Transactional
    public void deleteForever(UUID userId, UUID id) {
        Note n = repo.findByIdAndUserId(id, userId)
                .orElseThrow(() -> ApiException.notFound("Note"));
        if (n.getDeletedAt() == null) {
            throw ApiException.badRequest("Move the note to the Trash first.");
        }
        deleteEditDraft(userId, id);
        repo.delete(n);
    }

    /** Nightly (DataCleanupJob): notes deleted more than {@value #TRASH_DAYS} days ago. */
    @Transactional
    public int purgeTrash(Instant now) {
        Instant cutoff = trashCutoff(now);
        editDrafts.purgeForNotesDeletedBefore(cutoff);
        return repo.purgeDeletedBefore(cutoff);
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
        n.setLabels(NoteLabels.join(NoteLabels.normalize(req.labels())));
        // Trimmed like the list: the client already has the body it just sent.
        return NoteResponse.listItem(repo.save(n));
    }

    @Transactional
    public NoteResponse update(UUID userId, UUID id, UpdateNoteRequest req) {
        Note n = require(userId, id);
        // Optimistic concurrency: the client says which version it edited. A
        // write on top of a newer one (another device, another tab) used to win
        // silently and throw that edit away. Null skips the check — a pin
        // toggle doesn't care what the text says.
        if (req.baseUpdatedAt() != null && !sameVersion(req.baseUpdatedAt(), n.getUpdatedAt())) {
            throw new ApiException(HttpStatus.CONFLICT,
                    "This note was changed on another device since you opened it.");
        }
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
        if (req.labels() != null) {
            // [] clears them; null (above) leaves them alone.
            n.setLabels(NoteLabels.join(NoteLabels.normalize(req.labels())));
        }
        if (req.archived() != null) {
            // Archiving twice keeps the first date: that is when it left the list.
            if (!req.archived()) {
                n.setArchivedAt(null);
            } else if (n.getArchivedAt() == null) {
                n.setArchivedAt(Instant.now());
            }
        }
        // What was being drafted is now the note.
        if (req.body() != null || req.title() != null) {
            deleteEditDraft(userId, id);
        }
        return NoteResponse.listItem(repo.save(n));
    }

    /**
     * Within a second, not equal: updated_at is a TIMESTAMP with no fraction,
     * which MySQL rounds, while the entity a save returns still carries the
     * nanoseconds — so the version a client got from a PATCH never compares
     * equal to the one read back. Two saves of one note inside a second from
     * two devices is not a case worth a false 409 on every other save.
     */
    static boolean sameVersion(Instant a, Instant b) {
        if (a == null || b == null) {
            return a == b;
        }
        return Math.abs(Duration.between(a, b).toMillis()) < 1000;
    }

    /** Undo for a delete: the row was only soft-deleted, so it simply comes back. */
    @Transactional
    public NoteResponse restore(UUID userId, UUID id) {
        Note n = repo.findByIdAndUserId(id, userId)
                .orElseThrow(() -> ApiException.notFound("Note"));
        if (n.getDeletedAt() != null) {
            n.setDeletedAt(null);
            n = repo.save(n);
        }
        return NoteResponse.listItem(n);
    }

    /** Soft delete, like tasks: the row stays, the note stops existing. */
    @Transactional
    public void delete(UUID userId, UUID id) {
        Note n = require(userId, id);
        n.setDeletedAt(Instant.now());
        repo.save(n);
        deleteEditDraft(userId, id);
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
