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
    private final String template;
    private final String authTemplate;
    private final String templateLang;
    private final HttpClient http;

    public WhatsAppService(
            @Value("${growthbuddy.whatsapp.enabled:false}") boolean enabled,
            @Value("${growthbuddy.whatsapp.meta.phone-number-id:}") String phoneNumberId,
            @Value("${growthbuddy.whatsapp.meta.access-token:}") String accessToken,
            @Value("${growthbuddy.whatsapp.meta.api-version:v21.0}") String apiVersion,
            @Value("${growthbuddy.whatsapp.meta.template:}") String template,
            @Value("${growthbuddy.whatsapp.meta.auth-template:}") String authTemplate,
            @Value("${growthbuddy.whatsapp.meta.template-lang:en}") String templateLang) {
        this.enabled = enabled;
        this.phoneNumberId = phoneNumberId;
        this.accessToken = accessToken;
        this.apiVersion = apiVersion;
        this.template = template;
        this.authTemplate = authTemplate;
        this.templateLang = templateLang;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
    }

    public boolean isConfigured() {
        return enabled
                && StringUtils.hasText(phoneNumberId)
                && StringUtils.hasText(accessToken);
    }

    public void sendReminder(String toNumber, String message) {
        send(toNumber, message, false);
    }

    /**
     * Meta puts verification codes in their own AUTHENTICATION category: the copy-code
     * button exists nowhere else, and a code sent through a utility body reads as a
     * category mismatch on review. That category needs a verified business, so until
     * one is approved this falls back to the ordinary reminder template.
     */
    public void sendOtp(String toNumber, String code) {
        send(toNumber, code, true);
    }

    static String otpText(String code) {
        return "Your Growth Buddy verification code: " + code + ". Do not share it.";
    }

    private void send(String toNumber, String text, boolean auth) {
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
            boolean useAuth = auth && StringUtils.hasText(authTemplate);
            String body = useAuth
                    ? buildAuthBody(to, authTemplate, templateLang, text)
                    : buildBody(to, template, templateLang, auth ? otpText(text) : text);

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

    /**
     * Free-form text only reaches a user inside WhatsApp's 24h customer-service window.
     * A scheduled reminder is by definition outside it, so an approved template is
     * required; the text path stays for replies sent while that window is open.
     */
    static String buildBody(String to, String template, String templateLang, String message) {
        String head = "{\"messaging_product\":\"whatsapp\",\"to\":\"" + jsonEscape(to) + "\",";
        if (!StringUtils.hasText(template)) {
            return head + "\"type\":\"text\",\"text\":{\"body\":\"" + jsonEscape(message) + "\"}}";
        }
        return head + "\"type\":\"template\",\"template\":{\"name\":\"" + jsonEscape(template)
                + "\",\"language\":{\"code\":\"" + jsonEscape(templateLang)
                + "\"},\"components\":[{\"type\":\"body\",\"parameters\":[{\"type\":\"text\",\"text\":\""
                + jsonEscape(message) + "\"}]}]}}";
    }

    /**
     * An authentication template repeats the code twice: once in the body, once in the
     * copy-code button, which is a separate component Meta requires you to fill.
     */
    static String buildAuthBody(String to, String template, String templateLang, String code) {
        String c = jsonEscape(code);
        return "{\"messaging_product\":\"whatsapp\",\"to\":\"" + jsonEscape(to) + "\","
                + "\"type\":\"template\",\"template\":{\"name\":\"" + jsonEscape(template)
                + "\",\"language\":{\"code\":\"" + jsonEscape(templateLang) + "\"},\"components\":["
                + "{\"type\":\"body\",\"parameters\":[{\"type\":\"text\",\"text\":\"" + c + "\"}]},"
                + "{\"type\":\"button\",\"sub_type\":\"url\",\"index\":\"0\","
                + "\"parameters\":[{\"type\":\"text\",\"text\":\"" + c + "\"}]}]}}";
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
