package com.growthbuddy.push;

import jakarta.annotation.PostConstruct;
import java.security.Security;
import java.util.List;
import java.util.UUID;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.Subscription;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/**
 * Web Push (VAPID) subscriptions + sending. Disabled and inert until VAPID keys
 * are configured (like the OpenAI / WhatsApp integrations), so the app runs
 * fine without them — the client just won't offer to enable notifications.
 */
@Service
public class PushService {

    private static final Logger log = LoggerFactory.getLogger(PushService.class);

    private final PushRepository repo;
    private final String publicKey;
    private final String privateKey;
    private final String subject;

    private nl.martijndwars.webpush.PushService pushService;
    private boolean configured;

    public PushService(PushRepository repo,
                       @Value("${growthbuddy.push.public-key:}") String publicKey,
                       @Value("${growthbuddy.push.private-key:}") String privateKey,
                       @Value("${growthbuddy.push.subject:mailto:hello@growthbuddy.app}") String subject) {
        this.repo = repo;
        this.publicKey = publicKey;
        this.privateKey = privateKey;
        this.subject = subject;
    }

    @PostConstruct
    void init() {
        if (!StringUtils.hasText(publicKey) || !StringUtils.hasText(privateKey)) {
            log.info("Web Push disabled — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to enable.");
            return;
        }
        try {
            if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
                Security.addProvider(new BouncyCastleProvider());
            }
            this.pushService = new nl.martijndwars.webpush.PushService(publicKey, privateKey, subject);
            this.configured = true;
            log.info("Web Push enabled.");
        } catch (Exception e) {
            log.warn("Web Push failed to initialize: {}", e.getMessage());
        }
    }

    public boolean isConfigured() {
        return configured;
    }

    public String publicKey() {
        return publicKey;
    }

    /** Store (or refresh) a browser subscription for the user. Dedupes by endpoint. */
    @Transactional
    public void subscribe(UUID userId, String endpoint, String p256dh, String auth) {
        PushSubscription sub = repo.findByEndpoint(endpoint).orElseGet(PushSubscription::new);
        sub.setUserId(userId);
        sub.setEndpoint(endpoint);
        sub.setP256dh(p256dh);
        sub.setAuth(auth);
        repo.save(sub);
    }

    @Transactional
    public void unsubscribe(String endpoint) {
        repo.findByEndpoint(endpoint).ifPresent(repo::delete);
    }

    /**
     * Push a notification to every device the user has registered. Best-effort:
     * a stale endpoint (404/410) is pruned; other failures are logged, not thrown.
     * Returns the number of devices successfully delivered to.
     */
    @Transactional
    public int sendToUser(UUID userId, String title, String body, String url) {
        if (!configured) return 0;
        List<PushSubscription> subs = repo.findByUserId(userId);
        String payload = "{\"title\":" + jsonStr(title) + ",\"body\":" + jsonStr(body)
                + ",\"url\":" + jsonStr(url == null ? "/" : url) + "}";
        int sent = 0;
        for (PushSubscription s : subs) {
            try {
                Subscription sub = new Subscription(s.getEndpoint(), new Subscription.Keys(s.getP256dh(), s.getAuth()));
                var response = pushService.send(new Notification(sub, payload));
                int code = response.getStatusLine().getStatusCode();
                if (code == 404 || code == 410) {
                    repo.delete(s); // subscription is gone; stop trying it
                } else if (code >= 200 && code < 300) {
                    sent++;
                } else {
                    log.warn("Push to {} returned {}", userId, code);
                }
            } catch (Exception e) {
                log.warn("Push send failed for user {}: {}", userId, e.getMessage());
            }
        }
        return sent;
    }

    /** Minimal JSON string escaping for the payload. */
    private static String jsonStr(String s) {
        if (s == null) return "\"\"";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> b.append(c);
            }
        }
        return b.append('"').toString();
    }
}
