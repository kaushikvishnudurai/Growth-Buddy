package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.LoginAttemptGuard;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.mail.MailService;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * A bearer token alone must not turn 2FA on: a stolen session would enroll its
 * own authenticator and lock the owner out of login, reset and disable. Enable
 * needs the password, and signs out every other session when it succeeds.
 */
class TotpEnableTest {

    private static final String PASSWORD = "correct horse";
    private static final String TOKEN = "this-device";

    private final UserRepository users = mock(UserRepository.class);
    private final PasswordCredentialRepository creds = mock(PasswordCredentialRepository.class);
    private final SessionService sessions = mock(SessionService.class);
    private final TotpService totp = mock(TotpService.class);
    private final AuthService auth = new AuthService(users, creds,
            mock(EmailVerificationTokenRepository.class), mock(PasswordResetTokenRepository.class),
            mock(WhatsAppOtpTokenRepository.class), mock(MailService.class), sessions, null,
            mock(RateLimiter.class), mock(LoginAttemptGuard.class), null, "");
    private final User user = new User();

    @BeforeEach
    void account() {
        ReflectionTestUtils.setField(auth, "totp", totp);
        user.setId(UUID.randomUUID());
        user.setEmail("ada@example.com");
        PasswordCredential c = new PasswordCredential();
        c.setUserId(user.getId());
        c.setPasswordHash(new BCryptPasswordEncoder(4).encode(PASSWORD));
        when(users.findById(user.getId())).thenReturn(Optional.of(user));
        when(creds.findById(user.getId())).thenReturn(Optional.of(c));
        when(totp.enable(any(), anyString())).thenReturn(List.of("aaaaa-bbbbb"));
    }

    @Test
    void aWrongPasswordEnrollsNothing() {
        assertThatThrownBy(() -> auth.enableTotp(user.getId(), new TotpEnableRequest("guess", "123456"), TOKEN))
                .isInstanceOf(ApiException.class).hasMessageContaining("Password");
        verify(totp, never()).enable(any(), any());
        verify(sessions, never()).revokeOthers(any(), any());
    }

    @Test
    void theRightPasswordEnablesAndSignsOutOtherSessions() {
        RecoveryCodesResponse out = auth.enableTotp(user.getId(), new TotpEnableRequest(PASSWORD, "123456"), TOKEN);
        assertThat(out.recoveryCodes()).containsExactly("aaaaa-bbbbb");
        verify(sessions).revokeOthers(user.getId(), TOKEN);
    }

    @Test
    void aWrongCodeKeepsOtherSessions() {
        when(totp.enable(any(), anyString())).thenReturn(null);
        assertThatThrownBy(() -> auth.enableTotp(user.getId(), new TotpEnableRequest(PASSWORD, "000000"), TOKEN))
                .isInstanceOf(ApiException.class);
        verify(sessions, never()).revokeOthers(any(), any());
    }
}
