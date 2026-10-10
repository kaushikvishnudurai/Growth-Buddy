package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.UserZone;
import com.growthbuddy.reminder.ReminderSnoozeService;
import com.growthbuddy.reminder.WhatsAppService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
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
 * Meta's WhatsApp webhook: the "Mark as paid" button on a subscription-due
 * message, and snoozing a reminder — its "Snooze" button, or a typed reply of
 * SNOOZE (optionally "snooze 20") meaning the reminder that reached them last.
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
    private final ReminderSnoozeService snoozes;

    /** "snooze", "Snooze 20", "snooze 15 min" — and nothing else, so a chatty reply isn't taken for one. */
    static final Pattern SNOOZE_REPLY =
            Pattern.compile("^\\s*snooze(?:\\s+(\\d{1,3})\\s*(?:m|min|mins|minutes?)?)?\\s*[.!]?\\s*$",
                    Pattern.CASE_INSENSITIVE);

    public WhatsAppWebhookController(
            @Value("${growthbuddy.whatsapp.meta.app-secret:}") String appSecret,
            @Value("${growthbuddy.whatsapp.meta.webhook-verify-token:}") String verifyToken,
            ObjectMapper json, UserRepository users, MoneyService money, WhatsAppService whatsapp,
            ReminderSnoozeService snoozes) {
        this.appSecret = appSecret;
        this.verifyToken = verifyToken;
        this.json = json;
        this.users = users;
        this.money = money;
        this.whatsapp = whatsapp;
        this.snoozes = snoozes;
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
                        String from = msg.path("from").asText();
                        String payload = buttonPayload(msg);
                        if (payload != null && payload.startsWith("snooze:")) {
                            snoozeButton(from, payload.substring("snooze:".length()));
                        } else if (payload != null) {
                            handle(from, payload);
                        } else {
                            snoozeReply(from, textBody(msg));
                        }
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
        for (User user : senders(from)) {
            LocalDate today = LocalDate.now(UserZone.of(user.getTimezone()));
            // Subscription ids are per-document, so at most the account that owns
            // this one matches; the others come back null and are skipped.
            MoneyService.Paid paid = money.markSubscriptionPaid(user.getId(), subId, month, today);
            if (paid == null) {
                continue;
            }
            // Say what actually happened: an old month's button, or a repeat tap,
            // books nothing, so it must not claim to have.
            String text = paid.noAmount()
                    ? paid.name() + " has no amount yet, so it can't be marked paid. "
                            + "Add an amount first in Money, then tap again."
                    : paid.booked()
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

    private void snoozeButton(String from, String reminderId) {
        UUID id;
        try {
            id = UUID.fromString(reminderId);
        } catch (IllegalArgumentException ex) {
            return;
        }
        for (User user : senders(from)) {
            // Reminder ids are per-account, so only the owner's comes back with a time.
            snoozes.snoozeFromWhatsApp(user, id, null).ifPresent(at -> confirm(user, at));
        }
    }

    private void snoozeReply(String from, String text) {
        Matcher m = text == null ? null : SNOOZE_REPLY.matcher(text);
        if (m == null || !m.matches()) {
            return;
        }
        Integer minutes = m.group(1) == null ? null : Integer.valueOf(m.group(1));
        for (User user : senders(from)) {
            Optional<Instant> at = minutes != null && (minutes < 1 || minutes > 240)
                    ? Optional.empty()
                    : snoozes.snoozeLatestFromWhatsApp(user, minutes);
            if (at.isPresent()) {
                confirm(user, at.get());
            } else {
                say(user, minutes != null && (minutes < 1 || minutes > 240)
                        ? "Snooze takes 1 to 240 minutes — try \"snooze 15\"."
                        : "There's no reminder from the last few hours to snooze.");
            }
        }
    }

    private java.util.List<User> senders(String from) {
        // An account scheduled for deletion acts on nothing, and is told nothing,
        // from WhatsApp during its grace period: its sessions are gone too.
        return from.isEmpty() ? java.util.List.of()
                : users.findByWhatsappNumberAndWhatsappEnabledTrueAndWhatsappVerifiedTrue("+" + from).stream()
                        .filter(u -> !u.isPendingDeletion()).toList();
    }

    private void confirm(User user, Instant at) {
        String time = DateTimeFormatter.ofPattern("HH:mm").format(at.atZone(UserZone.of(user.getTimezone())));
        say(user, "Snoozed. I'll remind you again at " + time + ".");
    }

    /** A reply lands inside the 24h window their tap or message just opened, so plain text is fine. */
    private void say(User user, String text) {
        try {
            whatsapp.reply(user.getWhatsappNumber(), text);
        } catch (Exception ex) {
            log.warn("Snooze reply to {} failed: {}", user.getId(), ex.getMessage());
        }
    }

    static String textBody(JsonNode msg) {
        return "text".equals(msg.path("type").asText()) ? msg.path("text").path("body").asText(null) : null;
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
