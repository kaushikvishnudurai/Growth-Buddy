package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.UserZone;
import com.growthbuddy.reminder.WhatsAppService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Meta's WhatsApp webhook. Today it handles one thing: the "Mark as paid" button
 * on a subscription-due message.
 *
 * <p>Anonymous (Meta holds no session), so every POST must carry a valid
 * {@code X-Hub-Signature-256} over the raw body, keyed with the app secret. With
 * no secret configured every POST is refused — this endpoint writes money data.
 * The user comes from the verified sender number, never from the payload.
 */
@RestController
@RequestMapping("/api/whatsapp/webhook")
public class WhatsAppWebhookController {

    private static final Logger log = LoggerFactory.getLogger(WhatsAppWebhookController.class);

    private final String appSecret;
    private final String verifyToken;
    private final ObjectMapper json;
    private final UserRepository users;
    private final MoneyService money;
    private final WhatsAppService whatsapp;

    public WhatsAppWebhookController(
            @Value("${growthbuddy.whatsapp.meta.app-secret:}") String appSecret,
            @Value("${growthbuddy.whatsapp.meta.webhook-verify-token:}") String verifyToken,
            ObjectMapper json, UserRepository users, MoneyService money, WhatsAppService whatsapp) {
        this.appSecret = appSecret;
        this.verifyToken = verifyToken;
        this.json = json;
        this.users = users;
        this.money = money;
        this.whatsapp = whatsapp;
    }

    /** Meta's one-time subscription handshake. */
    @GetMapping
    public ResponseEntity<String> verify(@RequestParam(name = "hub.mode", required = false) String mode,
                                         @RequestParam(name = "hub.verify_token", required = false) String token,
                                         @RequestParam(name = "hub.challenge", required = false) String challenge) {
        if ("subscribe".equals(mode) && StringUtils.hasText(verifyToken)
                && MessageDigest.isEqual(verifyToken.getBytes(StandardCharsets.UTF_8),
                        String.valueOf(token).getBytes(StandardCharsets.UTF_8))) {
            return ResponseEntity.ok(challenge);
        }
        return ResponseEntity.status(403).build();
    }

    @PostMapping
    public ResponseEntity<Void> receive(@RequestBody byte[] raw,
                                        @RequestHeader(value = "X-Hub-Signature-256", required = false)
                                        String signature) {
        if (!signatureValid(appSecret, raw, signature)) {
            return ResponseEntity.status(401).build();
        }
        // Always 200 once signed: a non-2xx makes Meta redeliver the same bad event for days.
        JsonNode root;
        try {
            root = json.readTree(raw);
        } catch (Exception ex) {
            log.warn("WhatsApp webhook body unreadable: {}", ex.getMessage());
            return ResponseEntity.ok().build();
        }
        for (JsonNode entry : root.path("entry")) {
            for (JsonNode change : entry.path("changes")) {
                for (JsonNode msg : change.path("value").path("messages")) {
                    // Per message: one failure must not drop the rest of a batched delivery.
                    try {
                        handle(msg.path("from").asText(), buttonPayload(msg));
                    } catch (Exception ex) {
                        log.warn("WhatsApp webhook message not handled: {}", ex.getMessage());
                    }
                }
            }
        }
        return ResponseEntity.ok().build();
    }

    private void handle(String from, String payload) {
        if (payload == null || !payload.startsWith("paid:") || from.isEmpty()) {
            return;
        }
        int cut = payload.lastIndexOf(':');
        String subId = payload.substring("paid:".length(), Math.max(cut, "paid:".length()));
        String month = payload.substring(cut + 1);
        if (subId.isEmpty() || !month.matches("\\d{4}-\\d{2}")) {
            return;
        }
        for (User user : users.findByWhatsappNumberAndWhatsappEnabledTrueAndWhatsappVerifiedTrue("+" + from)) {
            LocalDate today = LocalDate.now(UserZone.of(user.getTimezone()));
            // Subscription ids are per-document, so at most the account that owns
            // this one matches; the others come back null and are skipped.
            MoneyService.Paid paid = money.markSubscriptionPaid(user.getId(), subId, month, today);
            if (paid == null) {
                continue;
            }
            // Say what actually happened: an old month's button, or a repeat tap,
            // books nothing, so it must not claim to have.
            String text = paid.booked()
                    ? "Marked " + paid.name() + " as paid. Nice one."
                    : paid.name() + " is already marked as paid, so nothing changed.";
            // The payment is already saved; a failed confirmation must not abort the
            // rest of the batch — Meta packs several messages into one delivery.
            try {
                whatsapp.reply(user.getWhatsappNumber(), text);
            } catch (Exception ex) {
                log.warn("Paid confirmation to {} failed: {}", user.getId(), ex.getMessage());
            }
        }
    }

    /** A template quick-reply arrives as "button"; an interactive reply as "interactive". */
    static String buttonPayload(JsonNode msg) {
        return switch (msg.path("type").asText()) {
            case "button" -> msg.path("button").path("payload").asText(null);
            case "interactive" -> msg.path("interactive").path("button_reply").path("id").asText(null);
            default -> null;
        };
    }

    static boolean signatureValid(String secret, byte[] raw, String header) {
        if (!StringUtils.hasText(secret) || header == null || !header.startsWith("sha256=") || raw == null) {
            return false;
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String expected = "sha256=" + HexFormat.of().formatHex(mac.doFinal(raw));
            return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                    header.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            return false;
        }
    }
}
