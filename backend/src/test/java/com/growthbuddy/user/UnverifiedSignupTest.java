package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/**
 * BUG-003: someone who signed up and never typed the code was stuck between
 * sign-in's "Wrong email or password" and signup's 409. The way out must open
 * only for the owner (same password), and a verified account must still get
 * the plain 409 it always got.
 */
class UnverifiedSignupTest {

    private static final String EMAIL = "ada@example.com";
    private static final String PASSWORD = "correct horse";

    private final UserRepository users = mock(UserRepository.class);
    private final PasswordCredentialRepository creds = mock(PasswordCredentialRepository.class);
    private final EmailVerificationTokenRepository verifyTokens = mock(EmailVerificationTokenRepository.class);
    private final MailService mail = mock(MailService.class);
    private final RateLimiter limiter = mock(RateLimiter.class);
    private final SessionService sessions = mock(SessionService.class);
    private final AuthService auth = new AuthService(users, creds, verifyTokens,
            mock(PasswordResetTokenRepository.class), mock(WhatsAppOtpTokenRepository.class),
            mail, sessions, null, limiter, mock(LoginAttemptGuard.class), null, "");
    private final User user = new User();

    @BeforeEach
    void account() {
        user.setId(UUID.randomUUID());
        user.setEmail(EMAIL);
        user.setEmailVerified(false);
        PasswordCredential c = new PasswordCredential();
        c.setUserId(user.getId());
        c.setPasswordHash(new BCryptPasswordEncoder().encode(PASSWORD));
        when(users.findByEmailIgnoreCase(EMAIL)).thenReturn(Optional.of(user));
        when(creds.findById(user.getId())).thenReturn(Optional.of(c));
        when(limiter.allow(anyString(), anyInt(), anyLong())).thenReturn(true);
        when(limiter.peek(anyString(), anyInt(), anyLong())).thenReturn(true);
    }

    @Test
    void unverifiedOwnerSigningUpAgainGetsAFreshCode() {
        AuthUserResponse out = auth.signup(new SignupRequest(EMAIL, PASSWORD, null, null));
        assertThat(out.emailVerified()).isFalse();
        verify(mail).sendOtp(eq(EMAIL), any(), anyString(), eq("verification"));
    }

    @Test
    void wrongPasswordOnAnUnverifiedAccountIsTheUsual409() {
        assertThatThrownBy(() -> auth.signup(new SignupRequest(EMAIL, "someone else", null, null)))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
        verify(mail, never()).sendOtp(any(), any(), any(), any());
    }

    @Test
    void verifiedAccountStillGetsThe409AndNoEmail() {
        user.setEmailVerified(true);
        assertThatThrownBy(() -> auth.signup(new SignupRequest(EMAIL, PASSWORD, null, null)))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
        verify(mail, never()).sendOtp(any(), any(), any(), any());
    }

    @Test
    void unverifiedSignInSendsACodeAndSaysSo() {
        assertThatThrownBy(() -> auth.login(new LoginRequest(EMAIL, PASSWORD), null))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
        verify(mail).sendOtp(eq(EMAIL), any(), anyString(), eq("verification"));
        verify(sessions, never()).issue(any(), any());
    }

    @Test
    void overTheCapNoMoreCodes() {
        // Only the per-account verification cap is spent; the cross-purpose
        // per-address cap (OtpMailCapTest) answers 429 even on resend.
        when(limiter.allow(org.mockito.ArgumentMatchers.startsWith("verifyotp:"), anyInt(), anyLong()))
                .thenReturn(false);
        assertThatThrownBy(() -> auth.signup(new SignupRequest(EMAIL, PASSWORD, null, null)))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        // resend stays silent over the cap: a refusal would confirm the account exists
        auth.resendVerification(new EmailOnlyRequest(EMAIL));
        verify(mail, never()).sendOtp(any(), any(), any(), any());
    }
}
