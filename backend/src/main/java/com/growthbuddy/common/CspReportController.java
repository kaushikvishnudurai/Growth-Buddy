package com.growthbuddy.common;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * POST /api/csp-report — where the browser sends Content-Security-Policy
 * violations ({@code report-uri} / {@code report-to} in {@link SecurityHeadersFilter}).
 * The policy is Report-Only until it has been watched against a production
 * build; without a collector that watching could never happen (SEC-3). One log
 * line per violation, nothing stored.
 *
 * <p>Anonymous, per-IP rate-limited and clipped exactly like
 * {@link ClientErrorController}. Read as a String: browsers send
 * {@code application/csp-report} (report-uri) or {@code application/reports+json}
 * (report-to), neither of which Jackson's converter accepts.
 */
@RestController
public class CspReportController {

    private static final Logger log = LoggerFactory.getLogger("csp-report");

    static final int MAX_BODY = 8192;
    /** A report-to batch can hold several; more than this in one POST is noise. */
    static final int MAX_REPORTS = 10;

    private final ObjectMapper mapper;

    public CspReportController(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @PostMapping("/api/csp-report")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void report(@RequestBody(required = false) String body) {
        if (body == null || body.isEmpty() || body.length() > MAX_BODY) return;
        try {
            summarize(mapper.readTree(body)).forEach(log::warn);
        } catch (Exception ignored) {
            // not JSON: dropped
        }
    }

    /** Both shapes: {"csp-report":{...kebab}} and [{type:"csp-violation", body:{...camel}}]. */
    static List<String> summarize(JsonNode n) {
        List<String> out = new ArrayList<>();
        if (n == null) return out;
        if (n.has("csp-report")) {
            JsonNode r = n.get("csp-report");
            out.add(line(r, "document-uri", "violated-directive", "blocked-uri", "source-file", "line-number"));
        } else if (n.isArray()) {
            for (JsonNode e : n) {
                if (out.size() >= MAX_REPORTS) break;
                JsonNode b = e.path("body");
                if (!b.isObject()) continue;
                out.add(line(b, "documentURL", "effectiveDirective", "blockedURL", "sourceFile", "lineNumber"));
            }
        }
        return out;
    }

    private static String line(JsonNode r, String doc, String directive, String blocked, String file, String lineNo) {
        return "[csp] directive=" + clip(r, directive, 60) + " blocked=\"" + clip(r, blocked, 200)
                + "\" doc=\"" + clip(r, doc, 200) + "\" at=\"" + clip(r, file, 200) + ":" + clip(r, lineNo, 8) + "\"";
    }

    private static String clip(JsonNode r, String field, int max) {
        JsonNode v = r.get(field);
        return ClientErrorController.clip(v == null || v.isNull() || v.isContainerNode() ? null : v.asText(), max);
    }
}
