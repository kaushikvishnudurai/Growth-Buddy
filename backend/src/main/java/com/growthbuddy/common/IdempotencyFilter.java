package com.growthbuddy.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;

/**
 * Half of the {@code Idempotency-Key} support: the part that has to wrap the
 * response. The other half, {@link IdempotencyInterceptor}, reserves the key —
 * it must run after {@link CurrentUserInterceptor} has resolved the user, which a
 * servlet filter runs before, so the work is split at that line.
 *
 * <p>For an authenticated {@code POST/PUT/PATCH/DELETE} under {@code /api/}
 * carrying the header, the response is buffered in a
 * {@link ContentCachingResponseWrapper}; if the interceptor reserved the key,
 * the finished status + body are stored for replay (2xx and 4xx, except 408 /
 * 429, which say "try later" and must not be replayed as the final word). A 5xx,
 * a throw, or a body over {@link #MAX_STORED_BYTES} releases the key so the
 * retry runs for real.
 *
 * <p>Skipped: {@code /api/auth/**} (sessions, 2FA secrets and OTP flows have no
 * business sitting in a replay cache, and none of them is queued offline), and
 * streamed replies (SSE): buffering one would hold the whole stream until it
 * ended, and an async request finishes after this filter has returned.
 */
@Component
public class IdempotencyFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(IdempotencyFilter.class);

    public static final String HEADER = "Idempotency-Key";
    public static final String REPLAY_HEADER = "Idempotent-Replay";
    static final Pattern VALID_KEY = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    /** What a replay keeps; MEDIUMTEXT would take far more, the table should not. */
    static final int MAX_STORED_BYTES = 256 * 1024;

    /** Set by this filter: the key, on a request whose response is being captured. */
    static final String KEY_ATTR = IdempotencyFilter.class.getName() + ".key";
    /** Set by the interceptor once it holds the reservation. */
    static final String RESERVED_ATTR = IdempotencyFilter.class.getName() + ".reserved";

    record Reservation(UUID userId, String key) {
    }

    private static final Set<String> METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");

    private final IdempotencyStore store;

    public IdempotencyFilter(IdempotencyStore store) {
        this.store = store;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        if (request.getHeader(HEADER) == null) return true;
        if (!path.startsWith("/api/") || path.startsWith("/api/auth/")) return true;
        if (!METHODS.contains(request.getMethod().toUpperCase())) return true;
        if (path.endsWith("/stream")) return true;
        String accept = request.getHeader("Accept");
        return accept != null && accept.contains("text/event-stream");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String key = request.getHeader(HEADER).trim();
        if (!VALID_KEY.matcher(key).matches()) {
            writeJson(response, 400, "Idempotency-Key must be 1-64 letters, digits, '-' or '_'.", null);
            return;
        }
        request.setAttribute(KEY_ATTR, key);
        ContentCachingResponseWrapper wrapped = new ContentCachingResponseWrapper(response);
        boolean finished = false;
        try {
            chain.doFilter(request, wrapped);
            finished = true;
        } finally {
            settle(request, wrapped, finished);
        }
        wrapped.copyBodyToResponse();
    }

    private void settle(HttpServletRequest request, ContentCachingResponseWrapper wrapped, boolean finished) {
        if (!(request.getAttribute(RESERVED_ATTR) instanceof Reservation r)) return;
        try {
            int status = wrapped.getStatus();
            byte[] body = wrapped.getContentAsByteArray();
            boolean keep = finished && !request.isAsyncStarted() && storable(status)
                    && body.length <= MAX_STORED_BYTES;
            if (keep) {
                store.complete(r.userId(), r.key(), status, wrapped.getContentType(),
                        new String(body, StandardCharsets.UTF_8));
            } else {
                store.release(r.userId(), r.key());
            }
        } catch (RuntimeException e) {
            // The handler's answer still goes out; only the replay is lost. Try to
            // free the key so a retry is not 409'd until the stale window passes.
            log.warn("idempotency: could not settle key for {}: {}", r.userId(), e.getMessage());
            try {
                store.release(r.userId(), r.key());
            } catch (RuntimeException ignored) {
                // the stale-takeover in reserve() is the backstop
            }
        }
    }

    static boolean storable(int status) {
        if (status >= 200 && status < 300) return true;
        return status >= 400 && status < 500 && status != 408 && status != 429;
    }

    static void writeJson(HttpServletResponse response, int status, String message, String code)
            throws IOException {
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        String json = "{\"status\":" + status + ",\"message\":\"" + message + "\""
                + (code == null ? "" : ",\"code\":\"" + code + "\"") + "}";
        response.getOutputStream().write(json.getBytes(StandardCharsets.UTF_8));
    }
}
