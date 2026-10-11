package com.growthbuddy.digest;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * CRB-8: the digest stamped lastDigestOn by saving the User loaded at the start
 * of the run (reverting XP and settings written meanwhile), and two instances
 * could both send. The stamp is now a conditional UPDATE taken before sending.
 */
class DigestClaimTest {

    private static final LocalDate YESTERDAY = LocalDate.now(ZoneId.of("UTC")).minusDays(1);
    private final UserRepository users = mock(UserRepository.class);
    private final DigestService digest = mock(DigestService.class);
    private final DigestScheduler scheduler = new DigestScheduler(users, digest);

    private User dueNow() {
        User u = new User();
        u.setId(UUID.randomUUID());
        u.setEmail("ada@example.com");
        u.setTimezone("UTC");
        u.setDigestFrequency("daily");
        u.setDigestHour(LocalDateTime.now(ZoneId.of("UTC")).getHour());
        u.setLastDigestOn(YESTERDAY);
        when(users.findByDigestFrequencyNot("off")).thenReturn(List.of(u));
        return u;
    }

    @Test
    void theWinnerSendsWithoutSavingTheSnapshot() {
        User u = dueNow();
        when(users.claimDigest(eq(u.getId()), any())).thenReturn(1);
        scheduler.dispatchDigests();
        verify(digest).sendDigest(eq(u), eq(false), any());
        verify(users, never()).save(any());
    }

    @Test
    void aLostClaimSendsNothing() {
        dueNow(); // claimDigest answers 0: another instance stamped today first
        scheduler.dispatchDigests();
        verify(digest, never()).sendDigest(any(), anyBoolean(), any());
    }

    /** I-08: no digest on a break day; nothing is claimed, so it resumes after. */
    @Test
    void aBreakDaySendsNoDigest() {
        User u = dueNow();
        LocalDate today = LocalDate.now(ZoneId.of("UTC"));
        u.setUiPrefs(new java.util.HashMap<>(java.util.Map.of(
                "breakFrom", today.toString(), "breakUntil", today.plusDays(2).toString())));
        scheduler.dispatchDigests();
        verify(users, never()).claimDigest(any(), any());
        verify(digest, never()).sendDigest(any(), anyBoolean(), any());
    }

    @Test
    void aFailedSendHandsTheClaimBack() {
        User u = dueNow();
        when(users.claimDigest(eq(u.getId()), any())).thenReturn(1);
        doThrow(new RuntimeException("smtp down")).when(digest).sendDigest(any(), anyBoolean(), any());
        scheduler.dispatchDigests();
        verify(users).releaseDigest(eq(u.getId()), any(), eq(YESTERDAY));
    }
}
