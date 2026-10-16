package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.DeliveryCache;
import com.growthbuddy.common.LoginAttemptGuard;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * A ui_prefs save is a bulk update, so it reloads the delivery schedulers only
 * when a key their snapshot reads moved; a null deletes a key; the blob is capped.
 */
class UiPrefsTest {

    private final UserRepository users = mock(UserRepository.class);
    private final AuthService auth = new AuthService(users, mock(PasswordCredentialRepository.class),
            mock(EmailVerificationTokenRepository.class), mock(PasswordResetTokenRepository.class),
            mock(WhatsAppOtpTokenRepository.class), null, mock(SessionService.class), null, null,
            mock(LoginAttemptGuard.class), null, "");
    private final User user = new User();

    UiPrefsTest() {
        user.setId(UUID.randomUUID());
        user.setUiPrefs(new HashMap<>(Map.of("theme", "dark", "reminderLead", 10)));
        when(users.findById(user.getId())).thenReturn(Optional.of(user));
        when(users.findForUpdate(user.getId())).thenReturn(Optional.of(user));
    }

    @Test
    void onlyASchedulerKeyReloadsTheSchedulers() {
        long v = DeliveryCache.version();
        auth.updateUiPrefs(user.getId(), Map.of("theme", "light"));
        assertThat(DeliveryCache.version()).isEqualTo(v);
        auth.updateUiPrefs(user.getId(), Map.of("reminderLead", 15));
        assertThat(DeliveryCache.version()).isGreaterThan(v);
    }

    @Test
    void aNullValueDeletesTheKey() {
        Map<String, Object> patch = new HashMap<>();
        patch.put("theme", null);
        assertThat(AuthService.mergeUiPrefs(Map.of("theme", "dark", "a", 1), patch)).isEqualTo(Map.of("a", 1));
    }

    @Test
    void anOversizedBlobIsRefused() {
        Map<String, Object> many = new HashMap<>();
        for (int i = 0; i <= AuthService.MAX_UI_PREF_KEYS; i++) many.put("k" + i, i);
        assertThatThrownBy(() -> auth.updateUiPrefs(user.getId(), many)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> auth.updateUiPrefs(user.getId(),
                Map.of("big", "x".repeat(AuthService.MAX_PREFS_BYTES)))).isInstanceOf(ApiException.class);
    }
}
