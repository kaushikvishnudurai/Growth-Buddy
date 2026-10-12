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
 *       any https URL; the socket is same-origin ({@code 'self'} covers ws/wss
 *       to the page's own host in CSP Level 3), plus any origin named in
 *       {@code growthbuddy.csp.connect-src} ({@code CSP_CONNECT_SRC}) for an API
 *       or socket on another host. It used to be {@code ws: wss:}, a socket to
 *       anywhere. Violations are POSTed to {@code /api/csp-report}
 *       ({@link CspReportController}), so a production build can be watched
 *       from the server log rather than one person's devtools.
 *       <b>Report-Only by default</b> ({@code growthbuddy.csp.enforce=false}): it
 *       has not yet been watched against a production build, and a wrong CSP
 *       blanks the app for everyone. Run a build with it, check the console
 *       for "[csp]" lines in the server log, then set {@code CSP_ENFORCE=true}.</li>
 * </ul>
 *
 * <p>The Capacitor shell loads its HTML from the device, not from here, so the
 * CSP never applies to it; its API calls only see the JSON-side headers.
 */
@Component
public class SecurityHeadersFilter extends OncePerRequestFilter {

    static String csp(String extraConnect) {
        String connect = ("'self' " + (extraConnect == null ? "" : extraConnect.replace(',', ' '))).trim();
        return String.join("; ",
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "media-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src " + connect,
            "worker-src 'self' blob:",
            "manifest-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "report-uri /api/csp-report");
    }

    private final ClientIp clientIp;
    private final boolean enforceCsp;
    private final String csp;

    public SecurityHeadersFilter(ClientIp clientIp,
                                 @Value("${growthbuddy.csp.enforce:${CSP_ENFORCE:false}}") boolean enforceCsp,
                                 @Value("${growthbuddy.csp.connect-src:${CSP_CONNECT_SRC:}}") String extraConnect) {
        this.clientIp = clientIp;
        this.enforceCsp = enforceCsp;
        this.csp = csp(extraConnect);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        if (clientIp.isHttps(request)) {
            response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
        }
        if (isDocument(request)) {
            response.setHeader(enforceCsp ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", csp);
        }
        chain.doFilter(request, response);
    }

    /** The shell: "/" and index.html. Set before the handler runs, so decided by path. */
    private static boolean isDocument(HttpServletRequest request) {
        String path = request.getRequestURI();
        return "/".equals(path) || path.endsWith(".html");
    }
}
