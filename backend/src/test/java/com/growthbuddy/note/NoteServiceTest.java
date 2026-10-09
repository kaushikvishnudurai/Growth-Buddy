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
    private final NoteService service = new NoteService(repo, drafts);

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
        NoteResponse out = service.update(USER, ID, new UpdateNoteRequest(null, null, null, null, null));
        assertThat(out.title()).isEqualTo("Groceries");
        assertThat(out.color()).isEqualTo("sun");
    }

    /** A colour you can set but not unset is a trap, so "" clears it. */
    @Test
    void emptyStringClearsTheColour() {
        stored("sun");
        NoteResponse out = service.update(USER, ID, new UpdateNoteRequest(null, null, "", null, null));
        assertThat(out.color()).isNull();
    }

    @Test
    void someoneElsesNoteIsNotFound() {
        when(repo.findByIdAndUserIdAndDeletedAtIsNull(ID, USER)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.update(USER, ID, new UpdateNoteRequest("x", null, null, null, null)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void anAbsurdlyLongBodyIsRefusedRatherThanTruncated() {
        stored(null);
        String huge = "x".repeat(2_100_000);
        assertThatThrownBy(() -> service.update(USER, ID, new UpdateNoteRequest(null, huge, null, null, null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("too big");
    }

    /** The list carries no photos, says so, and counts them for the card. */
    @Test
    void theListCutsPhotosOutAndSaysSo() {
        Note n = stored(null);
        n.setBody("<p>lake</p><img src=\"data:image/jpeg;base64,AAAA\" alt=\"\"><img src=\"data:image/jpeg;base64,BB==\">");
        n.setCover("data:image/jpeg;base64,CC==");
        when(repo.findByUserIdAndDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc(USER))
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
        when(repo.findByUserIdAndDeletedAtIsNullOrderByPinnedDescUpdatedAtDesc(USER))
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
                new UpdateNoteRequest(null, null, null, null, "javascript:alert(1)")))
                .isInstanceOf(ApiException.class);
        service.update(USER, ID, new UpdateNoteRequest(null, null, null, null, ""));
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
        service.saveDraft(USER, new NoteDraftRequest("  ", "", null));
        verify(drafts).deleteById(USER);
        verify(drafts, never()).save(any());
    }

    @Test
    void draftIsUpsertedPerUser() {
        when(drafts.findById(USER)).thenReturn(Optional.empty());
        when(drafts.save(any())).thenAnswer(i -> i.getArgument(0));
        service.saveDraft(USER, new NoteDraftRequest(" Groceries ", "<p>milk</p>", "sky"));
        verify(drafts).save(org.mockito.ArgumentMatchers.argThat(d ->
                USER.equals(d.getUserId()) && "Groceries".equals(d.getTitle())
                        && "<p>milk</p>".equals(d.getBody())));
    }
}
