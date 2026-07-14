package com.growthbuddy.common;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Resolves the real client IP.
 *
 * <p>{@code X-Forwarded-For} is only honored when {@code trustProxy} is true —
 * i.e. the app runs behind a known reverse proxy / load balancer that sets it.
 * Trusting the header unconditionally lets any client spoof a fresh IP per
 * request and slip past per-IP rate limiting, so we default to the socket peer.
 */
public final class ClientIp {

    private ClientIp() {
    }

    public static String resolve(HttpServletRequest req, boolean trustProxy) {
        if (trustProxy) {
            String xf = req.getHeader("X-Forwarded-For");
            if (xf != null && !xf.isBlank()) {
                int comma = xf.indexOf(',');
                return comma > 0 ? xf.substring(0, comma).trim() : xf.trim();
            }
        }
        return req.getRemoteAddr();
    }
}
