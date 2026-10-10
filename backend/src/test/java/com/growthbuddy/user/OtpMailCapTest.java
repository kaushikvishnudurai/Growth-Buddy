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
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.LoginAttemptGuard;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.mail.MailService;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/**
 * One cap on OTP emails per destination address, across every purpose. Each
 * flow already had its own 5/hour, so mixing signup-again, resend, reset and
 * email change could still send one inbox 15+ codes an hour.
 *
 * <p>The limiter is a counting stand-in (a call is allowed while its key's
 * count is within the limit): the window math is RateLimiter's own test; this
 * one asserts that every sending path spends the same per-address budget.
 */
class OtpMailCapTest {

    private static final String EMAIL = "ada@example.com";
    private static final String PASSWORD = "correct horse";

    private final UserRepository users = mock(UserRepository.class);
    private final PasswordCredentialRepository creds = mock(PasswordCredentialRepository.class);
    private final MailService mail = mock(MailService.class);
    private final RateLimiter limiter = mock(RateLimiter.class);
    private final Map<String, Integer> hits = new HashMap<>();
    private final AuthService auth = new AuthService(users, creds,
            mock(EmailVerificationTokenRepository.class), mock(PasswordResetTokenRepository.class),
            mock(WhatsAppOtpTokenRepository.class), mail, mock(SessionService.class), null, limiter,
            mock(LoginAttemptGuard.class), null, "");
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
        when(users.findById(user.getId())).thenReturn(Optional.of(user));
        when(creds.findById(user.getId())).thenReturn(Optional.of(c));
        when(limiter.allow(anyString(), anyInt(), anyLong())).thenAnswer(inv -> {
            String key = inv.getArgument(0);
            int limit = inv.getArgument(1);
            return hits.merge(key, 1, Integer::sum) <= limit;
        });
    }

    private static void assert429(Runnable call) {
        assertThatThrownBy(call::run)
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    @Test
    void mixingPurposesStillSpendsOneBudget() {
        // 2 + 2 + 1 = 5, each under its own per-purpose cap.
        auth.signup(new SignupRequest(EMAIL, PASSWORD, null, null));
        auth.signup(new SignupRequest(EMAIL, PASSWORD, null, null));
        auth.resendVerification(new EmailOnlyRequest(EMAIL));
        auth.resendVerification(new EmailOnlyRequest(EMAIL));
        auth.forgotPassword(new EmailOnlyRequest(EMAIL));
        verify(mail, times(AuthService.OTP_MAIL_PER_HOUR)).sendOtp(eq(EMAIL), any(), anyString(), anyString());

        assert429(() -> auth.forgotPassword(new EmailOnlyRequest(EMAIL)));
        assert429(() -> auth.resendVerification(new EmailOnlyRequest(EMAIL)));
        assert429(() -> auth.login(new LoginRequest(EMAIL, PASSWORD), null));
        verify(mail, times(AuthService.OTP_MAIL_PER_HOUR)).sendOtp(any(), any(), any(), any());
    }

    /* 5/h can't run all day: once the hourly window rolls over, the daily
       ceiling still stops the 11th code. Clearing every key but the daily one
       stands in for the hour passing (the per-purpose caps are hourly too). */
    @Test
    void theDailyCeilingHoldsAcrossHours() {
        Runnable anHourPasses = () -> hits.keySet().removeIf(k -> !k.startsWith("otpday:"));
        for (int i = 0; i < AuthService.OTP_MAIL_PER_DAY; i++) {
            if (i % AuthService.OTP_MAIL_PER_HOUR == 0) anHourPasses.run();
            auth.forgotPassword(new EmailOnlyRequest(EMAIL));
        }
        anHourPasses.run();
        assert429(() -> auth.forgotPassword(new EmailOnlyRequest(EMAIL)));
        verify(mail, times(AuthService.OTP_MAIL_PER_DAY)).sendOtp(any(), any(), any(), any());
    }

    @Test
    void addressCaseDoesNotBuyAFreshBudget() {
        for (int i = 0; i < AuthService.OTP_MAIL_PER_HOUR; i++) {
            auth.forgotPassword(new EmailOnlyRequest(EMAIL));
        }
        assert429(() -> auth.forgotPassword(new EmailOnlyRequest("  ADA@Example.com ")));
    }

    @Test
    void unknownAddressGetsTheSame429SoItIsNoOracle() {
        String stranger = "nobody@example.com";
        for (int i = 0; i < AuthService.OTP_MAIL_PER_HOUR; i++) {
            auth.forgotPassword(new EmailOnlyRequest(stranger));
        }
        assert429(() -> auth.forgotPassword(new EmailOnlyRequest(stranger)));
        assert429(() -> auth.resendVerification(new EmailOnlyRequest(stranger)));
        verify(mail, never()).sendOtp(any(), any(), any(), any());
    }

    @Test
    void emailChangeIsCappedOnTheAddressItMailsTo() {
        String target = "victim@example.com";
        for (int i = 0; i < AuthService.OTP_MAIL_PER_HOUR; i++) {
            auth.forgotPassword(new EmailOnlyRequest(target));
        }
        user.setEmailVerified(true);
        assert429(() -> auth.requestEmailChange(user.getId(), new ChangeEmailRequest(target, PASSWORD)));
        verify(mail, never()).sendOtp(eq(target), any(), any(), any());
    }

    @Test
    void freshSignupIsRefusedBeforeAnAccountIsCreated() {
        String fresh = "new@example.com";
        for (int i = 0; i < AuthService.OTP_MAIL_PER_HOUR; i++) {
            auth.resendVerification(new EmailOnlyRequest(fresh));
        }
        assert429(() -> auth.signup(new SignupRequest(fresh, PASSWORD, null, null)));
        verify(users, never()).save(any());
        assertThat(hits).containsKey("otpmail:" + fresh);
    }
}
