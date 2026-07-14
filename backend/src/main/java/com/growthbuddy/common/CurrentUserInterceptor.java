package com.growthbuddy.common;

import com.growthbuddy.user.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

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
public class CurrentUserInterceptor implements HandlerInterceptor {

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
            "/api/auth/logout", // idempotent: works without a session too
            // Google's browser redirect after calendar consent; carries no bearer
            // token — the user is identified by the short-lived `state` param.
            "/api/google/calendar/callback"
    );

    private final SessionService sessions;

    public CurrentUserInterceptor(SessionService sessions) {
        this.sessions = sessions;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws java.io.IOException {
        String path = request.getRequestURI();
        if (ANONYMOUS_PATHS.contains(path) || !path.startsWith("/api/")) {
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
}
