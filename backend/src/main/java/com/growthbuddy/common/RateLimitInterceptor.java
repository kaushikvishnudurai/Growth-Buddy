package com.growthbuddy.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

/**
 * Per-IP rate limiting for auth endpoints (and the other paths WebConfig lists).
 * 10 attempts per 5-minute window; the anonymous ticket links get 60. Returns
 * HTTP 429 on violation.
 */
@Component
public class RateLimitInterceptor implements HandlerInterceptor {

    private static final int  LIMIT     = 10;
    private static final long WINDOW_MS = 5 * 60_000L;

    /* A push notification's Snooze / Done buttons: anonymous, but each carries an
       HMAC ticket, so they are only flood-limited. A morning of reminders taps
       more than 10 in five minutes on a shared NAT. */
    private static final Set<String> LOOSE = Set.of(
            "/api/reminders/snooze-link", "/api/reminders/done-link", "/api/habits/done-link");
    private static final int LOOSE_LIMIT = 60;

    private final RateLimiter limiter;
    private final ClientIp clientIp;

    public RateLimitInterceptor(RateLimiter limiter, ClientIp clientIp) {
        this.limiter = limiter;
        this.clientIp = clientIp;
    }

    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) throws IOException {
        String route = route(request);
        String key = clientIp.resolve(request) + ":" + route;
        if (!limiter.allow(key, LOOSE.contains(route) ? LOOSE_LIMIT : LIMIT, WINDOW_MS)) {
            response.setStatus(429);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write(
                "{\"message\":\"Too many attempts. Please wait a few minutes and try again.\"}");
            return false;
        }
        return true;
    }

    /**
     * The route Spring matched, not the raw URI: {@code /api/auth/export;x=1} and a
     * percent-encoded spelling reach the same handler, and keyed on the raw string
     * each spelling got a fresh bucket.
     */
    static String route(HttpServletRequest request) {
        Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        return pattern != null ? pattern.toString() : request.getRequestURI();
    }
}
