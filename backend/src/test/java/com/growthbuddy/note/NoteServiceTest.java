package com.growthbuddy.note;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The update path has the only branches worth a test: a null field means "leave
 * it alone" while an empty string means "clear it", and those two look the same
 * to anyone reading the JSON.
 */
class NoteServiceTest {

    private static final UUID USER = UUID.randomUUID();
    private static final UUID ID = UUID.randomUUID();

    private final NoteRepository repo = mock(NoteRepository.class);
    private final NoteDraftRepository drafts = mock(NoteDraftRepository.class);
    private final NoteEditDraftRepository editDrafts = mock(NoteEditDraftRepository.class);
    private final NoteService service = new NoteService(repo, drafts, editDrafts);

    private Note stored(String color) {
        Note n = new Note();
        n.setId(ID);
        n.setUserId(USER);
        n.setTitle("Groceries");
        n.setColor(color);
        when(repo.findByIdAndUserIdAndDeletedAtIsNull(ID, USER)).thenReturn(Optional.of(n));
        when(repo.save(any(Note.class))).thenAnswer(inv -> inv.getArgument(0));
        return n;
    }

    @Test
    void nullFieldsAreLeftAlone() {
        stored("sun");
        NoteResponse out = service.update(USER, ID, new UpdateNoteRequest(null, null, null, null, null, null, null, null));
        assertThat(out.title()).isEqualTo("Groceries");
        assertThat(out.color()).isEqualTo("sun");
    }

    /** A colour you can set but not unset is a trap, so "" clears it. */
    @Test
    void emptyStringClearsTheColour() {
        stored("sun");
        NoteResponse out = service.update(USER, ID, new UpdateNoteRequest(null, null, "", null, null, null, null, null));
        assertThat(out.color()).isNull();
    }

    @Test
    void someoneElsesNoteIsNotFound() {
        when(repo.findByIdAndUserIdAndDeletedAtIsNull(ID, USER)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.update(USER, ID, new UpdateNoteRequest("x", null, null, null, null, null, null, null)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void anAbsurdlyLongBodyIsRefusedRatherThanTruncated() {
        stored(null);
        String huge = "x".repeat(2_100_000);
        assertThatThrownBy(() -> service.update(USER, ID, new UpdateNoteRequest(null, huge, null, null, null, null, null, null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("too big");
    }

    /** The list carries no photos, says so, and counts them for the card. */
    @Test
    void theListCutsPhotosOutAndSaysSo() {
        Note n = stored(null);
        n.setBody("<p>lake</p><img src=\"data:image/jpeg;base64,AAAA\" alt=\"\"><img src=\"data:image/jpeg;base64,BB==\">");
        n.setCover("data:image/jpeg;base64,CC==");
        when(repo.findByUserIdAndDeletedAtIsNullAndArchivedAtIsNullOrderByPinnedDescUpdatedAtDesc(USER))
                .thenReturn(java.util.List.of(n));
        NoteResponse item = service.list(USER).get(0);
        assertThat(item.body()).isEqualTo("<p>lake</p>");
        assertThat(item.photoCount()).isEqualTo(2);
        assertThat(item.bodyTrimmed()).isTrue();
        assertThat(item.cover()).isEqualTo("data:image/jpeg;base64,CC==");

        NoteResponse full = service.get(USER, ID);
        assertThat(full.body()).contains("<img").isEqualTo(n.getBody());
        assertThat(full.bodyTrimmed()).isFalse();
    }

    /** A described photo keeps its alt text in the list, without its bytes, so search finds it. */
    @Test
    void theListKeepsAPhotosAltText() {
        Note n = stored(null);
        n.setBody("<p>bills</p><img src=\"data:image/jpeg;base64,AAAA\" alt=\"electricity &amp; gas\">");
        when(repo.findByUserIdAndDeletedAtIsNullAndArchivedAtIsNullOrderByPinnedDescUpdatedAtDesc(USER))
                .thenReturn(java.util.List.of(n));
        NoteResponse item = service.list(USER).get(0);
        assertThat(item.body()).isEqualTo("<p>bills</p><img alt=\"electricity &amp; gas\">");
        assertThat(item.photoCount()).isEqualTo(1);
    }

    @Test
    void aCoverMustBeAnImageAndEmptyClearsIt() {
        Note n = stored(null);
        n.setCover("data:image/jpeg;base64,CC==");
        assertThatThrownBy(() -> service.update(USER, ID,
                new UpdateNoteRequest(null, null, null, null, "javascript:alert(1)", null, null, null)))
                .isInstanceOf(ApiException.class);
        service.update(USER, ID, new UpdateNoteRequest(null, null, null, null, "", null, null, null));
        assertThat(n.getCover()).isNull();
    }

    @Test
    void deleteIsSoft() {
        Note n = stored(null);
        service.delete(USER, ID);
        assertThat(n.getDeletedAt()).isNotNull();
    }

    /* An autosave of a cleared composer must remove the draft, not store an
       empty one that reopens the composer on the next visit. */
    @Test
    void emptyDraftDeletesTheRow() {
        service.saveDraft(USER, new NoteDraftRequest("  ", "", null, null));
        verify(drafts).deleteById(USER);
        verify(drafts, never()).save(any());
    }

    @Test
    void draftIsUpsertedPerUser() {
        when(drafts.findById(USER)).thenReturn(Optional.empty());
        when(drafts.save(any())).thenAnswer(i -> i.getArgument(0));
        service.saveDraft(USER, new NoteDraftRequest(" Groceries ", "<p>milk</p>", "sky", null));
        verify(drafts).save(org.mockito.ArgumentMatchers.argThat(d ->
                USER.equals(d.getUserId()) && "Groceries".equals(d.getTitle())
                        && "<p>milk</p>".equals(d.getBody())));
    }

    /* Optimistic concurrency: an edit made against an older version is refused
       rather than silently overwriting what another device saved since. */
    @Test
    void aStaleBaseVersionIsAConflict() {
        Note n = stored(null);
        n.setUpdatedAt(java.time.Instant.parse("2026-10-10T09:00:05Z"));
        assertThatThrownBy(() -> service.update(USER, ID, new UpdateNoteRequest("x", null, null, null, null,
                java.time.Instant.parse("2026-10-10T08:00:00Z"), null, null)))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus().value()).isEqualTo(409));
        assertThat(n.getTitle()).isEqualTo("Groceries");
    }

    /* The column has no fraction and MySQL rounds, so the version a PATCH
       answered with is up to half a second off what is read back. */
    @Test
    void theSameVersionToTheSecondIsNotAConflict() {
        Note n = stored(null);
        n.setUpdatedAt(java.time.Instant.parse("2026-10-10T09:00:05Z"));
        NoteResponse out = service.update(USER, ID, new UpdateNoteRequest("Shopping", null, null, null, null,
                java.time.Instant.parse("2026-10-10T09:00:04.600Z"), null, null));
        assertThat(out.title()).isEqualTo("Shopping");
        assertThat(NoteService.sameVersion(null, null)).isTrue();
    }

    @Test
    void restoreBringsADeletedNoteBack() {
        Note n = new Note();
        n.setId(ID);
        n.setUserId(USER);
        n.setDeletedAt(java.time.Instant.now());
        when(repo.findByIdAndUserId(ID, USER)).thenReturn(Optional.of(n));
        when(repo.save(any(Note.class))).thenAnswer(inv -> inv.getArgument(0));
        service.restore(USER, ID);
        assertThat(n.getDeletedAt()).isNull();
    }

    @Test
    void savingTheNoteDropsItsEditDraft() {
        stored(null);
        NoteEditDraft d = new NoteEditDraft();
        when(editDrafts.findByNoteIdAndUserId(ID, USER)).thenReturn(Optional.of(d));
        service.update(USER, ID, new UpdateNoteRequest("t", "<p>b</p>", null, null, null, null, null, null));
        verify(editDrafts).delete(d);
    }

    @Test
    void anEditDraftIsKeyedByTheNote() {
        stored(null);
        when(editDrafts.findByNoteIdAndUserId(ID, USER)).thenReturn(Optional.empty());
        service.saveEditDraft(USER, ID, new NoteDraftRequest("T", "<p>half</p>", null, null));
        verify(editDrafts).save(org.mockito.ArgumentMatchers.argThat(d ->
                ID.equals(d.getNoteId()) && USER.equals(d.getUserId()) && "<p>half</p>".equals(d.getBody())));
    }

    @Test
    void anEditDraftKeepsItsLabelsAndGivesThemBack() {
        stored(null);
        NoteEditDraft d = new NoteEditDraft();
        when(editDrafts.findByNoteIdAndUserId(ID, USER)).thenReturn(Optional.of(d));
        service.saveEditDraft(USER, ID, new NoteDraftRequest("T", "<p>b</p>", null,
                java.util.List.of(" Work ", "ideas", "work")));
        assertThat(d.getLabels()).isEqualTo("Work,ideas");
        assertThat(service.editDraft(USER, ID).labels()).containsExactly("Work", "ideas");
        // An older client sends none: what's stored stays.
        service.saveEditDraft(USER, ID, new NoteDraftRequest("T", "<p>b</p>", null, null));
        assertThat(d.getLabels()).isEqualTo("Work,ideas");
        // Every chip removed is not "none drafted": the restore must clear them.
        service.saveEditDraft(USER, ID, new NoteDraftRequest("T", "<p>b</p>", null, java.util.List.of()));
        assertThat(service.editDraft(USER, ID).labels()).isEmpty();
        // Past the limits: the autosave still lands, with the last good labels.
        service.saveEditDraft(USER, ID, new NoteDraftRequest("T", "<p>c</p>", null, java.util.List.of("x".repeat(31))));
        assertThat(d.getBody()).isEqualTo("<p>c</p>");
        assertThat(d.getLabels()).isEmpty();
        // A row from before labels were drafted: null, so the note's own stay.
        d.setLabels(null);
        assertThat(service.editDraft(USER, ID).labels()).isNull();
    }

    @Test
    void labelsAreNormalisedOnSaveAndAnEmptyListClearsThem() {
        Note n = stored(null);
        NoteResponse out = service.update(USER, ID, new UpdateNoteRequest(null, null, null, null, null, null,
                java.util.List.of(" Work ", "ideas, work", "  "), null));
        assertThat(n.getLabels()).isEqualTo("Work,ideas");
        assertThat(out.labels()).containsExactly("Work", "ideas");
        service.update(USER, ID, new UpdateNoteRequest(null, null, null, null, null, null, null, null));
        assertThat(n.getLabels()).as("null leaves them alone").isEqualTo("Work,ideas");
        service.update(USER, ID, new UpdateNoteRequest(null, null, null, null, null, null,
                java.util.List.of(), null));
        assertThat(n.getLabels()).isNull();
    }

    @Test
    void tooManyLabelsAreRefused() {
        stored(null);
        java.util.List<String> eleven = java.util.stream.IntStream.range(0, 11)
                .mapToObj(i -> "l" + i).toList();
        assertThatThrownBy(() -> service.update(USER, ID,
                new UpdateNoteRequest(null, null, null, null, null, null, eleven, null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("10 labels");
    }

    @Test
    void archiveKeepsItsFirstDateAndUnarchiveClearsIt() {
        Note n = stored(null);
        service.update(USER, ID, new UpdateNoteRequest(null, null, null, null, null, null, null, true));
        java.time.Instant first = n.getArchivedAt();
        assertThat(first).isNotNull();
        service.update(USER, ID, new UpdateNoteRequest(null, null, null, null, null, null, null, true));
        assertThat(n.getArchivedAt()).isEqualTo(first);
        service.update(USER, ID, new UpdateNoteRequest(null, null, null, null, null, null, null, false));
        assertThat(n.getArchivedAt()).isNull();
    }

    @Test
    void theArchivedViewReadsArchivedNotesOnly() {
        Note n = stored(null);
        n.setArchivedAt(java.time.Instant.now());
        when(repo.findByUserIdAndDeletedAtIsNullAndArchivedAtIsNotNullOrderByArchivedAtDesc(USER))
                .thenReturn(java.util.List.of(n));
        assertThat(service.list(USER, true)).extracting(NoteResponse::id).containsExactly(ID);
        verify(repo, never()).findByUserIdAndDeletedAtIsNullAndArchivedAtIsNullOrderByPinnedDescUpdatedAtDesc(USER);
    }

    /* The Trash view and the purge must agree on "30 days", or a note shows in
       the Trash after it is already gone (or vanishes before its time). */
    @Test
    void theTrashAndThePurgeShareOneCutoff() {
        java.time.Instant now = java.time.Instant.parse("2026-10-10T03:30:00Z");
        assertThat(NoteService.trashCutoff(now)).isEqualTo(java.time.Instant.parse("2026-09-10T03:30:00Z"));
        when(repo.purgeDeletedBefore(NoteService.trashCutoff(now))).thenReturn(3);
        assertThat(service.purgeTrash(now)).isEqualTo(3);
        verify(editDrafts).purgeForNotesDeletedBefore(NoteService.trashCutoff(now));

        java.time.Instant before = java.time.Instant.now();
        service.trash(USER);
        org.mockito.ArgumentCaptor<java.time.Instant> cutoff = org.mockito.ArgumentCaptor.forClass(java.time.Instant.class);
        verify(repo).findByUserIdAndDeletedAtAfterOrderByDeletedAtDesc(org.mockito.ArgumentMatchers.eq(USER), cutoff.capture());
        assertThat(cutoff.getValue()).isBetween(NoteService.trashCutoff(before).minusSeconds(1),
                NoteService.trashCutoff(java.time.Instant.now()));
    }

    @Test
    void deleteForeverOnlyFromTheTrash() {
        Note n = new Note();
        n.setId(ID);
        n.setUserId(USER);
        when(repo.findByIdAndUserId(ID, USER)).thenReturn(Optional.of(n));
        assertThatThrownBy(() -> service.deleteForever(USER, ID)).isInstanceOf(ApiException.class);
        verify(repo, never()).delete(any(Note.class));
        n.setDeletedAt(java.time.Instant.now());
        service.deleteForever(USER, ID);
        verify(repo).delete(n);
    }
}
