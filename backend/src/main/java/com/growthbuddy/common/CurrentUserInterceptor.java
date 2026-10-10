package com.growthbuddy.common;

import com.growthbuddy.user.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.AsyncHandlerInterceptor;

/**
 * Resolves the acting user for each request by validating the bearer token in
 * {@code Authorization: Bearer <token>}. Unauthenticated paths
 * ({@link #ANONYMOUS_PATHS}) skip the check. Everything else returns 401 when
 * the token is missing, unknown, expired, or revoked.
 *
 * <p>The legacy {@code X-User-Id} header is no longer trusted — a client could
 * spoof any user just by guessing/learning their id.
 */
@Component
public class CurrentUserInterceptor implements AsyncHandlerInterceptor {

    /**
     * Routes that may be hit without a session token. Everything else demands
     * a valid bearer token. We deny by default so a new endpoint doesn't
     * accidentally end up public.
     */
    private static final Set<String> ANONYMOUS_PATHS = Set.of(
            "/api/auth/signup",
            "/api/auth/login",
            "/api/auth/verify",
            "/api/auth/resend-verification",
            "/api/auth/forgot-password",
            "/api/auth/reset-password",
            "/api/auth/cancel-deletion", // a scheduled account has no sessions left; password-checked like login
            "/api/auth/logout", // idempotent: works without a session too
            "/api/whatsapp/webhook", // Meta calls it; authenticated by its HMAC signature instead
            "/api/reminders/snooze-link", // a push notification's Snooze button; a signed ticket instead (SnoozeLinks)
            "/api/client-errors", // crash reports; the sign-in screen crashes too. Rate-limited + size-capped (ClientErrorController)
            "/api/client-vitals" // RUM beacons (scripts/vitals.js); same rules as client-errors (ClientVitalsController)
    );

    private final SessionService sessions;

    public CurrentUserInterceptor(SessionService sessions) {
        this.sessions = sessions;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws java.io.IOException {
        String path = request.getRequestURI();
        // Only ANONYMOUS_PATHS skips the check. There used to be a second escape
        // here — `|| !path.startsWith("/api/")` — and it could only ever fire when
        // the raw URI spelled the path differently from the one Spring matched to
        // route the request (a percent-encoded letter, a doubled slash). This
        // interceptor is registered on "/api/**" and nothing else, so the framework
        // has already decided we are on an API path; re-deciding it from the raw
        // string could only disagree, and it disagreed by letting the request
        // through unauthenticated. An auth gate must fail closed.
        if (ANONYMOUS_PATHS.contains(path)) {
            return true;
        }
        String header = request.getHeader("Authorization");
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            return deny(response, "Missing bearer token");
        }
        String token = header.substring(7).trim();
        var userId = sessions.resolve(token);
        if (userId.isEmpty()) {
            return deny(response, "Invalid or expired session");
        }
        CurrentUser.set(userId.get());
        return true;
    }

    private boolean deny(HttpServletResponse response, String message) throws java.io.IOException {
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType("application/json");
        response.getWriter().write("{\"status\":401,\"error\":\"Unauthorized\",\"message\":\""
                + message + "\"}");
        return false;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        CurrentUser.clear();
    }

    /**
     * An async handler (the streamed Buddy reply) hands its request thread back
     * to Tomcat without {@link #afterCompletion} — that runs only after the later
     * ASYNC dispatch, on whichever thread serves it. Without this the user id
     * stayed in the pooled thread's ThreadLocal, and the next anonymous request
     * on it ({@code /api/client-errors}, say) would run as that user.
     */
    @Override
    public void afterConcurrentHandlingStarted(HttpServletRequest request, HttpServletResponse response,
                                               Object handler) {
        CurrentUser.clear();
    }
}
