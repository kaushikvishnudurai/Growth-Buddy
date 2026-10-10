package com.growthbuddy.reminder;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The Snooze button on a push notification. It runs in the service worker,
 * which has no session (the token lives in the page's storage), so the push
 * carries a signed ticket for exactly one thing: snoozing that reminder, for
 * that user, for a day, and names the occurrence day it rang for, so a link
 * tapped once that day is over snoozes nothing. Keyed with the session HMAC secret, under its own label
 * so a ticket can never pass for anything else.
 */
@Component
public class SnoozeLinks {

    static final Duration LIFETIME = Duration.ofHours(24);
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    private final byte[] key;

    public SnoozeLinks(@Value("${growthbuddy.session.hmac-secret}") String secret) {
        this.key = ("snooze-link:" + secret).getBytes(StandardCharsets.UTF_8);
    }

    /** {@code day} is null on a ticket signed before it carried one. */
    public record Ticket(UUID userId, UUID reminderId, LocalDate day) {
    }

    public String sign(UUID userId, UUID reminderId, LocalDate day, Instant now) {
        String body = userId + ":" + reminderId + ":" + now.plus(LIFETIME).getEpochSecond() + ":" + day;
        return B64.encodeToString(body.getBytes(StandardCharsets.UTF_8)) + "." + B64.encodeToString(mac(body));
    }

    /** Empty for anything forged, cut, expired or malformed — never a reason why. */
    public Optional<Ticket> verify(String token, Instant now) {
        try {
            int dot = token == null ? -1 : token.indexOf('.');
            if (dot <= 0) return Optional.empty();
            String body = new String(Base64.getUrlDecoder().decode(token.substring(0, dot)), StandardCharsets.UTF_8);
            byte[] sig = Base64.getUrlDecoder().decode(token.substring(dot + 1));
            if (!MessageDigest.isEqual(sig, mac(body))) return Optional.empty();
            String[] parts = body.split(":");
            // Three parts: a ticket from before the day was added, still good until it expires.
            if (parts.length < 3 || parts.length > 4 || now.getEpochSecond() > Long.parseLong(parts[2])) {
                return Optional.empty();
            }
            LocalDate day = parts.length == 4 ? LocalDate.parse(parts[3]) : null;
            return Optional.of(new Ticket(UUID.fromString(parts[0]), UUID.fromString(parts[1]), day));
        } catch (RuntimeException ex) {
            return Optional.empty();
        }
    }

    private byte[] mac(String body) {
        try {
            Mac m = Mac.getInstance("HmacSHA256");
            m.init(new SecretKeySpec(key, "HmacSHA256"));
            return m.doFinal(body.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
