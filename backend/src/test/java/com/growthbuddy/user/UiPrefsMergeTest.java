package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.LoginAttemptGuard;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.mail.MailService;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * FN-03: the client now PUTs only the keys a save changed, so the server's
 * key-by-key merge is what keeps every other key. A tab open since yesterday
 * used to send its whole stale blob and revert what another device had saved.
 */
class UiPrefsMergeTest {

    @Test
    void aPatchChangesOnlyItsOwnKeys() {
        UserRepository users = mock(UserRepository.class);
        AuthService auth = new AuthService(users, mock(PasswordCredentialRepository.class),
                mock(EmailVerificationTokenRepository.class), mock(PasswordResetTokenRepository.class),
                mock(WhatsAppOtpTokenRepository.class), mock(MailService.class), mock(SessionService.class), null,
                mock(RateLimiter.class), mock(LoginAttemptGuard.class), null, "");
        User user = new User();
        user.setId(UUID.randomUUID());
        Map<String, Object> stored = new HashMap<>();
        stored.put("theme", "dark");
        stored.put("focusGoalMins", 90); // saved by the other device
        user.setUiPrefs(stored);
        when(users.findById(user.getId())).thenReturn(Optional.of(user));
        when(users.findForUpdate(user.getId())).thenReturn(Optional.of(user));

        Map<String, Object> patch = new HashMap<>();
        patch.put("theme", "light");
        auth.updateUiPrefs(user.getId(), patch);

        assertThat(user.getUiPrefs()).containsEntry("theme", "light").containsEntry("focusGoalMins", 90);
    }
}
