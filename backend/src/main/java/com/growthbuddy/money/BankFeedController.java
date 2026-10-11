package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Money's bank connection (Account Aggregator, via Setu): status, connect, sync
 * now, disconnect — and Setu's webhook. See {@link BankFeedService}.
 */
@RestController
@RequestMapping("/api/money/bank")
public class BankFeedController {

    private static final Logger log = LoggerFactory.getLogger(BankFeedController.class);

    private final BankFeedService feed;
    private final String webhookToken;
    private final ObjectMapper json;

    public BankFeedController(BankFeedService feed,
                              @Value("${growthbuddy.bankfeed.webhook-token:}") String webhookToken,
                              ObjectMapper json) {
        this.feed = feed;
        this.webhookToken = webhookToken;
        this.json = json;
    }

    /** {configured, consents}; configured false = the app hides "Connect your bank". */
    @GetMapping
    public ObjectNode status() {
        return feed.status(CurrentUser.id());
    }

    @PostMapping("/connect")
    public ObjectNode connect(@Valid @RequestBody ConnectRequest req) {
        return feed.connect(CurrentUser.id(), req.mobile());
    }

    @PostMapping("/sync")
    public ObjectNode sync() {
        return feed.syncNow(CurrentUser.id());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> disconnect(@PathVariable String id) {
        feed.disconnect(CurrentUser.id(), id);
        return ResponseEntity.noContent().build();
    }

    /**
     * Setu's notifications (configured on Bridge as
     * {@code <api>/api/money/bank/webhook?token=<SETU_WEBHOOK_TOKEN>}). Setu
     * documents no signature for these (docs.setu.co/data/account-aggregator/
     * api-integration/notifications), so the URL carries our own secret, and the
     * body is only ever a hint: the service re-reads the consent or session from
     * Setu with our credentials. Anonymous in CurrentUserInterceptor on that
     * basis. No token configured = every call refused.
     */
    @PostMapping("/webhook")
    public ResponseEntity<Void> webhook(@RequestParam(name = "token", required = false) String token,
                                        @RequestBody byte[] raw) {
        if (!tokenValid(webhookToken, token)) {
            return ResponseEntity.status(401).build();
        }
        try {
            JsonNode body = json.readTree(raw);
            feed.onNotification(body);
        } catch (Exception ex) {
            log.info("Bank webhook not handled: {}", ex.getClass().getSimpleName());
        }
        // 200 once authenticated: a failure here is retried by our own schedule, not Setu's redelivery.
        return ResponseEntity.ok().build();
    }

    static boolean tokenValid(String expected, String given) {
        return StringUtils.hasText(expected) && given != null
                && MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), given.getBytes(StandardCharsets.UTF_8));
    }

    record ConnectRequest(@Size(max = 20) String mobile) {
    }
}
