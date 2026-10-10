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
    private final String billTemplate;
    private final String reminderTemplate;
    private final boolean repliesHandled;
    private final HttpClient http;

    public WhatsAppService(
            @Value("${growthbuddy.whatsapp.enabled:false}") boolean enabled,
            @Value("${growthbuddy.whatsapp.meta.phone-number-id:}") String phoneNumberId,
            @Value("${growthbuddy.whatsapp.meta.access-token:}") String accessToken,
            @Value("${growthbuddy.whatsapp.meta.api-version:v21.0}") String apiVersion,
            @Value("${growthbuddy.whatsapp.meta.template:}") String template,
            @Value("${growthbuddy.whatsapp.meta.auth-template:}") String authTemplate,
            @Value("${growthbuddy.whatsapp.meta.template-lang:en}") String templateLang,
            @Value("${growthbuddy.whatsapp.meta.bill-template:}") String billTemplate,
            @Value("${growthbuddy.whatsapp.meta.reminder-template:}") String reminderTemplate,
            @Value("${growthbuddy.whatsapp.meta.app-secret:}") String appSecret) {
        this.enabled = enabled;
        this.phoneNumberId = phoneNumberId;
        this.accessToken = accessToken;
        this.apiVersion = apiVersion;
        this.template = template;
        this.authTemplate = authTemplate;
        this.templateLang = templateLang;
        this.billTemplate = billTemplate;
        this.reminderTemplate = reminderTemplate;
        // The webhook refuses every POST without the app secret, so with none a
        // "reply SNOOZE" would go nowhere — and the message must not offer it.
        this.repliesHandled = StringUtils.hasText(appSecret);
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
     * A reminder the user can snooze from WhatsApp. With an approved button
     * template ({@code WHATSAPP_REMINDER_TEMPLATE}: body = one {{1}}, one
     * QUICK_REPLY "Snooze") the tap comes back to the webhook as
     * {@code snooze:<reminderId>}. Without one the plain reminder template goes
     * out with a line asking for a reply of SNOOZE — a reply the webhook only
     * hears when it is set up, so the line is only there when it is.
     */
    public void sendSnoozableReminder(String toNumber, String text, java.util.UUID reminderId, int snoozeMinutes) {
        if (StringUtils.hasText(reminderTemplate)) {
            post(toNumber, to -> buildQuickReplyBody(to, reminderTemplate, templateLang, text,
                    "snooze:" + reminderId, "Snooze"));
            return;
        }
        sendReminder(toNumber, repliesHandled ? withSnoozeHint(text, snoozeMinutes) : text);
    }

    /** One line, no newline: Meta refuses a template parameter that holds one. */
    static String withSnoozeHint(String text, int minutes) {
        return text + " — reply SNOOZE to hear it again in " + ReminderPrefs.human(minutes) + ".";
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

    /**
     * A bill-due message carrying a "Mark as paid" quick-reply button; the tap comes
     * back to {@code WhatsAppWebhookController} with {@code payload} attached.
     */
    public void sendBillDue(String toNumber, String text, String payload) {
        if (!StringUtils.hasText(billTemplate) && StringUtils.hasText(template)) {
            // No approved button template yet: an interactive message would be accepted
            // (HTTP 200) and then dropped outside the 24h window, logged as "sent" while
            // nothing arrived. The reminder template does arrive; the tap happens in the app.
            sendReminder(toNumber, text.replace("Tap Mark as paid", "Mark it paid in the app"));
            return;
        }
        post(toNumber, to -> buildBillBody(to, billTemplate, templateLang, text, payload));
    }

    /** A send Meta refused, or that never reached it ({@code status} 0). */
    /** Throughput / pair rate limits, "something went wrong", service unavailable. */
    static final java.util.Set<Integer> TRANSIENT_META_CODES =
            java.util.Set.of(4, 80007, 130429, 131000, 131016, 131056, 133004);
    private static final java.util.regex.Pattern META_CODE = java.util.regex.Pattern.compile("\"code\"\\s*:\\s*(\\d+)");

    public static class SendFailed extends IllegalStateException {
        public final int status;

        public SendFailed(int status, String message, Throwable cause) {
            super(message, cause);
            this.status = status;
        }

        /**
         * A 4xx usually fails the same way on retry (bad number, bad template). But Meta
         * reports its rate limits and outages as HTTP 400 with the real reason in
         * error.code, and an expired token (401) works again once it is renewed; those
         * retry on the next tick (bounded by the day, see SubscriptionDueScheduler).
         */
        public boolean permanent() {
            if (status == 401 || status == 429 || status / 100 != 4) {
                return false;
            }
            java.util.regex.Matcher m = META_CODE.matcher(String.valueOf(getMessage()));
            return !(m.find() && TRANSIENT_META_CODES.contains(Integer.parseInt(m.group(1))));
        }
    }

    /** Plain text: only for replies, which by definition land inside the 24h window. */
    public void reply(String toNumber, String text) {
        post(toNumber, to -> buildBody(to, null, templateLang, text));
    }

    private void send(String toNumber, String text, boolean auth) {
        boolean useAuth = auth && StringUtils.hasText(authTemplate);
        post(toNumber, to -> useAuth
                ? buildAuthBody(to, authTemplate, templateLang, text)
                : buildBody(to, template, templateLang, auth ? otpText(text) : text));
    }

    private void post(String toNumber, java.util.function.UnaryOperator<String> bodyFor) {
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
            String body = bodyFor.apply(to);

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(10))
                    .header("Authorization", "Bearer " + accessToken)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                // Meta's reason rides in the message: callers log and store only
                // getMessage(), and a bare wrapper left every failure with no why.
                throw new SendFailed(res.statusCode(), "WhatsApp Cloud API send failed: HTTP "
                        + res.statusCode() + " " + res.body(), null);
            }
        } catch (SendFailed ex) {
            throw ex;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new SendFailed(0, "WhatsApp send interrupted", ex);
        } catch (Exception ex) {
            throw new SendFailed(0, "Could not reach WhatsApp: " + ex.getMessage(), ex);
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
     * Same 24h rule as {@link #buildBody}: a quick-reply button outside the window
     * has to be declared on an approved template (body = one {@code {{1}}}, one
     * QUICK_REPLY button), and only its payload is filled per send. Without one it
     * falls back to an interactive button message, which only lands inside the window.
     */
    static String buildBillBody(String to, String template, String templateLang,
                                String message, String payload) {
        return buildQuickReplyBody(to, template, templateLang, message, payload, "Mark as paid");
    }

    /** {@link #buildBillBody} for any one button; {@code title} only shows on the no-template fallback. */
    static String buildQuickReplyBody(String to, String template, String templateLang,
                                      String message, String payload, String title) {
        String head = "{\"messaging_product\":\"whatsapp\",\"to\":\"" + jsonEscape(to) + "\",";
        String p = jsonEscape(payload);
        if (!StringUtils.hasText(template)) {
            return head + "\"type\":\"interactive\",\"interactive\":{\"type\":\"button\","
                    + "\"body\":{\"text\":\"" + jsonEscape(message) + "\"},"
                    + "\"action\":{\"buttons\":[{\"type\":\"reply\",\"reply\":{\"id\":\"" + p
                    + "\",\"title\":\"" + jsonEscape(title) + "\"}}]}}}";
        }
        return head + "\"type\":\"template\",\"template\":{\"name\":\"" + jsonEscape(template)
                + "\",\"language\":{\"code\":\"" + jsonEscape(templateLang) + "\"},\"components\":["
                + "{\"type\":\"body\",\"parameters\":[{\"type\":\"text\",\"text\":\""
                + jsonEscape(message) + "\"}]},"
                + "{\"type\":\"button\",\"sub_type\":\"quick_reply\",\"index\":\"0\","
                + "\"parameters\":[{\"type\":\"payload\",\"payload\":\"" + p + "\"}]}]}}";
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
