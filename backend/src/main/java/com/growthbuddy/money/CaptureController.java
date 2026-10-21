package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.growthbuddy.common.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Automatic expense capture: which sources are on, what the phone read, and the
 * iPhone Shortcut's message. See {@link CaptureService}.
 */
@RestController
@RequestMapping("/api/capture")
public class CaptureController {

    private final CaptureService capture;
    private final ObjectMapper json;

    public CaptureController(CaptureService capture, ObjectMapper json) {
        this.capture = capture;
        this.json = json;
    }

    /** {sources: {notif, sms, ios: {enabled, lastSeenAt, hasToken?}}, rupees}. */
    @GetMapping
    public ObjectNode status() {
        return capture.status(CurrentUser.id());
    }

    /** {enabled}. Switching the iPhone Shortcut on answers its token once, in {@code token}. */
    @PutMapping("/{source}")
    public ObjectNode set(@PathVariable String source, @RequestBody JsonNode body) {
        return capture.setEnabled(CurrentUser.id(), source, body.path("enabled").asBoolean(false));
    }

    @PostMapping("/ios/token")
    public ObjectNode rotate() {
        return json.createObjectNode().put("token", capture.rotateToken(CurrentUser.id()));
    }

    /** {items: [{via, origin, kind, amount, merchant, last4, ref, date, at, msgHash, confidence, channel, category}]}. */
    @PostMapping
    public ObjectNode ingest(@RequestBody JsonNode body) {
        return capture.ingestFromApp(CurrentUser.id(), body).toJson(json);
    }

    /** Removes every row that source created; turning it off alone keeps them. */
    @DeleteMapping("/{via}/rows")
    public ObjectNode deleteRows(@PathVariable String via) {
        return json.createObjectNode().put("deleted", capture.deleteCaptured(CurrentUser.id(), via));
    }

    /**
     * The iPhone Shortcut, on a bank SMS: {@code X-Capture-Token} + {@code {text}}.
     * Anonymous in CurrentUserInterceptor; the token is the user's. A text that is no
     * payment answers 200 too (the Shortcut's keyword trigger also fires on other
     * messages), and so does an unknown token's 401 body stay empty: nothing to learn.
     */
    @PostMapping("/ios/message")
    public ResponseEntity<ObjectNode> iosMessage(@RequestHeader(name = "X-Capture-Token", required = false) String token,
                                          @RequestBody(required = false) JsonNode body) {
        String text = body == null ? null : body.path("text").asText(null);
        CaptureService.Result r = capture.ingestText(token, text);
        if (r == null) {
            return ResponseEntity.status(401).build();
        }
        return ResponseEntity.ok(r.toJson(json));
    }
}
