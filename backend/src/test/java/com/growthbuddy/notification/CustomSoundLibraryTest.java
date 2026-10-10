package com.growthbuddy.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * A user keeps up to MAX_PER_USER sounds. The id is the client's, so the branches worth
 * pinning are: a new id past the cap is refused, the same id again replaces
 * without counting, and someone else's id is not theirs to overwrite.
 */
class CustomSoundLibraryTest {

    private static final UUID USER = UUID.randomUUID();
    private static final UUID ID = UUID.randomUUID();
    private static final String SOUND =
            "data:audio/webm;base64," + Base64.getEncoder().encodeToString(new byte[64]);

    private final CustomSoundRepository repo = mock(CustomSoundRepository.class);
    private final CustomSoundService service = new CustomSoundService(repo);

    private void saves() {
        when(repo.save(any(CustomSound.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    void aNewSoundUnderTheCapIsStoredUnderTheClientsId() {
        saves();
        when(repo.findById(ID)).thenReturn(Optional.empty());
        when(repo.countForUpdate(USER.toString())).thenReturn((long) CustomSoundService.MAX_PER_USER - 1);
        assertThat(service.put(USER, ID, "Recording 1", "file", SOUND)).isNotNull();
        verify(repo).save(org.mockito.ArgumentMatchers.argThat(s ->
                ID.equals(s.getId()) && USER.equals(s.getUserId()) && "Recording 1".equals(s.getName())
                        && "audio/webm".equals(s.getContentType())));
    }

    @Test
    void aFifthSoundIsRefusedWithA400() {
        when(repo.findById(ID)).thenReturn(Optional.empty());
        when(repo.countForUpdate(USER.toString())).thenReturn((long) CustomSoundService.MAX_PER_USER);
        assertThatThrownBy(() -> service.put(USER, ID, "One too many", "file", SOUND))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        verify(repo, never()).save(any());
    }

    /**
     * The count is only a cap if nobody else is counting at the same moment —
     * the lock comes before every read, and the count is a locking read.
     * (A plain count after the lock let 8 of 8 simultaneous uploads through.)
     */
    @Test
    void theOwnerIsLockedBeforeTheCount() {
        saves();
        when(repo.findById(ID)).thenReturn(Optional.empty());
        service.put(USER, ID, "Recording 1", "file", SOUND);
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(repo);
        order.verify(repo).lockOwner(USER.toString());
        order.verify(repo).findById(ID);
        order.verify(repo).countForUpdate(USER.toString());
    }

    /** A retry, or a replacement: it already holds a slot, so a full library doesn't stop it. */
    @Test
    void theSameIdAgainReplacesEvenWhenFull() {
        saves();
        CustomSound mine = new CustomSound();
        mine.setId(ID);
        mine.setUserId(USER);
        when(repo.findById(ID)).thenReturn(Optional.of(mine));
        when(repo.countForUpdate(USER.toString())).thenReturn((long) CustomSoundService.MAX_PER_USER);
        service.put(USER, ID, "Renamed", "file", SOUND);
        assertThat(mine.getName()).isEqualTo("Renamed");
        assertThat(mine.getAudio()).hasSize(64);
    }

    @Test
    void someoneElsesIdIsNotFound() {
        CustomSound theirs = new CustomSound();
        theirs.setId(ID);
        theirs.setUserId(UUID.randomUUID());
        when(repo.findById(ID)).thenReturn(Optional.of(theirs));
        assertThatThrownBy(() -> service.put(USER, ID, "Mine now", "file", SOUND))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus())
                .isEqualTo(HttpStatus.NOT_FOUND);
        verify(repo, never()).save(any());
    }

    /** The kind is kept, not inferred: a renamed recording is still a recording. */
    @Test
    void theSourceIsStoredAndUnknownValuesAreDropped() {
        saves();
        when(repo.findById(ID)).thenReturn(Optional.empty());
        service.put(USER, ID, "Recording 1", "recording", SOUND);
        verify(repo).save(org.mockito.ArgumentMatchers.argThat(s -> "recording".equals(s.getSource())));
        assertThat(CustomSoundService.normalizeSource("<script>")).isNull();
        assertThat(CustomSoundService.normalizeSource("file")).isEqualTo("file");
    }

    /** A rename touches the name only — updatedAt is what makes other devices re-download the bytes. */
    @Test
    void renameChangesOnlyTheName() {
        saves();
        CustomSound mine = new CustomSound();
        mine.setId(ID);
        mine.setUserId(USER);
        mine.setName("Recording 1");
        mine.setSource("recording");
        mine.setAudio(new byte[] {1, 2, 3});
        java.time.Instant at = java.time.Instant.parse("2026-10-01T09:00:00Z");
        mine.setUpdatedAt(at);
        when(repo.findByIdAndUserId(ID, USER)).thenReturn(Optional.of(mine));
        CustomSoundService.SoundInfo out = service.rename(USER, ID, "  Mom saying wake up ");
        assertThat(out.name()).isEqualTo("Mom saying wake up");
        assertThat(out.source()).isEqualTo("recording");
        assertThat(mine.getUpdatedAt()).isEqualTo(at);
        assertThat(mine.getAudio()).containsExactly(1, 2, 3);
    }

    @Test
    void renameRefusesABlankNameAndSomeoneElsesSound() {
        assertThatThrownBy(() -> service.rename(USER, ID, "   "))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        when(repo.findByIdAndUserId(ID, USER)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.rename(USER, ID, "Mine now"))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus())
                .isEqualTo(HttpStatus.NOT_FOUND);
        verify(repo, never()).save(any());
    }

    @Test
    void namesAreTrimmedCutAndBlankMeansDefault() {
        assertThat(CustomSoundService.normalizeName("  Wake up \n")).isEqualTo("Wake up");
        assertThat(CustomSoundService.normalizeName("   ")).isNull();
        assertThat(CustomSoundService.normalizeName(null)).isNull();
        assertThat(CustomSoundService.normalizeName("x".repeat(200))).hasSize(CustomSoundService.MAX_NAME);
    }
}
