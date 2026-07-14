package com.growthbuddy.reminder;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Sends WhatsApp messages via Meta's (Facebook) WhatsApp Cloud API.
 */
@Service
public class WhatsAppService {

    private static final Logger log = LoggerFactory.getLogger(WhatsAppService.class);

    private final boolean enabled;
    private final String phoneNumberId;
    private final String accessToken;
    private final String apiVersion;
    private final HttpClient http;

    public WhatsAppService(
            @Value("${growthbuddy.whatsapp.enabled:false}") boolean enabled,
            @Value("${growthbuddy.whatsapp.meta.phone-number-id:}") String phoneNumberId,
            @Value("${growthbuddy.whatsapp.meta.access-token:}") String accessToken,
            @Value("${growthbuddy.whatsapp.meta.api-version:v21.0}") String apiVersion) {
        this.enabled = enabled;
        this.phoneNumberId = phoneNumberId;
        this.accessToken = accessToken;
        this.apiVersion = apiVersion;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
    }

    public boolean isConfigured() {
        return enabled
                && StringUtils.hasText(phoneNumberId)
                && StringUtils.hasText(accessToken);
    }

    public void sendReminder(String toNumber, String message) {
        if (!isConfigured()) {
            log.debug("WhatsApp disabled/not configured; skipping send to {}", toNumber);
            return;
        }
        if (!StringUtils.hasText(toNumber)) {
            throw new IllegalArgumentException("Missing recipient WhatsApp number");
        }

        try {
            // Meta wants the E.164 number without a leading "+".
            String to = toNumber.startsWith("+") ? toNumber.substring(1) : toNumber;
            String endpoint = "https://graph.facebook.com/" + apiVersion + "/" + phoneNumberId + "/messages";
            // ponytail: free-form text only works inside WhatsApp's 24h customer-service window.
            // Proactive reminders outside it need an approved template message — switch type to "template" then.
            String body = "{\"messaging_product\":\"whatsapp\",\"to\":\"" + jsonEscape(to)
                    + "\",\"type\":\"text\",\"text\":{\"body\":\"" + jsonEscape(message) + "\"}}";

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(10))
                    .header("Authorization", "Bearer " + accessToken)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                throw new IllegalStateException("WhatsApp Cloud API send failed: HTTP "
                        + res.statusCode() + " " + res.body());
            }
        } catch (Exception ex) {
            throw new IllegalStateException("Could not send WhatsApp reminder", ex);
        }
    }

    private static String jsonEscape(String value) {
        StringBuilder sb = new StringBuilder(value.length() + 8);
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        return sb.toString();
    }
}
