package com.growthbuddy.common;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Resolves the real client IP.
 *
 * <p>{@code X-Forwarded-For} is only honored when {@code trustProxy} is true —
 * i.e. the app runs behind a known reverse proxy / load balancer that sets it.
 * Trusting the header unconditionally lets any client spoof a fresh IP per
 * request and slip past per-IP rate limiting, so we default to the socket peer.
 *
 * <p>Even then only the RIGHT-most entry counts: a proxy appends the peer it saw
 * to whatever the client sent, so every entry to its left is the client's own
 * claim. The left-most one, used before, let anyone pick a fresh IP per request
 * (CRB-9 / SEC-6).
 */
public final class ClientIp {

    private ClientIp() {
    }

    // ponytail: assumes exactly one trusted hop (Render, Caddy). Behind two
    // (a CDN in front of Render) this yields the CDN's address; count hops from
    // the right then.
    public static String resolve(HttpServletRequest req, boolean trustProxy) {
        if (trustProxy) {
            String xf = req.getHeader("X-Forwarded-For");
            if (xf != null && !xf.isBlank()) {
                String last = xf.substring(xf.lastIndexOf(',') + 1).trim();
                if (!last.isEmpty()) {
                    return last;
                }
            }
        }
        return req.getRemoteAddr();
    }
}
