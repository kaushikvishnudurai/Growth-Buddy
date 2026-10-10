package com.growthbuddy.common;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * POST /api/client-vitals — real-user performance numbers from scripts/vitals.js
 * (LCP, CLS, INP, TTFB and the app's own "home painted" mark), one beacon per
 * sampled page load, written as a single structured log line. Nothing stored.
 *
 * <p>Anonymous like {@link ClientErrorController} (exact path in
 * {@code CurrentUserInterceptor.ANONYMOUS_PATHS}) and per-IP rate-limited by
 * {@code RateLimitInterceptor}. The body arrives as {@code text/plain}: that is
 * what {@code navigator.sendBeacon(url, string)} sends, and it is CORS-safelisted,
 * so the Capacitor shell needs no preflight. Read as a String and parsed here;
 * anything over {@link #MAX_BODY} chars or not JSON is dropped. Numbers are
 * clamped, strings clipped and stripped of control characters, so a beacon
 * cannot forge log lines.
 */
@RestController
public class ClientVitalsController {

    private static final Logger log = LoggerFactory.getLogger("client-vitals");

    /** The real beacon is ~350 chars; this is generous. */
    static final int MAX_BODY = 2048;

    private final ObjectMapper mapper;

    public ClientVitalsController(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @PostMapping("/api/client-vitals")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void report(@RequestBody(required = false) String body) {
        if (body == null || body.isEmpty() || body.length() > MAX_BODY) return;
        JsonNode n;
        try {
            n = mapper.readTree(body);
        } catch (Exception e) {
            return;
        }
        if (n == null || !n.isObject()) return;
        log.info("[vitals] build={} screen={} lcp={} cls={} inp={} ttfb={} home={} conn={} ua=\"{}\"",
                ClientErrorController.clip(text(n, "build"), 12),
                ClientErrorController.clip(text(n, "screen"), 40),
                ms(n, "lcp"), cls(n), ms(n, "inp"), ms(n, "ttfb"), ms(n, "home"),
                ClientErrorController.clip(text(n, "conn"), 10),
                ClientErrorController.clip(text(n, "ua"), 200));
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() || v.isContainerNode() ? "" : v.asText();
    }

    /** Milliseconds, clamped to [0, 10 min]; anything non-numeric is 0. */
    static long ms(JsonNode n, String field) {
        JsonNode v = n.get(field);
        if (v == null || !v.isNumber()) return 0;
        double d = v.asDouble();
        if (Double.isNaN(d) || d < 0) return 0;
        return (long) Math.min(d, 600_000d);
    }

    /** Unitless layout-shift score, clamped to [0, 100], three decimals. */
    static String cls(JsonNode n) {
        JsonNode v = n.get("cls");
        if (v == null || !v.isNumber()) return "0";
        double d = v.asDouble();
        if (Double.isNaN(d) || d < 0) d = 0;
        return String.format(java.util.Locale.ROOT, "%.3f", Math.min(d, 100d));
    }
}
