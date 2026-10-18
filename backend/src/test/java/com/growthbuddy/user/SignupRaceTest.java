package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.LoginAttemptGuard;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.mail.MailService;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.jpa.repository.Query;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * CRB-1 / CRB-2: parallel signups deadlocked on email_verification_tokens (a
 * range DELETE gap-locks even when it matches nothing), the code mail went out
 * while the transaction still held those locks, and a double-tapped signup with
 * one email answered 500 instead of 409.
 */
class SignupRaceTest {

    private final UserRepository users = mock(UserRepository.class);
    private final PasswordCredentialRepository creds = mock(PasswordCredentialRepository.class);
    private final MailService mail = mock(MailService.class);
    private final RateLimiter limiter = mock(RateLimiter.class);
    private final EmailChangeTokenRepository changeTokens = mock(EmailChangeTokenRepository.class);
    private final AuthService auth = new AuthService(users, creds,
            mock(EmailVerificationTokenRepository.class), mock(PasswordResetTokenRepository.class),
            mock(WhatsAppOtpTokenRepository.class), mail, mock(SessionService.class), null, limiter,
            mock(LoginAttemptGuard.class), null, "");

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(auth, "emailChangeTokens", changeTokens);
        when(limiter.allow(anyString(), anyInt(), anyLong())).thenReturn(true);
        when(limiter.peek(anyString(), anyInt(), anyLong())).thenReturn(true);
        when(users.findByEmail(anyString())).thenReturn(Optional.empty());
        TransactionSynchronizationManager.initSynchronization(); // as inside @Transactional
    }

    @AfterEach
    void tearDown() {
        TransactionSynchronizationManager.clearSynchronization();
    }

    private static void commit() {
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
    }

    @Test
    void tokenClearsAreNotRangeDeletes() throws Exception {
        for (Class<?> repo : new Class<?>[] {EmailVerificationTokenRepository.class,
                PasswordResetTokenRepository.class, EmailChangeTokenRepository.class,
                WhatsAppOtpTokenRepository.class}) {
            var m = repo.getMethod("deleteAllForUser", UUID.class);
            assertThat(m.isDefault()).as(repo.getSimpleName() + " deletes by primary key").isTrue();
            assertThat(m.getAnnotation(Query.class)).as(repo.getSimpleName()).isNull();
        }
    }

    @Test
    void signupCodeMailWaitsForCommit() {
        auth.signup(new SignupRequest("new@example.com", "correct horse", null, null));
        verify(mail, never()).sendOtp(any(), any(), any(), any());
        commit();
        verify(mail).sendOtp(any(), any(), any(), any());
    }

    @Test
    void emailChangeCodeMailWaitsForCommit() {
        User u = new User();
        u.setId(UUID.randomUUID());
        u.setEmail("old@example.com");
        PasswordCredential c = new PasswordCredential();
        c.setPasswordHash(new BCryptPasswordEncoder().encode("correct horse"));
        when(users.findById(u.getId())).thenReturn(Optional.of(u));
        when(creds.findById(u.getId())).thenReturn(Optional.of(c));
        auth.requestEmailChange(u.getId(), new ChangeEmailRequest("next@example.com", "correct horse"));
        verify(mail, never()).sendOtp(any(), any(), any(), any());
        commit();
        verify(mail).sendOtp(any(), any(), any(), any());
    }

    @Test
    void sameEmailRaceLoserGets409() {
        when(users.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("uq_users_email"));
        assertThatThrownBy(() -> auth.signup(new SignupRequest("dup@example.com", "correct horse", null, null)))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
        commit();
        verify(mail, never()).sendOtp(any(), any(), any(), any());
    }
}
