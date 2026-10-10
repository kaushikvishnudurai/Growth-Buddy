package com.growthbuddy.digest;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** No digest (email, bell or push) for an account scheduled for deletion. */
class DigestPendingDeletionTest {

    private final UserRepository users = mock(UserRepository.class);
    private final DigestService digest = mock(DigestService.class);
    private final DigestScheduler scheduler = new DigestScheduler(users, digest);

    /** Daily, due this very hour in UTC, never sent: everything but the deletion says send. */
    private User dueNow(Instant deletionRequestedAt) {
        User u = new User();
        u.setId(UUID.randomUUID());
        u.setEmail("ada@example.com");
        u.setTimezone("UTC");
        u.setDigestFrequency("daily");
        u.setDigestHour(LocalDateTime.now(ZoneId.of("UTC")).getHour());
        u.setDeletionRequestedAt(deletionRequestedAt);
        when(users.findByDigestFrequencyNot("off")).thenReturn(List.of(u));
        return u;
    }

    @Test
    void anAccountScheduledForDeletionGetsNoDigest() {
        dueNow(Instant.now());

        scheduler.dispatchDigests();

        verify(digest, never()).sendDigest(any(), anyBoolean(), any());
        verify(users, never()).save(any());
    }

    @Test
    void aLiveAccountStillDoes() {
        User u = dueNow(null);

        scheduler.dispatchDigests();

        verify(digest).sendDigest(eq(u), eq(false), any());
    }
}
