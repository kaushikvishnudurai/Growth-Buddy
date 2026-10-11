package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Setu's Account Aggregator gateway, as an FIU: the user approves a consent once
 * on their AA's screen, and from then on bank transactions arrive as structured
 * JSON — no SMS reading, no statement parsing.
 *
 * <p>Inert until every credential is set (like VAPID and WhatsApp): {@link
 * #isConfigured()} false hides the feature and every route answers "not
 * configured". Nothing here logs a secret, a token, or a transaction.
 *
 * <p>Shapes from Setu's docs (read 2026-10-11):
 * <ul>
 *   <li>Consent: https://docs.setu.co/data/account-aggregator/api-integration/consent-flow
 *       ({@code POST /consents} -> {id, url, status}; {@code GET /consents/:id} -> status,
 *       accountsLinked[{maskedAccNumber, fipId, linkRefNumber}];
 *       {@code POST /v2/consents/:id/revoke})</li>
 *   <li>Consent fields: https://docs.setu.co/data/account-aggregator/consent-object</li>
 *   <li>Data: https://docs.setu.co/data/account-aggregator/api-integration/data-apis
 *       ({@code POST /sessions} {consentId, dataRange, format}; {@code GET /sessions/:id} ->
 *       status + fips[].accounts[].data.account.transactions.transaction[])</li>
 *   <li>Headers: {@code Authorization: Bearer <token>}, {@code x-product-instance-id}.</li>
 * </ul>
 */
@Component
public class BankFeedClient {

    private final String baseUrl;
    private final String authUrl;
    private final String clientId;
    private final String clientSecret;
    private final String productInstanceId;
    private final String redirectUrl;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();

    private String token;
    private Instant tokenUntil = Instant.EPOCH;

    public BankFeedClient(
            @Value("${growthbuddy.bankfeed.base-url:https://fiu-sandbox.setu.co}") String baseUrl,
            @Value("${growthbuddy.bankfeed.auth-url:https://accountservice.setu.co/v1/users/login}") String authUrl,
            @Value("${growthbuddy.bankfeed.client-id:}") String clientId,
            @Value("${growthbuddy.bankfeed.client-secret:}") String clientSecret,
            @Value("${growthbuddy.bankfeed.product-instance-id:}") String productInstanceId,
            @Value("${growthbuddy.bankfeed.redirect-url:}") String redirectUrl,
            ObjectMapper json) {
        this.baseUrl = strip(baseUrl);
        this.authUrl = authUrl;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.productInstanceId = productInstanceId;
        this.redirectUrl = redirectUrl;
        this.json = json;
    }

    public boolean isConfigured() {
        return StringUtils.hasText(baseUrl) && StringUtils.hasText(clientId) && StringUtils.hasText(clientSecret)
                && StringUtils.hasText(productInstanceId) && StringUtils.hasText(redirectUrl);
    }

    public record Consent(String id, String url, String status, List<String[]> accounts) {}

    /** A periodic, transactions-only consent for the user's deposit accounts. */
    public Consent createConsent(String mobile, LocalDate from, LocalDate until) {
        JsonNode r = call("POST", "/consents", consentBody(mobile, from, until));
        return new Consent(r.path("id").asText(), r.path("url").asText(), r.path("status").asText("PENDING"), List.of());
    }

    public Consent consent(String consentId) {
        JsonNode r = call("GET", "/consents/" + consentId, null);
        List<String[]> accounts = new ArrayList<>();
        for (JsonNode a : r.path("accountsLinked")) {
            accounts.add(new String[] {a.path("maskedAccNumber").asText(""), a.path("fipId").asText("")});
        }
        return new Consent(consentId, r.path("url").asText(null), r.path("status").asText(""), accounts);
    }

    public void revoke(String consentId) {
        call("POST", "/v2/consents/" + consentId + "/revoke", json.createObjectNode());
    }

    /** A data session over [from, to]; its id. The data arrives on the session's own GET. */
    public String createSession(String consentId, Instant from, Instant to) {
        ObjectNode body = json.createObjectNode().put("consentId", consentId).put("format", "json");
        body.putObject("dataRange").put("from", from.toString()).put("to", to.toString());
        return call("POST", "/sessions", body).path("id").asText();
    }

    public JsonNode session(String sessionId) {
        return call("GET", "/sessions/" + sessionId, null);
    }

    /**
     * UNCONFIRMED against a live account: the consent-object page lists these as
     * mandatory, but the request example on the consent-flow page shows only
     * consentDuration / vua / dataRange / context, and the Bridge product may
     * template the rest. Purpose 102 is ReBIT's "Customer spending patterns,
     * budget or other reportings"; TRANSACTIONS only, the least the feature
     * needs. The sandbox's answer to this body is the first thing to check.
     */
    ObjectNode consentBody(String mobile, LocalDate from, LocalDate until) {
        ObjectNode b = json.createObjectNode();
        b.put("vua", mobile); // a bare mobile number lets Setu pick the AA
        b.put("redirectUrl", redirectUrl);
        b.putObject("consentDuration").put("unit", "MONTH").put("value", "12");
        b.putObject("dataRange")
                .put("from", from.atStartOfDay().toInstant(ZoneOffset.UTC).toString())
                .put("to", until.atStartOfDay().toInstant(ZoneOffset.UTC).toString());
        b.put("fetchType", "PERIODIC");
        b.putObject("frequency").put("unit", "MONTH").put("value", 30);
        b.putArray("fiTypes").add("DEPOSIT");
        b.putArray("consentTypes").add("TRANSACTIONS");
        b.put("consentMode", "STORE");
        b.putObject("dataLife").put("unit", "MONTH").put("value", 12);
        ObjectNode purpose = b.putObject("purpose");
        purpose.put("code", "102").put("refUri", "https://api.rebit.org.in/aa/purpose/102.xml")
                .put("text", "Customer spending patterns, budget or other reportings");
        purpose.putObject("Category").put("type", "string");
        b.putArray("context");
        return b;
    }

    private JsonNode call(String method, String path, JsonNode body) {
        HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + token())
                .header("x-product-instance-id", productInstanceId);
        rb = body == null ? rb.GET() : rb.method(method, HttpRequest.BodyPublishers.ofString(body.toString()));
        return send(rb.build(), method + " " + path.replaceAll("/[0-9a-fA-F-]{20,}", "/:id"));
    }

    private JsonNode send(HttpRequest req, String what) {
        try {
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                // Setu's error body names the problem (consent not active, frequency exceeded);
                // it carries no transaction data, so its message is safe to surface.
                String msg = "";
                try {
                    JsonNode e = json.readTree(res.body());
                    msg = e.path("errorMsg").asText(e.path("message").asText(""));
                } catch (Exception ignored) {
                    // not JSON
                }
                throw new SetuException(res.statusCode(), what + " answered " + res.statusCode()
                        + (msg.isBlank() ? "" : ": " + (msg.length() > 160 ? msg.substring(0, 160) : msg)));
            }
            return res.body() == null || res.body().isBlank() ? json.createObjectNode() : json.readTree(res.body());
        } catch (SetuException ex) {
            throw ex;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new SetuException(0, what + " interrupted");
        } catch (Exception ex) {
            throw new SetuException(0, what + " failed: " + ex.getClass().getSimpleName());
        }
    }

    /**
     * UNCONFIRMED: the token call. Setu's docs describe POST {clientID, secret,
     * grant_type: client_credentials} to accountservice.setu.co/v1/users/login,
     * reissued "at the 4th minute" (a token lives 5), but show no response body
     * for the AA product; the Bridge generate-token page answers {data: {token,
     * expiresIn}}. Both shapes are read. The URL is configurable
     * ({@code SETU_AUTH_URL}) for the same reason.
     */
    synchronized String token() {
        if (token != null && Instant.now().isBefore(tokenUntil)) {
            return token;
        }
        ObjectNode body = json.createObjectNode()
                .put("clientID", clientId).put("secret", clientSecret).put("grant_type", "client_credentials");
        JsonNode r = send(HttpRequest.newBuilder(URI.create(authUrl))
                .timeout(Duration.ofSeconds(15))
                .header("Content-Type", "application/json")
                .header("client", "bridge")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build(), "token");
        String t = r.path("access_token").asText(r.path("accessToken").asText(r.path("data").path("token").asText("")));
        if (t.isBlank()) {
            throw new SetuException(0, "token answer carried no token");
        }
        token = t;
        tokenUntil = Instant.now().plusSeconds(240);
        return token;
    }

    private static String strip(String s) {
        return s == null ? "" : s.replaceAll("/+$", "");
    }

    /** A Setu call that failed; the message is safe to show (no data, no secrets). */
    public static class SetuException extends RuntimeException {
        final int status;

        SetuException(int status, String message) {
            super(message);
            this.status = status;
        }
    }
}
