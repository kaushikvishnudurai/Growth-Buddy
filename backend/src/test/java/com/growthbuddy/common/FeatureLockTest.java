package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.growthbuddy.user.AdminAccess;
import com.growthbuddy.user.FeatureLocks;
import com.growthbuddy.user.FeatureLocks.Lock;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** An operator lock beats the user's own switch, and a locked feature takes no writes. */
class FeatureLockTest {

    private static final UUID ANA = UUID.randomUUID();
    private static final UUID BEN = UUID.randomUUID();

    @AfterEach
    void reset() {
        FeatureLocks.use(List.of());
        CurrentUser.clear();
    }

    @Test
    void aLockForcesTheFeatureOffWhateverTheUserChose() {
        FeatureLocks.use(List.of(new Lock("money", "*", null), new Lock("mentor", ANA.toString(), "abuse")));

        Map<String, Boolean> ana = FeatureLocks.effective(ANA, Map.of("money", true, "habits", false));
        assertThat(ana).containsEntry("money", false).containsEntry("mentor", false).containsEntry("habits", false);
        assertThat(FeatureLocks.lockedFor(ANA)).containsExactly("mentor", "money");

        // Ben has only the everyone lock, and the user's prefs map is not mutated.
        assertThat(FeatureLocks.effective(BEN, null)).isEqualTo(Map.of("money", false));
        assertThat(FeatureLocks.isLocked(BEN, "mentor")).isFalse();
    }

    @Test
    void routesMapToTheirFeature() {
        assertThat(FeatureLockInterceptor.featureOf("/api/money/bank/connect")).isEqualTo("money");
        assertThat(FeatureLockInterceptor.featureOf("/api/mentor")).isEqualTo("mentor");
        assertThat(FeatureLockInterceptor.featureOf("/api/mentorship/requests")).isEqualTo("circle");
        assertThat(FeatureLockInterceptor.featureOf("/api/reminders/{id}")).isEqualTo("calendar");
        assertThat(FeatureLockInterceptor.featureOf("/api/moneyx")).isNull();
        assertThat(FeatureLockInterceptor.featureOf("/api/auth/features")).isNull();
    }

    @Test
    void aLockedFeatureRefusesWritesButNotReads() {
        FeatureLocks.use(List.of(new Lock("habits", ANA.toString(), null)));
        var interceptor = new FeatureLockInterceptor();
        var res = new MockHttpServletResponse();

        CurrentUser.set(ANA);
        assertThat(interceptor.preHandle(new MockHttpServletRequest("GET", "/api/habits"), res, null)).isTrue();
        assertThatThrownBy(() -> interceptor.preHandle(new MockHttpServletRequest("POST", "/api/habits"), res, null))
                .isInstanceOf(ApiException.class);

        CurrentUser.set(BEN);
        assertThat(interceptor.preHandle(new MockHttpServletRequest("POST", "/api/habits"), res, null)).isTrue();
    }

    /** The anonymous Done links pass no user, so they check the owner themselves. */
    @Test
    void anAnonymousLinkRefusesALockedOwner() {
        FeatureLocks.use(List.of(new Lock("habits", ANA.toString(), null)));

        assertThatThrownBy(() -> FeatureLocks.refuseIfLocked(ANA, "habits")).isInstanceOf(ApiException.class);
        FeatureLocks.refuseIfLocked(BEN, "habits");
    }

    /** A visitor with no token: 404 under the portal (nothing to see), 401 everywhere else. */
    @Test
    void aVisitorToThePortalGetsANotFound() throws Exception {
        var interceptor = new CurrentUserInterceptor(null);

        var portal = new MockHttpServletResponse();
        assertThat(interceptor.preHandle(new MockHttpServletRequest("GET", "/api/admin/feature-locks"), portal, null))
                .isFalse();
        assertThat(portal.getStatus()).isEqualTo(404);

        var app = new MockHttpServletResponse();
        assertThat(interceptor.preHandle(new MockHttpServletRequest("GET", "/api/habits"), app, null)).isFalse();
        assertThat(app.getStatus()).isEqualTo(401);
    }

    @Test
    void adminIsOnlyTheListedEmails() {
        assertThat(AdminAccess.isAdmin(null)).isFalse();
        assertThat(AdminAccess.isAdmin("  ")).isFalse();
        assertThat(AdminAccess.isAdmin("nobody@example.com")).isFalse();
    }
}
