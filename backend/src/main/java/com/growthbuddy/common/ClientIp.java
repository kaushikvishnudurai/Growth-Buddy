package com.growthbuddy.common;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Resolves the real client IP, and whether the request arrived over HTTPS.
 *
 * <p>Forwarded headers are only honored when {@code growthbuddy.trust-proxy}
 * ({@code TRUST_PROXY}) is on, i.e. the app runs behind a reverse proxy that
 * sets them. Off, the socket peer is the client, so a spoofed header changes
 * nothing.
 *
 * <p>On, the client is the entry {@code trusted-proxy-hops} ({@code TRUST_PROXY_HOPS},
 * default 1) from the RIGHT of {@code X-Forwarded-For}. Each proxy APPENDS the
 * peer it saw, so the left end is whatever the client chose to send; reading it
 * handed every request a fresh, attacker-picked rate-limit bucket. The rightmost
 * entry was written by our own proxy. With N proxies in a row (a CDN, then a load
 * balancer), each appends one, so the client is N from the right.
 *
 * <p>To check the hop count on a new host, set
 * {@code logging.level.com.growthbuddy.common.ClientIp=DEBUG}: every resolve logs
 * the raw header next to the address it picked.
 */
@Component
public class ClientIp {

    private static final Logger log = LoggerFactory.getLogger(ClientIp.class);

    private final boolean trustProxy;
    private final int hops;

    public ClientIp(@Value("${growthbuddy.trust-proxy:false}") boolean trustProxy,
                    @Value("${growthbuddy.trusted-proxy-hops:1}") int hops) {
        this.trustProxy = trustProxy;
        this.hops = Math.max(1, hops);
    }

    public String resolve(HttpServletRequest req) {
        if (!trustProxy) return req.getRemoteAddr();
        String xf = req.getHeader("X-Forwarded-For");
        String ip = pick(xf, hops);
        if (log.isDebugEnabled()) log.debug("X-Forwarded-For=\"{}\" peer={} -> {}", xf, req.getRemoteAddr(), ip);
        return ip != null ? ip : req.getRemoteAddr();
    }

    /** True when the request reached the edge over HTTPS (directly, or per the trusted proxy). */
    public boolean isHttps(HttpServletRequest req) {
        if (req.isSecure()) return true;
        return trustProxy && "https".equalsIgnoreCase(req.getHeader("X-Forwarded-Proto"));
    }

    /**
     * The entry {@code hops} from the right of a comma-separated forwarded list, or
     * null when there is none. Fewer entries than hops means only our own proxies
     * wrote it, so the leftmost one is the client. Pure, for the tests.
     */
    static String pick(String xff, int hops) {
        if (xff == null || xff.isBlank()) return null;
        String[] parts = xff.split(",");
        String ip = parts[Math.max(0, parts.length - hops)].trim();
        return ip.isEmpty() ? null : ip;
    }
}
