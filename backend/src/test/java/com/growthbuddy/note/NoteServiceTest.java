package com.growthbuddy.note;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
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
    private final NoteService service = new NoteService(repo);

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
        NoteResponse out = service.update(USER, ID, new UpdateNoteRequest(null, null, null, null));
        assertThat(out.title()).isEqualTo("Groceries");
        assertThat(out.color()).isEqualTo("sun");
    }

    /** A colour you can set but not unset is a trap, so "" clears it. */
    @Test
    void emptyStringClearsTheColour() {
        stored("sun");
        NoteResponse out = service.update(USER, ID, new UpdateNoteRequest(null, null, "", null));
        assertThat(out.color()).isNull();
    }

    @Test
    void someoneElsesNoteIsNotFound() {
        when(repo.findByIdAndUserIdAndDeletedAtIsNull(ID, USER)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.update(USER, ID, new UpdateNoteRequest("x", null, null, null)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void anAbsurdlyLongBodyIsRefusedRatherThanTruncated() {
        stored(null);
        String huge = "x".repeat(70_000);
        assertThatThrownBy(() -> service.update(USER, ID, new UpdateNoteRequest(null, huge, null, null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("too long");
    }

    @Test
    void deleteIsSoft() {
        Note n = stored(null);
        service.delete(USER, ID);
        assertThat(n.getDeletedAt()).isNotNull();
    }
}
