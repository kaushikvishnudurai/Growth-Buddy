package com.growthbuddy.mail;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.io.UnsupportedEncodingException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Sends transactional emails. If {@code spring.mail.username} is empty
 * (i.e. no Gmail app password supplied), the service logs the message to
 * the console instead — useful for local development so OTPs are visible
 * without an SMTP setup.
 */
@Service
public class MailService {

    private static final Logger log = LoggerFactory.getLogger(MailService.class);

    private final JavaMailSender sender;
    private final String smtpUsername;
    private final String fromAddress;
    private final String fromName;
    private final boolean prod;

    public MailService(JavaMailSender sender,
                       @Value("${spring.mail.username:}") String smtpUsername,
                       @Value("${growthbuddy.mail.from-address:}") String fromAddress,
                       @Value("${growthbuddy.mail.from-name:Growth Buddy}") String fromName,
                       @Value("${spring.profiles.active:}") String activeProfiles) {
        this.sender = sender;
        this.smtpUsername = smtpUsername;
        this.fromAddress = fromAddress;
        this.fromName = fromName;
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
}
