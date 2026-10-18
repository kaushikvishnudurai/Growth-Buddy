package com.growthbuddy.push;

import com.growthbuddy.notification.NotificationPrefs;
import com.growthbuddy.notification.NotifyCategory;
import com.growthbuddy.user.UserRepository;
import jakarta.annotation.PostConstruct;
import java.security.Security;
import java.time.Instant;
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

    /*
     * The push services browsers actually hand out endpoints on: Chrome / Edge on
     * Android / Opera / Samsung (FCM), Firefox (Mozilla autopush), Edge on Windows
     * (WNS), Safari (Apple). The endpoint is a URL the SERVER then POSTs to, and
     * /api/push/test reports whether that POST got a 2xx, so an unchecked one was
     * a reachability probe of any internal address.
     * ponytail: a fixed list; a new browser's push service needs adding here.
     */
    private static final List<String> PUSH_HOSTS = List.of(
            "fcm.googleapis.com", "android.googleapis.com", ".push.services.mozilla.com",
            ".notify.windows.com", ".push.apple.com");

    /** Devices per account; the oldest is dropped past it. */
    static final int MAX_SUBSCRIPTIONS = 10;

    /** https on the default port, to a known push service's host. Pure, for the tests. */
    static boolean allowedEndpoint(String endpoint) {
        if (endpoint == null || endpoint.length() > 2048) return false;
        java.net.URI u;
        try {
            u = new java.net.URI(endpoint);
        } catch (java.net.URISyntaxException e) {
            return false;
        }
        String host = u.getHost();
        if (!"https".equalsIgnoreCase(u.getScheme()) || host == null || u.getUserInfo() != null
                || (u.getPort() != -1 && u.getPort() != 443)) {
            return false;
        }
        String h = host.toLowerCase(java.util.Locale.ROOT);
        return PUSH_HOSTS.stream().anyMatch(p -> p.startsWith(".") ? h.endsWith(p) : h.equals(p));
    }

    /** Store (or refresh) a browser subscription for the user. Dedupes by endpoint. */
    @Transactional
    public void subscribe(UUID userId, String endpoint, String p256dh, String auth) {
        if (!allowedEndpoint(endpoint)) {
            throw com.growthbuddy.common.ApiException.badRequest("That isn't a push service this app can deliver to.");
        }
        repo.upsert(UUID.randomUUID().toString(), userId.toString(), endpoint,
                PushSubscription.hashOf(endpoint), p256dh, auth, Instant.now());
        List<PushSubscription> mine = new java.util.ArrayList<>(repo.findByUserId(userId));
        if (mine.size() > MAX_SUBSCRIPTIONS) {
            mine.sort(java.util.Comparator.comparing(PushSubscription::getCreatedAt,
                    java.util.Comparator.nullsFirst(java.util.Comparator.naturalOrder())));
            repo.deleteAll(mine.subList(0, mine.size() - MAX_SUBSCRIPTIONS));
        }
    }

    /** Only the caller's own: any signed-in user could delete anyone's by endpoint. */
    @Transactional
    public void unsubscribe(UUID userId, String endpoint) {
        repo.findByEndpoint(endpoint).filter(s -> userId.equals(s.getUserId())).ifPresent(repo::delete);
    }

    /**
     * Push a notification to every device the user has registered. Best-effort:
     * a stale endpoint (404/410) is pruned; other failures are logged, not thrown.
     * Returns the number of devices successfully delivered to.
     */
    public int sendToUser(UUID userId, String title, String body, String url) {
        return sendToUser(userId, title, body, url, java.util.Map.of());
    }

    /**
     * The same, for something of a {@link NotifyCategory} the user can mute
     * (Settings → Alerts, {@code ui_prefs.notifyMute}). Muted → nothing is sent
     * and 0 comes back; the bell card was already recorded by the caller's
     * {@code NotificationService.publish}, which never looks at the mute.
     */
    public int sendToUser(UUID userId, NotifyCategory category, String title, String body, String url) {
        return sendToUser(userId, category, title, body, url, java.util.Map.of());
    }

    /** Mutable category plus the service worker's extra fields (a habit reminder's Done ticket). */
    public int sendToUser(UUID userId, NotifyCategory category, String title, String body, String url,
                          java.util.Map<String, String> extra) {
        if (!configured || isMuted(userId, category)) return 0;
        return sendToUser(userId, title, body, url, extra);
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
    // Not @Transactional: a connection held across the blocking HTTP sends below starved the
    // 8-connection pool when 16 reminder senders fired in the same minute. Each delete is its own.
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
            if (!allowedEndpoint(s.getEndpoint())) {
                repo.delete(s); // stored before endpoints were checked
                continue;
            }
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
    static String jsonStr(String s) {
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
                // Any other control char is invalid raw in JSON: the worker's parse would throw.
                default -> b.append(c < 0x20 ? String.format("\\u%04x", (int) c) : String.valueOf(c));
            }
        }
        return b.append('"').toString();
    }
}
