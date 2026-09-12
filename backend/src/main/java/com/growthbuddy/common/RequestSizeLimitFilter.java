package com.growthbuddy.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Caps the size of an API request body.
 *
 * <p>The photo endpoints declare {@code @Size(max = 2_000_000)} on their data-URL
 * field, but bean validation runs <em>after</em> Jackson has already read the
 * whole body into a String — so the annotation bounds what we accept, not what we
 * allocate. Nothing else bounded it: Tomcat's {@code maxPostSize} covers form
 * encoding only, and {@code spring.servlet.multipart.*} covers multipart only.
 * Neither sees a {@code Content-Type: application/json} body, which is every
 * write this API takes. One logged-in client posting a few hundred MB of JSON was
 * enough to exhaust the heap on a 512 MB dyno for everyone.
 *
 * <p>Checked before the body is read, so an oversized request costs nothing.
 */
@Component
public class RequestSizeLimitFilter extends OncePerRequestFilter {

    /** Generous: 4x the largest field any endpoint declares, plus the JSON around it. */
    static final long MAX_BODY_BYTES = 8L * 1024 * 1024;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        long declared = request.getContentLengthLong();
        if (declared > MAX_BODY_BYTES) {
            deny(response, HttpStatus.PAYLOAD_TOO_LARGE, "That upload is too large.");
            return;
        }
        // A chunked body declares no length, so the check above can't see it — and
        // that is exactly the shape a hand-rolled client would use to walk around
        // the cap. No browser or Capacitor client sends one (fetch sets
        // Content-Length for a string body), so refusing it costs us nothing.
        if (declared < 0 && hasBody(request)) {
            deny(response, HttpStatus.LENGTH_REQUIRED, "Content-Length is required.");
            return;
        }
        chain.doFilter(request, response);
    }

    private static boolean hasBody(HttpServletRequest request) {
        String method = request.getMethod();
        return "POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method);
    }

    private static void deny(HttpServletResponse response, HttpStatus status, String message)
            throws IOException {
        response.setStatus(status.value());
        response.setContentType("application/json");
        response.getWriter().write("{\"status\":" + status.value() + ",\"error\":\""
                + status.getReasonPhrase() + "\",\"message\":\"" + message + "\"}");
    }
}
