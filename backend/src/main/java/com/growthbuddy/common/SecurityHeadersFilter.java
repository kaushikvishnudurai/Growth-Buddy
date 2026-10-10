package com.growthbuddy.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Baseline security headers on every response — the API's JSON and the app shell
 * (index.html via IndexController, the bundle via WebConfig) alike. Caddy only
 * proxies, so nothing upstream adds them.
 *
 * <ul>
 *   <li>{@code X-Content-Type-Options: nosniff} — a JSON body or an uploaded sound
 *       is never re-read as script.</li>
 *   <li>{@code X-Frame-Options: DENY} + CSP {@code frame-ancestors 'none'} — no
 *       clickjacking frame around the sign-in or delete-account screens.</li>
 *   <li>{@code Referrer-Policy: strict-origin-when-cross-origin}.</li>
 *   <li>{@code Strict-Transport-Security} — only when the request actually arrived
 *       over HTTPS (directly, or per {@code X-Forwarded-Proto} when
 *       {@code growthbuddy.trust-proxy} is on). Sending it over plain http on
 *       localhost would pin a dev browser to https for a year.</li>
 *   <li>{@code Content-Security-Policy}, on HTML responses only (it means nothing
 *       on JSON). Written against what the shell does: every script, font and
 *       stylesheet is same-origin (fonts are @fontsource, bundled); styles need
 *       'unsafe-inline' because {@code h()} writes style attributes; images and
 *       sounds come from data:/blob: (photos, custom chimes) and avatars may be
 *       any https URL; the socket is same-origin ws/wss.
 *       <b>Report-Only by default</b> ({@code growthbuddy.csp.enforce=false}): it
 *       has not yet been watched against a production build, and a wrong CSP
 *       blanks the app for everyone. Run a build with it, check the console
 *       for "[Report Only]" violations, then set {@code CSP_ENFORCE=true}.</li>
 * </ul>
 *
 * <p>The Capacitor shell loads its HTML from the device, not from here, so the
 * CSP never applies to it; its API calls only see the JSON-side headers.
 */
@Component
public class SecurityHeadersFilter extends OncePerRequestFilter {

    static final String CSP = String.join("; ",
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "media-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self' ws: wss:",
            "worker-src 'self' blob:",
            "manifest-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'");

    private final boolean trustProxy;
    private final boolean enforceCsp;

    public SecurityHeadersFilter(@Value("${growthbuddy.trust-proxy:false}") boolean trustProxy,
                                 @Value("${growthbuddy.csp.enforce:${CSP_ENFORCE:false}}") boolean enforceCsp) {
        this.trustProxy = trustProxy;
        this.enforceCsp = enforceCsp;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        if (isHttps(request)) {
            response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
        }
        if (isDocument(request)) {
            response.setHeader(enforceCsp ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", CSP);
        }
        chain.doFilter(request, response);
    }

    private boolean isHttps(HttpServletRequest request) {
        if (request.isSecure()) return true;
        return trustProxy && "https".equalsIgnoreCase(request.getHeader("X-Forwarded-Proto"));
    }

    /** The shell: "/" and index.html. Set before the handler runs, so decided by path. */
    private static boolean isDocument(HttpServletRequest request) {
        String path = request.getRequestURI();
        return "/".equals(path) || path.endsWith(".html");
    }
}
