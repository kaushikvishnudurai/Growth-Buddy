package com.growthbuddy.gcal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.ApiException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Read-only Google Calendar integration. OAuth "web" flow: we send the user to
 * Google's consent page with the narrowest scope (read events), store the
 * refresh token, and proxy month views of the primary calendar. We never write
 * to the user's calendar.
 */
@Service
public class GoogleCalendarService {

    private static final Logger log = LoggerFactory.getLogger(GoogleCalendarService.class);

    private static final String AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String REVOKE_URL = "https://oauth2.googleapis.com/revoke";
    private static final String EVENTS_URL =
            "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    // events.readonly = read events only; email = show which account is linked.
    private static final String SCOPE =
            "https://www.googleapis.com/auth/calendar.events.readonly email";

    private final String envClientId;
    private final String envClientSecret;
    private final String redirectUri;
    private final GoogleCalendarLinkRepository links;
    private final GoogleOauthSettingsRepository oauthSettings;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
    private final ObjectMapper json = new ObjectMapper();

    // ponytail: in-memory pending-connect states + access-token cache. Fine on a
    // single instance; move both to the DB if we ever run replicas.
    private final Map<String, Pending> pendingStates = new ConcurrentHashMap<>();
    private final Map<UUID, CachedToken> accessTokens = new ConcurrentHashMap<>();

    private record Pending(UUID userId, Instant expiresAt) {}
    private record CachedToken(String token, Instant expiresAt) {}

    /** Google's side revoked/lost the grant — the stored link is dead. */
    private static class RevokedException extends RuntimeException {}

    public record Status(boolean configured, boolean connected, String email) {}
    public record EventDto(String id, String title, String date, String time) {}
    public record EventsResponse(boolean connected, List<EventDto> events) {}
    public record Config(boolean configured, String clientId, String redirectUri) {}

    public GoogleCalendarService(
            @Value("${growthbuddy.google.client-id:}") String clientId,
            @Value("${growthbuddy.google.client-secret:}") String clientSecret,
            @Value("${growthbuddy.google.redirect-uri:}") String redirectUri,
            GoogleCalendarLinkRepository links,
            GoogleOauthSettingsRepository oauthSettings) {
        this.envClientId = clientId;
        this.envClientSecret = clientSecret;
        this.redirectUri = redirectUri;
        this.links = links;
        this.oauthSettings = oauthSettings;
    }

    /* ---- OAuth client credentials: the DB row (set from Settings) wins, env vars are the fallback ---- */

    private String clientId() {
        return oauthSettings.findById(GoogleOauthSettings.SINGLETON_ID)
                .map(GoogleOauthSettings::getClientId)
                .filter(StringUtils::hasText)
                .orElse(envClientId);
    }

    private String clientSecret() {
        return oauthSettings.findById(GoogleOauthSettings.SINGLETON_ID)
                .map(GoogleOauthSettings::getClientSecret)
                .filter(StringUtils::hasText)
                .orElse(envClientSecret);
    }

    public boolean isConfigured() {
        return StringUtils.hasText(clientId()) && StringUtils.hasText(clientSecret());
    }

    /** Never exposes the secret; the client ID is public by design (it rides in the consent URL). */
    public Config config() {
        return new Config(isConfigured(), StringUtils.hasText(clientId()) ? clientId() : null, redirectUri);
    }

    // ponytail: no admin roles exist in this app, so any signed-in user can save
    // the OAuth client keys. Gate this behind a role if the app ever grows one.
    public Config saveConfig(UUID savedBy, String clientId, String clientSecret) {
        String id = clientId.trim();
        String secret = clientSecret.trim();
        if (!id.endsWith(".apps.googleusercontent.com")) {
            throw ApiException.badRequest(
                    "That doesn't look like a Google client ID — it should end with .apps.googleusercontent.com");
        }
        GoogleOauthSettings row = oauthSettings.findById(GoogleOauthSettings.SINGLETON_ID)
                .orElseGet(GoogleOauthSettings::new);
        row.setId(GoogleOauthSettings.SINGLETON_ID);
        row.setClientId(id);
        row.setClientSecret(secret);
        row.setUpdatedAt(Instant.now());
        oauthSettings.save(row);
        accessTokens.clear(); // old tokens were minted by the previous client
        log.info("Google OAuth client keys updated by user {}", savedBy);
        return config();
    }

    public String connectUrl(UUID userId) {
        if (!isConfigured()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Google Calendar isn't configured on the server (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
        }
        pendingStates.values().removeIf(p -> p.expiresAt().isBefore(Instant.now()));
        String state = UUID.randomUUID().toString();
        pendingStates.put(state, new Pending(userId, Instant.now().plusSeconds(600)));
        Map<String, String> params = Map.of(
                "client_id", clientId(),
                "redirect_uri", redirectUri,
                "response_type", "code",
                "scope", SCOPE,
                // offline + consent so Google always returns a refresh token.
                "access_type", "offline",
                "prompt", "consent",
                "state", state);
        return AUTH_URL + "?" + params.entrySet().stream()
                .map(e -> e.getKey() + "=" + enc(e.getValue()))
                .collect(Collectors.joining("&"));
    }

    /** Called by Google's browser redirect; the user is identified by {@code state}. */
    public void handleCallback(String state, String code) {
        Pending pending = state == null ? null : pendingStates.remove(state);
        if (pending == null || pending.expiresAt().isBefore(Instant.now())) {
            throw ApiException.badRequest("This connect link expired. Start again from Settings.");
        }
        JsonNode tok = postForm(TOKEN_URL, Map.of(
                "code", code,
                "client_id", clientId(),
                "client_secret", clientSecret(),
                "redirect_uri", redirectUri,
                "grant_type", "authorization_code"));
        String refresh = tok.path("refresh_token").asText(null);
        if (refresh == null) {
            throw ApiException.badRequest("Google didn't return a refresh token. Remove Growth Buddy at "
                    + "myaccount.google.com/permissions and try connecting again.");
        }
        GoogleCalendarLink link = links.findById(pending.userId()).orElseGet(GoogleCalendarLink::new);
        link.setUserId(pending.userId());
        link.setRefreshToken(refresh);
        link.setGoogleEmail(emailFromIdToken(tok.path("id_token").asText(null)));
        links.save(link);
        cacheAccessToken(pending.userId(), tok);
    }

    public Status status(UUID userId) {
        return links.findById(userId)
                .map(l -> new Status(isConfigured(), true, l.getGoogleEmail()))
                .orElse(new Status(isConfigured(), false, null));
    }

    public void disconnect(UUID userId) {
        links.findById(userId).ifPresent(link -> {
            try {
                postForm(REVOKE_URL, Map.of("token", link.getRefreshToken()));
            } catch (Exception ex) {
                log.debug("Google token revoke failed (probably already revoked)", ex);
            }
            links.deleteById(userId);
        });
        accessTokens.remove(userId);
    }

    /** Events on the user's primary calendar for the given month (padded a day each side). */
    public EventsResponse events(UUID userId, YearMonth month) {
        GoogleCalendarLink link = links.findById(userId).orElse(null);
        if (link == null) {
            return new EventsResponse(false, List.of());
        }
        String access;
        try {
            access = accessToken(userId, link);
        } catch (RevokedException ex) {
            // User revoked access on Google's side — drop the dead link quietly.
            links.deleteById(userId);
            accessTokens.remove(userId);
            return new EventsResponse(false, List.of());
        }
        // ±1 day fetch padding so timezone offsets at month edges don't drop
        // events; parseEvents then keeps only days inside the month, so an edge
        // event still belongs to exactly one month (no duplicates across caches).
        String url = EVENTS_URL + "?singleEvents=true&orderBy=startTime&maxResults=250"
                + "&fields=" + enc("nextPageToken,items(id,summary,start,end)")
                + "&timeMin=" + enc(month.atDay(1).minusDays(1) + "T00:00:00Z")
                + "&timeMax=" + enc(month.atEndOfMonth().plusDays(2) + "T00:00:00Z");
        List<EventDto> out = new ArrayList<>();
        String pageToken = null;
        // ponytail: 4 pages = 1000 events in one month; raise if that's ever real.
        for (int page = 0; page < 4; page++) {
            JsonNode res = get(url + (pageToken == null ? "" : "&pageToken=" + enc(pageToken)), access);
            out.addAll(parseEvents(res.path("items"), month));
            pageToken = res.path("nextPageToken").asText(null);
            if (pageToken == null) {
                break;
            }
        }
        return new EventsResponse(true, out);
    }

    /**
     * One row per day the event covers, restricted to {@code month}. Multi-day
     * events repeat on each day; the start time shows only on the first day.
     * Package-private so the parsing branches are unit-testable without HTTP.
     */
    static List<EventDto> parseEvents(JsonNode items, YearMonth month) {
        LocalDate monthStart = month.atDay(1);
        LocalDate monthEndExcl = month.atEndOfMonth().plusDays(1);
        List<EventDto> out = new ArrayList<>();
        for (JsonNode item : items) {
            JsonNode start = item.path("start");
            LocalDate firstDay;
            String time = null;
            if (start.hasNonNull("dateTime")) {
                // Calendar-local timestamp, e.g. "2026-07-14T09:30:00+05:30".
                String dt = start.get("dateTime").asText();
                firstDay = LocalDate.parse(dt.substring(0, 10));
                time = dt.substring(11, 16);
            } else if (start.hasNonNull("date")) {
                firstDay = LocalDate.parse(start.get("date").asText()); // all-day
            } else {
                continue;
            }
            // Last covered day, as an exclusive bound. All-day events already
            // carry an exclusive end date; timed events cover every date they
            // touch, except an end at exactly midnight doesn't enter that day.
            LocalDate endExcl;
            JsonNode end = item.path("end");
            if (end.hasNonNull("date")) {
                endExcl = LocalDate.parse(end.get("date").asText());
            } else if (end.hasNonNull("dateTime")) {
                String edt = end.get("dateTime").asText();
                LocalDate endDay = LocalDate.parse(edt.substring(0, 10));
                endExcl = edt.substring(11, 16).equals("00:00") ? endDay : endDay.plusDays(1);
            } else {
                endExcl = firstDay.plusDays(1);
            }
            if (!endExcl.isAfter(firstDay)) {
                endExcl = firstDay.plusDays(1);
            }
            String id = item.path("id").asText();
            String title = item.path("summary").asText("(no title)");
            LocalDate from = firstDay.isBefore(monthStart) ? monthStart : firstDay;
            LocalDate to = endExcl.isBefore(monthEndExcl) ? endExcl : monthEndExcl;
            for (LocalDate d = from; d.isBefore(to); d = d.plusDays(1)) {
                out.add(new EventDto(id, title, d.toString(), d.equals(firstDay) ? time : null));
            }
        }
        return out;
    }

    private String accessToken(UUID userId, GoogleCalendarLink link) {
        CachedToken cached = accessTokens.get(userId);
        if (cached != null && cached.expiresAt().isAfter(Instant.now())) {
            return cached.token();
        }
        JsonNode tok = postForm(TOKEN_URL, Map.of(
                "refresh_token", link.getRefreshToken(),
                "client_id", clientId(),
                "client_secret", clientSecret(),
                "grant_type", "refresh_token"));
        return cacheAccessToken(userId, tok);
    }

    private String cacheAccessToken(UUID userId, JsonNode tok) {
        String access = tok.path("access_token").asText();
        long ttl = Math.max(60, tok.path("expires_in").asLong(3600) - 60);
        accessTokens.put(userId, new CachedToken(access, Instant.now().plusSeconds(ttl)));
        return access;
    }

    /** Best-effort email from the id_token JWT payload — saves a userinfo round-trip. */
    private String emailFromIdToken(String idToken) {
        try {
            String payload = idToken.split("\\.")[1];
            return json.readTree(Base64.getUrlDecoder().decode(payload)).path("email").asText(null);
        } catch (Exception ex) {
            return null;
        }
    }

    private JsonNode postForm(String url, Map<String, String> form) {
        String body = form.entrySet().stream()
                .map(e -> e.getKey() + "=" + enc(e.getValue()))
                .collect(Collectors.joining("&"));
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();
        return send(req);
    }

    private JsonNode get(String url, String accessToken) {
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(10))
                .header("Authorization", "Bearer " + accessToken)
                .GET()
                .build();
        return send(req);
    }

    private JsonNode send(HttpRequest req) {
        try {
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                if (res.body() != null && res.body().contains("invalid_grant")) {
                    throw new RevokedException();
                }
                throw new IllegalStateException(
                        "Google API failed: HTTP " + res.statusCode() + " " + res.body());
            }
            return json.readTree(res.body());
        } catch (RevokedException | IllegalStateException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalStateException("Could not reach Google", ex);
        }
    }

    private static String enc(String v) {
        return URLEncoder.encode(v, StandardCharsets.UTF_8);
    }
}
