package com.growthbuddy.push;

import com.growthbuddy.notification.NotificationPrefs;
import com.growthbuddy.notification.NotifyCategory;
import com.growthbuddy.user.UserRepository;
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
    private final UserRepository users;
    private final String publicKey;
    private final String privateKey;
    private final String subject;

    private nl.martijndwars.webpush.PushService pushService;
    private boolean configured;

    public PushService(PushRepository repo,
                       UserRepository users,
                       @Value("${growthbuddy.push.public-key:}") String publicKey,
                       @Value("${growthbuddy.push.private-key:}") String privateKey,
                       @Value("${growthbuddy.push.subject:mailto:hello@growthbuddy.app}") String subject) {
        this.repo = repo;
        this.users = users;
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
        return sendToUser(userId, title, body, url, java.util.Map.of());
    }

    /**
     * The same, for something of a {@link NotifyCategory} the user can mute
     * (Settings → Alerts, {@code ui_prefs.notifyMute}). Muted → nothing is sent
     * and 0 comes back; the bell card was already recorded by the caller's
     * {@code NotificationService.publish}, which never looks at the mute.
     */
    @Transactional
    public int sendToUser(UUID userId, NotifyCategory category, String title, String body, String url) {
        if (!configured || isMuted(userId, category)) return 0;
        return sendToUser(userId, title, body, url, java.util.Map.of());
    }

    /** Whether the user muted pushes of this category. Unmutable categories never ask the database. */
    public boolean isMuted(UUID userId, NotifyCategory category) {
        if (category == null || !category.mutable()) return false;
        return users.findById(userId)
                .map(u -> NotificationPrefs.isMuted(u.getUiPrefs(), category))
                .orElse(false);
    }

    /**
     * The same, with extra string fields for the service worker — a reminder's
     * {@code tag} and Snooze ticket (see {@code public/push-handlers.js}).
     */
    @Transactional
    public int sendToUser(UUID userId, String title, String body, String url, java.util.Map<String, String> extra) {
        if (!configured) return 0;
        List<PushSubscription> subs = repo.findByUserId(userId);
        if (subs.isEmpty()) return 0;
        // An account in its deletion grace period hears nothing, whoever's action
        // triggered the push (a partner's chat message, a family invite): the
        // schedulers gate their own loops, this is the one door every path shares.
        if (users.findById(userId).map(com.growthbuddy.user.User::isPendingDeletion).orElse(false)) return 0;
        StringBuilder json = new StringBuilder("{\"title\":").append(jsonStr(title))
                .append(",\"body\":").append(jsonStr(body))
                .append(",\"url\":").append(jsonStr(url == null ? "/" : url));
        extra.forEach((k, v) -> json.append(",").append(jsonStr(k)).append(":").append(jsonStr(v)));
        String payload = json.append("}").toString();
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
