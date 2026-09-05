package com.growthbuddy.mail;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Sends transactional emails, by one of three routes in priority order:
 *
 * <ol>
 *   <li>Brevo's REST API, when {@code growthbuddy.mail.api-key} is set. This
 *       goes over HTTPS, which is the only route that works on a host that
 *       blocks outbound SMTP ports — Render's free tier blocks 25/465/587, so
 *       there JavaMailSender can do nothing but time out.</li>
 *   <li>SMTP via {@code spring.mail.username}, for a VM or local machine.</li>
 *   <li>The console, when neither is configured, so local development can read
 *       OTPs without any mail setup at all.</li>
 * </ol>
 */
@Service
public class MailService {

    private static final Logger log = LoggerFactory.getLogger(MailService.class);

    private final JavaMailSender sender;
    private final String smtpUsername;
    private final String fromAddress;
    private final String fromName;
    private final boolean prod;
    private final String apiKey;
    private final String apiSecret;
    private final String apiUrl;
    private final HttpClient http;
    private final ObjectMapper json = new ObjectMapper();

    public MailService(JavaMailSender sender,
                       @Value("${spring.mail.username:}") String smtpUsername,
                       @Value("${growthbuddy.mail.from-address:}") String fromAddress,
                       @Value("${growthbuddy.mail.from-name:Growth Buddy}") String fromName,
                       @Value("${growthbuddy.mail.api-key:}") String apiKey,
                       @Value("${growthbuddy.mail.api-secret:}") String apiSecret,
                       @Value("${growthbuddy.mail.api-url:https://api.mailjet.com/v3.1/send}") String apiUrl,
                       @Value("${spring.profiles.active:}") String activeProfiles) {
        this.sender = sender;
        this.smtpUsername = smtpUsername;
        this.fromAddress = fromAddress;
        this.fromName = fromName;
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.apiUrl = apiUrl;
        // HTTP/1.1 explicitly: the JDK client negotiates HTTP/2 via ALPN by default,
        // which some API edges reject outright. 1.1 is universally accepted here and
        // costs nothing for one small request at a time.
        this.http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(8))
                .build();
        this.prod = activeProfiles != null && activeProfiles.toLowerCase().contains("prod");
    }

    public void sendOtp(String toEmail, String displayName, String otp, String purpose) {
        String subject = "Your Growth Buddy code: " + otp;
        String greeting = StringUtils.hasText(displayName) ? "Hi " + displayName + "," : "Hello,";
        String body = greeting + "\n\n"
                + "Your Growth Buddy " + purpose + " code is:\n\n"
                + "  " + otp + "\n\n"
                + "It expires in 15 minutes. If you didn't request this, you can ignore this email.\n\n"
                + "— Growth Buddy";
        send(toEmail, subject, body);
    }

    /** Send a plain-text email (e.g. the progress digest). */
    public void sendPlain(String toEmail, String subject, String body) {
        send(toEmail, subject, body);
    }

    private void send(String to, String subject, String body) {
        if (StringUtils.hasText(apiKey)) {
            sendViaApi(to, subject, body);
            return;
        }
        if (!StringUtils.hasText(smtpUsername)) {
            if (prod) {
                // Never print email bodies (they contain OTPs) to prod logs.
                log.error("SMTP not configured — cannot deliver email to {} (subject: {}). "
                        + "Set MAIL_USER/MAIL_PASS.", to, subject);
            } else {
                log.info("\n========== EMAIL (console — no SMTP configured) ==========\n"
                        + "To:      {}\nSubject: {}\n\n{}\n"
                        + "==========================================================",
                        to, subject, body);
            }
            return;
        }
        try {
            MimeMessage msg = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(msg, false, "UTF-8");
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(body, false);
            String from = StringUtils.hasText(fromAddress) ? fromAddress : smtpUsername;
            try {
                helper.setFrom(new InternetAddress(from, fromName, "UTF-8"));
            } catch (UnsupportedEncodingException e) {
                helper.setFrom(from);
            }
            sender.send(msg);
            log.info("Sent email to {} (subject: {})", to, subject);
        } catch (MessagingException ex) {
            log.error("Failed to send email to {}: {}", to, ex.getMessage(), ex);
            throw new IllegalStateException("Could not send email", ex);
        }
    }

    /**
     * Brevo's transactional endpoint. Same failure contract as the SMTP path —
     * it throws — so a caller that must not silently drop an OTP still finds out.
     */
    private void sendViaApi(String to, String subject, String body) {
        String from = StringUtils.hasText(fromAddress) ? fromAddress : smtpUsername;
        if (!StringUtils.hasText(from)) {
            throw new IllegalStateException(
                    "Mail API key set but no sender address: set MAIL_FROM or MAIL_USER");
        }
        try {
            String basic = Base64.getEncoder().encodeToString(
                    (apiKey + ":" + apiSecret).getBytes(StandardCharsets.UTF_8));
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(apiUrl))
                    .timeout(Duration.ofSeconds(15))
                    .header("authorization", "Basic " + basic)
                    .header("content-type", "application/json")
                    .header("accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(
                            buildApiPayload(json, from, fromName, to, subject, body),
                            StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                throw new IllegalStateException("Mail API send failed: HTTP "
                        + res.statusCode() + " " + res.body());
            }
            // Mailjet reports per-message failures inside a 200. Treating the status
            // code alone as success drops OTPs silently, which is the one outcome
            // this path must never have.
            String status = json.readTree(res.body())
                    .path("Messages").path(0).path("Status").asText("");
            if (!"success".equals(status)) {
                throw new IllegalStateException(
                        "Mail API send rejected: " + res.body());
            }
            log.info("Sent email to {} (subject: {})", to, subject);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Could not send email", ex);
        } catch (Exception ex) {
            log.error("Failed to send email to {}: {}", to, ex.getMessage());
            throw new IllegalStateException("Could not send email", ex);
        }
    }

    /**
     * Mailjet's v3.1 payload shape — capitalised keys, and messages batched in an
     * array even when there is one. Jackson does the escaping: an OTP subject is
     * attacker-influenced via the display name, and hand-rolled quoting is how that
     * becomes a header-injection bug later.
     */
    static String buildApiPayload(ObjectMapper json, String from, String fromName,
                                  String to, String subject, String body) throws Exception {
        ObjectNode message = json.createObjectNode();
        message.set("From", json.createObjectNode().put("Email", from).put("Name", fromName));
        message.putArray("To").addObject().put("Email", to);
        message.put("Subject", subject);
        message.put("TextPart", body);

        ObjectNode payload = json.createObjectNode();
        payload.putArray("Messages").add(message);
        return json.writeValueAsString(payload);
    }
}
