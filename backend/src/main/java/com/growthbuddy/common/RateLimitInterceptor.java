package com.growthbuddy.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Per-IP rate limiting for auth endpoints.
 * 10 attempts per 5-minute window. Returns HTTP 429 on violation.
 */
@Component
public class RateLimitInterceptor implements HandlerInterceptor {

    private static final int  LIMIT     = 10;
    private static final long WINDOW_MS = 5 * 60_000L;

    private final RateLimiter limiter;
    private final boolean trustProxy;

    public RateLimitInterceptor(RateLimiter limiter,
                                @Value("${growthbuddy.trust-proxy:false}") boolean trustProxy) {
        this.limiter = limiter;
        this.trustProxy = trustProxy;
    }

    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) throws IOException {
        String key = ClientIp.resolve(request, trustProxy) + ":" + request.getRequestURI();
        if (!limiter.allow(key, LIMIT, WINDOW_MS)) {
            response.setStatus(429);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write(
                "{\"message\":\"Too many attempts. Please wait a few minutes and try again.\"}");
            return false;
        }
        return true;
    }
}
