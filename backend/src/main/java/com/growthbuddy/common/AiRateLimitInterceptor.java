package com.growthbuddy.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Per-user rate limit on the OpenAI-backed endpoints (mentor, quick-add, money
 * advice, nutrition suggestion). These cost money per call, so an authenticated
 * user shouldn't be able to hammer them. Keyed by user id (falls back to IP).
 * Runs after {@link CurrentUserInterceptor}, so the user is already resolved.
 */
@Component
public class AiRateLimitInterceptor implements HandlerInterceptor {

    private static final int  LIMIT     = 40;
    private static final long WINDOW_MS = 60 * 60_000L; // 40 AI calls per hour

    private final RateLimiter limiter;
    private final boolean trustProxy;

    public AiRateLimitInterceptor(RateLimiter limiter,
                                  @Value("${growthbuddy.trust-proxy:false}") boolean trustProxy) {
        this.limiter = limiter;
        this.trustProxy = trustProxy;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {
        String who;
        try {
            who = "u:" + CurrentUser.id();
        } catch (RuntimeException e) {
            who = "ip:" + ClientIp.resolve(request, trustProxy);
        }
        if (!limiter.allow("ai:" + who, LIMIT, WINDOW_MS)) {
            response.setStatus(429);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write(
                "{\"message\":\"You've used the AI features a lot in the last hour — take a short break and try again.\"}");
            return false;
        }
        return true;
    }
}
