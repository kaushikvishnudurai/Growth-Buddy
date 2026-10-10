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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/notes")
public class NoteController {

    private final NoteService service;

    public NoteController(NoteService service) {
        this.service = service;
    }

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
    public void saveDraft(@Valid @RequestBody NoteDraftRequest req) {
        service.saveDraft(CurrentUser.id(), req);
    }

    @DeleteMapping("/draft")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteDraft() {
        service.deleteDraft(CurrentUser.id());
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
    public void saveEditDraft(@PathVariable UUID id, @Valid @RequestBody NoteDraftRequest req) {
        service.saveEditDraft(CurrentUser.id(), id, req);
    }

    @DeleteMapping("/{id}/draft")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteEditDraft(@PathVariable UUID id) {
        service.deleteEditDraft(CurrentUser.id(), id);
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
    public NoteResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateNoteRequest req) {
        return service.update(CurrentUser.id(), id, req);
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
