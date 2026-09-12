package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.user.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * The gate itself. Everything behind it trusts that a request which reaches a
 * handler has a validated session, so the only behaviour worth pinning here is
 * which requests get through without one.
 */
class CurrentUserInterceptorTest {

    private final SessionService sessions = mock(SessionService.class);
    private final CurrentUserInterceptor interceptor = new CurrentUserInterceptor(sessions);

    @AfterEach
    void clear() {
        CurrentUser.clear();
    }

    private static HttpServletRequest request(String uri, String authorization) {
        HttpServletRequest req = mock(HttpServletRequest.class);
        when(req.getRequestURI()).thenReturn(uri);
        when(req.getHeader("Authorization")).thenReturn(authorization);
        return req;
    }

    private static HttpServletResponse response() throws Exception {
        HttpServletResponse res = mock(HttpServletResponse.class);
        when(res.getWriter()).thenReturn(new PrintWriter(new StringWriter()));
        return res;
    }

    @Test
    void lettingLoginThroughWithoutAToken() throws Exception {
        assertThat(interceptor.preHandle(request("/api/auth/login", null), response(), null)).isTrue();
    }

    @Test
    void turningAwayAnApiCallWithNoToken() throws Exception {
        assertThat(interceptor.preHandle(request("/api/tasks", null), response(), null)).isFalse();
    }

    @Test
    void resolvingTheUserFromAValidToken() throws Exception {
        UUID id = UUID.randomUUID();
        when(sessions.resolve("good-token")).thenReturn(Optional.of(id));
        assertThat(interceptor.preHandle(request("/api/tasks", "Bearer good-token"), response(), null)).isTrue();
        assertThat(CurrentUser.id()).isEqualTo(id);
    }

    @Test
    void turningAwayATokenTheSessionStoreDoesNotKnow() throws Exception {
        when(sessions.resolve(any())).thenReturn(Optional.empty());
        assertThat(interceptor.preHandle(request("/api/tasks", "Bearer nope"), response(), null)).isFalse();
    }

    /**
     * The bypass this class used to have. Spring routes on the parsed path, so a
     * request spelled "/%61pi/quick-add" can still reach the /api/quick-add
     * handler — but getRequestURI() hands back the raw spelling, and the old
     * `!path.startsWith("/api/")` escape read that as "not an API call, let it
     * through". Any raw spelling that isn't an exact anonymous path must be
     * challenged, whatever it looks like.
     */
    @Test
    void refusingAPathThatDoesNotLookLikeAnApiPath() throws Exception {
        for (String odd : new String[] { "/%61pi/quick-add", "//api/tasks", "/api/../api/tasks", "/anything" }) {
            assertThat(interceptor.preHandle(request(odd, null), response(), null))
                    .as("unauthenticated request to %s", odd)
                    .isFalse();
        }
    }
}
