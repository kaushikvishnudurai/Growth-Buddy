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
 * POST /api/csp-report — where the browser sends a Content-Security-Policy
 * violation ({@code report-uri} in {@link SecurityHeadersFilter}). Lands in the
 * server log as a {@code [csp]} line, which is what makes "watch it against
 * production, then set CSP_ENFORCE=true" possible at all.
 *
 * <p>Same rules as {@link ClientErrorController}: anonymous (a violation fires
 * on the sign-in screen too), per-IP rate-limited by {@code RateLimitInterceptor},
 * fields clipped and control characters stripped, nothing stored. The body is
 * read as text because browsers send {@code application/csp-report}, a type no
 * message converter claims; anything unparseable is dropped.
 */
@RestController
public class CspReportController {

    private static final Logger log = LoggerFactory.getLogger("csp");
    private static final ObjectMapper JSON = new ObjectMapper();

    @PostMapping("/api/csp-report")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void report(@RequestBody(required = false) String body) {
        if (body == null || body.length() > 16_384) return;
        JsonNode r;
        try {
            r = JSON.readTree(body).path("csp-report");
        } catch (Exception e) {
            return;
        }
        if (r.isMissingNode()) return;
        log.warn("[csp] directive={} blocked=\"{}\" doc=\"{}\" source=\"{}\" line={}",
                field(r, "effective-directive", 60), field(r, "blocked-uri", 200), field(r, "document-uri", 200),
                field(r, "source-file", 200), field(r, "line-number", 10));
    }

    private static String field(JsonNode r, String name, int max) {
        JsonNode v = r.get(name);
        return v == null || v.isNull() ? "" : ClientErrorController.clip(v.asText(), max);
    }
}
