package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.growthbuddy.common.ApiException;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** SEC-06 and SEC-08: what a people search matches and shows, and how big prefs may grow. */
class PeopleSearchTest {

    @Test
    void wildcardsAreLiteral() {
        assertThat(UserRepository.likeEscape("_")).isEqualTo("!_");
        assertThat(UserRepository.likeEscape("50%")).isEqualTo("50!%");
        assertThat(UserRepository.likeEscape("a!b")).isEqualTo("a!!b");
        assertThat(UserRepository.likeEscape("Asha")).isEqualTo("Asha");
    }

    @Test
    void theMaskCarriesNoDomain() {
        assertThat(UserRepository.maskEmail("alice@example.com")).isEqualTo("a•••e");
        assertThat(UserRepository.maskEmail("al@x.io")).doesNotContain("x.io");
        assertThat(UserRepository.maskEmail("a@x.io")).isEqualTo("•••");
        assertThat(UserRepository.maskEmail(null)).isNull();
    }

    @Test
    void prefsWithinTheCapsSaveAndBeyondThemAreRefused() {
        Map<String, Object> ok = new HashMap<>(Map.of("theme", "dark", "lang", "en"));
        assertThatCode(() -> AuthService.requireBounded(null, ok, AuthService.MAX_UI_PREF_KEYS, "UI")).doesNotThrowAnyException();

        Map<String, Object> huge = new HashMap<>(Map.of("blob", "x".repeat(AuthService.MAX_PREFS_BYTES)));
        assertThatThrownBy(() -> AuthService.requireBounded(Map.of(), huge, AuthService.MAX_UI_PREF_KEYS, "UI"))
                .isInstanceOf(ApiException.class).hasMessageContaining("too large");

        Map<String, Object> many = new HashMap<>();
        for (int i = 0; i <= AuthService.MAX_FEATURE_KEYS; i++) many.put("f" + i, true);
        assertThatThrownBy(() -> AuthService.requireBounded(Map.of(), many, AuthService.MAX_FEATURE_KEYS, "Feature"))
                .isInstanceOf(ApiException.class);
    }

    /** An account already over a cap (saved before the cap existed) can still save a shrink or a same-size edit. */
    @Test
    void anOverCapBlobCanStillShrinkButNotGrow() {
        Map<String, Object> over = new HashMap<>(Map.of("blob", "x".repeat(AuthService.MAX_PREFS_BYTES), "theme", "dark"));
        Map<String, Object> sameSize = new HashMap<>(over);
        sameSize.put("theme", "lite");
        assertThatCode(() -> AuthService.requireBounded(over, sameSize, AuthService.MAX_UI_PREF_KEYS, "UI"))
                .doesNotThrowAnyException();
        Map<String, Object> shrunk = new HashMap<>(over);
        shrunk.remove("theme");
        assertThatCode(() -> AuthService.requireBounded(over, shrunk, AuthService.MAX_UI_PREF_KEYS, "UI"))
                .doesNotThrowAnyException();
        Map<String, Object> grown = new HashMap<>(over);
        grown.put("lang", "en");
        assertThatThrownBy(() -> AuthService.requireBounded(over, grown, AuthService.MAX_UI_PREF_KEYS, "UI"))
                .isInstanceOf(ApiException.class);

        Map<String, Object> many = new HashMap<>();
        for (int i = 0; i <= AuthService.MAX_FEATURE_KEYS; i++) many.put("f" + i, true);
        Map<String, Object> flipped = new HashMap<>(many);
        flipped.put("f0", false);
        assertThatCode(() -> AuthService.requireBounded(many, flipped, AuthService.MAX_FEATURE_KEYS, "Feature"))
                .doesNotThrowAnyException();
    }
}
