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
 *
 * <p>The same ticket, under other labels ({@code purpose}), backs the push's other
 * buttons: Done on a reminder ({@link #DONE}) and Done on a habit reminder
 * ({@link #HABIT_DONE}). Each purpose has its own key, so a snooze ticket can't
 * tick a habit and a habit ticket can't check a reminder off.
 */
@Component
public class SnoozeLinks {

    static final Duration LIFETIME = Duration.ofHours(24);
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    public static final String SNOOZE = "snooze";
    public static final String DONE = "reminder-done";
    public static final String HABIT_DONE = "habit-done";

    private final String secret;

    public SnoozeLinks(@Value("${growthbuddy.session.hmac-secret}") String secret) {
        this.secret = secret;
    }

    /** {@code day} is null on a ticket signed before it carried one. {@code targetId}
     *  is the reminder, or the habit for {@link #HABIT_DONE}. */
    public record Ticket(UUID userId, UUID targetId, LocalDate day) {
    }

    public String sign(UUID userId, UUID reminderId, LocalDate day, Instant now) {
        return sign(SNOOZE, userId, reminderId, day, now);
    }

    public String sign(String purpose, UUID userId, UUID targetId, LocalDate day, Instant now) {
        String body = userId + ":" + targetId + ":" + now.plus(LIFETIME).getEpochSecond() + ":" + day;
        return B64.encodeToString(body.getBytes(StandardCharsets.UTF_8)) + "." + B64.encodeToString(mac(purpose, body));
    }

    public Optional<Ticket> verify(String token, Instant now) {
        return verify(SNOOZE, token, now);
    }

    /** Empty for anything forged, cut, expired or malformed — never a reason why. */
    public Optional<Ticket> verify(String purpose, String token, Instant now) {
        try {
            int dot = token == null ? -1 : token.indexOf('.');
            if (dot <= 0) return Optional.empty();
            String body = new String(Base64.getUrlDecoder().decode(token.substring(0, dot)), StandardCharsets.UTF_8);
            byte[] sig = Base64.getUrlDecoder().decode(token.substring(dot + 1));
            if (!MessageDigest.isEqual(sig, mac(purpose, body))) return Optional.empty();
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

    /** "snooze" keys as "snooze-link:" + secret, the label tickets in the wild were signed with. */
    private byte[] mac(String purpose, String body) {
        try {
            Mac m = Mac.getInstance("HmacSHA256");
            m.init(new SecretKeySpec((purpose + "-link:" + secret).getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return m.doFinal(body.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
