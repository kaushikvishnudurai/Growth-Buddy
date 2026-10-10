package com.growthbuddy.common;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * POST /api/client-errors — the frontend's crash reporter (scripts/error-report.js)
 * posts an uncaught error or unhandled rejection here, and it lands in the server
 * log, which is the only log anyone reads. Without it a crash on someone's phone
 * was invisible unless they happened to say so.
 *
 * <p>Anonymous on purpose (in {@code CurrentUserInterceptor.ANONYMOUS_PATHS}): the
 * boot and sign-in screens crash too, before there is a session. So it is
 * treated as untrusted input: per-IP rate-limited by {@code RateLimitInterceptor},
 * every field length-capped, and control characters stripped so a report cannot
 * forge extra log lines. Nothing is stored.
 */
@RestController
public class ClientErrorController {

    private static final Logger log = LoggerFactory.getLogger("client-error");

    @PostMapping("/api/client-errors")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void report(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null) return;
        log.warn("[client] build={} screen={} kind={} msg=\"{}\" at={} ua=\"{}\" stack=\"{}\"",
                clip(body.get("build"), 12), clip(body.get("screen"), 40), clip(body.get("kind"), 20),
                clip(body.get("message"), 500), clip(body.get("source"), 200),
                clip(body.get("ua"), 200), clip(body.get("stack"), 2000));
    }

    static String clip(Object v, int max) {
        if (v == null) return "";
        String s = String.valueOf(v).replaceAll("[\\p{Cntrl}&&[^\\n]]", " ").replace('\n', '|');
        return s.length() > max ? s.substring(0, max) + "…" : s;
    }
}
