package com.growthbuddy.user;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Mints and validates opaque session tokens. The raw token is returned to the
 * client exactly once (on signin / verify / password reset); the DB stores only
 * HMAC-SHA256(token, serverSecret) so a DB dump alone cannot validate stolen tokens.
 * Tokens last 60 days unless explicitly revoked.
 *
 * <p>{@link #resolve} runs on every authenticated request, so it is kept off the
 * DB where possible: a validated token is cached (tokenHash → userId) for a short
 * TTL, and {@code lastUsedAt} is only written when it is meaningfully stale. This
 * turns the per-request "SELECT + UPDATE" into a mostly-in-memory lookup.
 */
@Service
public class SessionService {

    private static final Duration SESSION_TTL = Duration.ofDays(60);
    /** How long a resolved token stays trusted in-memory before we re-check the DB. */
    private static final long CACHE_TTL_MS = 60_000L;
    /** Only persist lastUsedAt when it's older than this — kills per-request writes. */
    private static final Duration LAST_USED_WRITE_INTERVAL = Duration.ofMinutes(10);
    /** Crude bound on the cache; on overflow we clear it (entries rebuild in one TTL). */
    private static final int CACHE_MAX = 100_000;

    private record CacheEntry(UUID userId, long cachedAtMs) {}

    private final ConcurrentHashMap<String, CacheEntry> tokenCache = new ConcurrentHashMap<>();

    private final SessionRepository sessions;
    private final String hmacSecret;
    private final SecureRandom rng = new SecureRandom();

    /** The built-in dev fallback (see application.yml). Must never be used in prod. */
    private static final String DEFAULT_DEV_SECRET = "growth-buddy-dev-hmac-secret-replace-in-production";

    public SessionService(SessionRepository sessions,
                          @Value("${growthbuddy.session.hmac-secret}") String hmacSecret,
                          @Value("${spring.profiles.active:}") String activeProfiles) {
        boolean prod = activeProfiles != null && activeProfiles.toLowerCase().contains("prod");
        if (prod && DEFAULT_DEV_SECRET.equals(hmacSecret)) {
            // A publicly-known signing key would let anyone forge session tokens.
            throw new IllegalStateException(
                    "SESSION_HMAC_SECRET must be set to a private value in production.");
        }
        this.sessions   = sessions;
        this.hmacSecret = hmacSecret;
    }

    public record IssuedToken(String token, Session session) {}

    @Transactional
    public IssuedToken issue(UUID userId, HttpServletRequest request) {
        byte[] raw = new byte[32];
        rng.nextBytes(raw);
        String token = HexFormat.of().formatHex(raw);
        Session s = new Session();
        s.setUserId(userId);
        s.setTokenHash(tokenHash(token));
        s.setExpiresAt(Instant.now().plus(SESSION_TTL));
        if (request != null) {
            s.setUserAgent(truncate(request.getHeader("User-Agent"), 4000));
            s.setIp(clientIp(request));
        }
        sessions.save(s);
        return new IssuedToken(token, s);
    }

    /**
     * Resolve a raw token to its user id. Returns empty when the token is
     * unknown, expired, or revoked.
     *
     * <p>Not {@code @Transactional}: a cache hit touches no DB at all, and the
     * two possible DB ops (a lookup, a rare lastUsedAt write) are each fine on
     * their own auto-commit transaction. A revoked token stops resolving within
     * one {@link #CACHE_TTL_MS} window (immediately for revokes on this instance,
     * which clear the cache).
     */
    public Optional<UUID> resolve(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) return Optional.empty();
        String hash = tokenHash(rawToken);
        long nowMs = System.currentTimeMillis();

        CacheEntry cached = tokenCache.get(hash);
        if (cached != null && nowMs - cached.cachedAtMs() < CACHE_TTL_MS) {
            return Optional.of(cached.userId());
        }

        Optional<Session> opt = sessions.findByTokenHash(hash);
        if (opt.isEmpty()) return Optional.empty();
        Session s = opt.get();
        Instant now = Instant.now();
        if (s.getRevokedAt() != null || s.getExpiresAt().isBefore(now)) {
            tokenCache.remove(hash);
            return Optional.empty();
        }
        // Only write lastUsedAt when it's meaningfully stale — avoids an UPDATE
        // on every single request.
        if (s.getLastUsedAt() == null || s.getLastUsedAt().isBefore(now.minus(LAST_USED_WRITE_INTERVAL))) {
            s.setLastUsedAt(now);
            sessions.save(s);
        }
        if (tokenCache.size() > CACHE_MAX) {
            tokenCache.clear(); // ponytail: crude bound; entries rebuild within one TTL
        }
        tokenCache.put(hash, new CacheEntry(s.getUserId(), nowMs));
        return Optional.of(s.getUserId());
    }

    /** Revoke a session (logout). No-op when the token is already unknown. */
    @Transactional
    public void revoke(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) return;
        String hash = tokenHash(rawToken);
        tokenCache.remove(hash);
        sessions.findByTokenHash(hash).ifPresent(s -> {
            if (s.getRevokedAt() == null) {
                s.setRevokedAt(Instant.now());
                sessions.save(s);
            }
        });
    }

    /** Revoke every active session for a user (e.g. after a password reset). */
    @Transactional
    public void revokeAllForUser(UUID userId) {
        sessions.revokeAllForUser(userId, Instant.now());
        // Cache is keyed by token hash, not user; clear it so revoked tokens
        // don't keep resolving from cache. Rare op, so a full clear is fine.
        tokenCache.clear();
    }

    /** Active (non-revoked, non-expired) sessions for a user, most-recent first. */
    @Transactional(readOnly = true)
    public List<Session> listActive(UUID userId) {
        Instant now = Instant.now();
        return sessions.findByUserIdOrderByLastUsedAtDesc(userId).stream()
                .filter(s -> s.getRevokedAt() == null && s.getExpiresAt().isAfter(now))
                .toList();
    }

    /** Session id the given raw token maps to (to mark "this device"). */
    @Transactional(readOnly = true)
    public UUID sessionIdForToken(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) return null;
        return sessions.findByTokenHash(tokenHash(rawToken)).map(Session::getId).orElse(null);
    }

    /** Revoke one session by id, but only if it belongs to {@code userId}. */
    @Transactional
    public boolean revokeById(UUID userId, UUID sessionId) {
        Optional<Session> opt = sessions.findById(sessionId);
        if (opt.isEmpty() || !opt.get().getUserId().equals(userId)) return false;
        Session s = opt.get();
        if (s.getRevokedAt() == null) {
            s.setRevokedAt(Instant.now());
            sessions.save(s);
            tokenCache.clear(); // can't target one hash; clear (rare op)
        }
        return true;
    }

    /** HMAC-SHA256 of the raw token keyed with the server secret. */
    private String tokenHash(String rawToken) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(hmacSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(rawToken.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }

    private static String clientIp(HttpServletRequest req) {
        String xf = req.getHeader("X-Forwarded-For");
        if (xf != null && !xf.isBlank()) {
            int comma = xf.indexOf(',');
            return comma > 0 ? xf.substring(0, comma).trim() : xf.trim();
        }
        return req.getRemoteAddr();
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
