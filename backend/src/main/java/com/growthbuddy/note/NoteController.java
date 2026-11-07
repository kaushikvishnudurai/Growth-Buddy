package com.growthbuddy.note;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/notes")
public class NoteController {

    private final NoteService service;
    private final NoteDraftEvents draftEvents;

    public NoteController(NoteService service, NoteDraftEvents draftEvents) {
        this.service = service;
        this.draftEvents = draftEvents;
    }

    /* Every draft write tells the user's other sessions (NoteDraftEvents), after
       the service's transaction has committed, so the GET they make reads it. */
    private static final String CLIENT = "X-GB-Client";
    private static final String DEVICE = "X-GB-Device";

    /** The main list; {@code ?archived=true} is the Archived view instead. */
    @GetMapping
    public List<NoteResponse> list(@RequestParam(defaultValue = "false") boolean archived) {
        return service.list(CurrentUser.id(), archived);
    }

    /** Deleted in the last 30 days. Literal paths win over /{id}. */
    @GetMapping("/trash")
    public List<NoteResponse> trash() {
        return service.trash(CurrentUser.id());
    }

    /** Archived and Trash counts, for the view switcher. */
    @GetMapping("/counts")
    public NoteCountsResponse counts() {
        return service.counts(CurrentUser.id());
    }

    /** 204 when there is no draft. Literal paths win over /{id}. */
    @GetMapping("/draft")
    public ResponseEntity<NoteDraftResponse> draft() {
        NoteDraftResponse d = service.draft(CurrentUser.id());
        // A bare null is a 200 with an empty body, which the client's res.json() chokes on.
        return d == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(d);
    }

    @PutMapping("/draft")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void saveDraft(@Valid @RequestBody NoteDraftRequest req,
                          @RequestHeader(value = CLIENT, required = false) String origin,
                          @RequestHeader(value = DEVICE, required = false) String device) {
        UUID user = CurrentUser.id();
        service.saveDraft(user, req);
        draftEvents.changed(user, null, origin, device);
    }

    @DeleteMapping("/draft")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteDraft(@RequestHeader(value = CLIENT, required = false) String origin) {
        UUID user = CurrentUser.id();
        service.deleteDraft(user);
        draftEvents.changed(user, null, origin, null);
    }

    /** Which notes have unsaved edits ({@code noteId}, {@code updatedAt}), for the cards' Draft mark. */
    @GetMapping("/edit-drafts")
    public List<NoteEditDraftMark> editDrafts() {
        return service.editDraftMarks(CurrentUser.id());
    }

    @GetMapping("/{id}")
    public NoteResponse get(@PathVariable UUID id) {
        return service.get(CurrentUser.id(), id);
    }

    /** Unsaved edits to one note; 204 when there are none. */
    @GetMapping("/{id}/draft")
    public ResponseEntity<NoteDraftResponse> editDraft(@PathVariable UUID id) {
        NoteDraftResponse d = service.editDraft(CurrentUser.id(), id);
        return d == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(d);
    }

    @PutMapping("/{id}/draft")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void saveEditDraft(@PathVariable UUID id, @Valid @RequestBody NoteDraftRequest req,
                              @RequestHeader(value = CLIENT, required = false) String origin,
                              @RequestHeader(value = DEVICE, required = false) String device) {
        UUID user = CurrentUser.id();
        service.saveEditDraft(user, id, req);
        draftEvents.changed(user, id, origin, device);
    }

    @DeleteMapping("/{id}/draft")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteEditDraft(@PathVariable UUID id,
                                @RequestHeader(value = CLIENT, required = false) String origin) {
        UUID user = CurrentUser.id();
        service.deleteEditDraft(user, id);
        draftEvents.changed(user, id, origin, null);
    }

    /** Undo a delete (soft, so nothing was lost). */
    @PostMapping("/{id}/restore")
    public NoteResponse restore(@PathVariable UUID id) {
        return service.restore(CurrentUser.id(), id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public NoteResponse create(@Valid @RequestBody CreateNoteRequest req) {
        return service.create(CurrentUser.id(), req);
    }

    @PatchMapping("/{id}")
    public NoteResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateNoteRequest req,
                               @RequestHeader(value = CLIENT, required = false) String origin) {
        UUID user = CurrentUser.id();
        NoteResponse saved = service.update(user, id, req);
        // A title or body save drops the note's edit draft (NoteService.update):
        // other sessions showing it as a draft re-read it and let it go.
        if (req.title() != null || req.body() != null) draftEvents.changed(user, id, origin, null);
        return saved;
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(CurrentUser.id(), id);
    }

    /** Hard delete of a note already in the Trash (400 for a live one). */
    @DeleteMapping("/{id}/forever")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteForever(@PathVariable UUID id) {
        service.deleteForever(CurrentUser.id(), id);
    }
}
