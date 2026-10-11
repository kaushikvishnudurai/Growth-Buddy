package com.growthbuddy.user;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.RETURNS_SELF;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.LoginAttemptGuard;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.mail.MailService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

/** CRS-3: a deleted account's browser kept its push subscription for the whole grace period. */
class DeleteAccountPushTest {

    @Test
    void schedulingDeletionDropsEveryPushSubscription() {
        UserRepository users = mock(UserRepository.class);
        PasswordCredentialRepository creds = mock(PasswordCredentialRepository.class);
        AuthService auth = new AuthService(users, creds, mock(EmailVerificationTokenRepository.class),
                mock(PasswordResetTokenRepository.class), mock(WhatsAppOtpTokenRepository.class),
                mock(MailService.class), mock(SessionService.class), null, mock(RateLimiter.class),
                mock(LoginAttemptGuard.class), null, "");
        EntityManager em = mock(EntityManager.class);
        Query q = mock(Query.class, RETURNS_SELF);
        when(em.createNativeQuery(anyString())).thenReturn(q);
        ReflectionTestUtils.setField(auth, "em", em);

        User u = new User();
        u.setId(UUID.randomUUID());
        u.setEmail("ada@example.com");
        u.setTimezone("UTC");
        PasswordCredential c = new PasswordCredential();
        c.setPasswordHash(new BCryptPasswordEncoder().encode("correct horse"));
        when(creds.findById(u.getId())).thenReturn(Optional.of(c));
        when(users.findById(u.getId())).thenReturn(Optional.of(u));

        auth.deleteAccount(u.getId(), "correct horse");

        verify(em).createNativeQuery("DELETE FROM push_subscriptions WHERE user_id = ?1");
        verify(q).setParameter(1, u.getId());
        verify(q).executeUpdate();
    }
}
