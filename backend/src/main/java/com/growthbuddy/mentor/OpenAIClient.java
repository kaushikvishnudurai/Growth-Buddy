package com.growthbuddy.mentor;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.CurrentUser;
import com.growthbuddy.common.RateLimiter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Minimal chat-completions client built on the JDK HttpClient (no SDK, to keep
 * dependencies thin). Stateless: each call sends the whole rolling conversation.
 * Callers cap history before sending.
 *
 * <p>It talks to Claude through a <b>Cloudflare AI Gateway</b>, whose
 * {@code /compat/chat/completions} endpoint speaks the OpenAI wire format — same
 * request shape, {@code provider/model} in the model field, one bearer token.
 * That is why moving off OpenAI was config plus the payload shape below, and not
 * a new dependency.
 *
 * <p>It used to call OpenAI's Responses API ({@code /responses}, {@code input},
 * {@code output_text}), which the compat endpoint does not speak: requests now
 * send {@code messages} and replies are read from
 * {@code choices[0].message.content}.
 */
@Component
public class OpenAIClient {

    private static final Logger log = LoggerFactory.getLogger(OpenAIClient.class);

    /** Claude wants an explicit ceiling where OpenAI supplied a default. */
    private static final int  MAX_TOKENS  = 2048;

    /**
     * Per-user ceiling on actual AI calls, counted here rather than at the
     * edge. {@link com.growthbuddy.common.AiRateLimitInterceptor} caps the same
     * spend at 40/hour, but only on the paths someone remembered to add to an
     * allowlist in WebConfig — and the four vision endpoints, the most expensive
     * calls in the app, were missing from it for months. An allowlist you have to
     * remember to extend is not a budget.
     *
     * <p>Deliberately looser than the interceptor's 40, and on its own counter, so
     * it never changes the answer for an endpoint that IS listed: the interceptor
     * still bites first there, before the handler runs, which is the only way to
     * return a clean 429. This is the backstop for the one nobody listed, and it
     * counts calls rather than requests — a multi-day meal plan is several.
     */
    private static final int  CALL_LIMIT  = 60;
    private static final long CALL_WINDOW_MS = 60 * 60_000L;

    private final String apiKey;
    private final String model;
    private final String baseUrl;
    private final RateLimiter limiter;
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    public OpenAIClient(
            @Value("${growthbuddy.mentor.api-key:}") String apiKey,
            @Value("${growthbuddy.mentor.model:anthropic/claude-sonnet-4-5}") String model,
            @Value("${growthbuddy.mentor.base-url:}") String baseUrl,
            RateLimiter limiter) {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl;
        this.limiter = limiter;
        if (isConfigured()) {
            log.info("AI client enabled (model={}, endpoint={})", model, endpoint());
        } else {
            log.warn("AI client disabled: AI_GATEWAY_TOKEN / AI_GATEWAY_URL not found in process environment");
        }
    }

    /**
     * The full completions URL. Takes either the gateway root or the complete
     * endpoint — the Cloudflare console hands you the long form, every
     * OpenAI-shaped base URL is the short one, and guessing wrong is a 404 an
     * hour after deploy. One endsWith buys both.
     */
    private String endpoint() {
        String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        return base.endsWith("/chat/completions") ? base : base + "/chat/completions";
    }

    /**
     * Both halves or nothing. The gateway URL is account-specific and lives in
     * the environment, never in this repo, so a deploy that has the token but
     * not the URL is a real possibility — and every AI feature already has a
     * graceful "not configured" path. Taking it beats posting to a URL that is
     * the empty string.
     */
    public boolean isConfigured() {
        return StringUtils.hasText(apiKey) && StringUtils.hasText(baseUrl);
    }

    /**
     * Send the system prompt + chat history and return the assistant's text.
     * Throws on transport errors / non-2xx responses so callers can fall back.
     */
    public String complete(String systemPrompt, List<ChatTurn> turns) {
        if (!isConfigured()) {
            throw new IllegalStateException("AI_GATEWAY_TOKEN is not set");
        }
        chargeBudget();
        List<Map<String, String>> messages = new ArrayList<>();
        if (StringUtils.hasText(systemPrompt)) {
            messages.add(Map.of("role", "system", "content", systemPrompt));
        }
        for (ChatTurn t : turns) {
            messages.add(Map.of("role", t.role(), "content", t.content()));
        }
        Map<String, Object> body = Map.of(
                "model", model,
                "max_tokens", MAX_TOKENS,
                "messages", messages
        );
        try {
            String payload = json.writeValueAsString(body);
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint()))
                    .timeout(Duration.ofSeconds(45))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(payload))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                log.warn("AI gateway returned {}: {}", res.statusCode(), res.body());
                throw new IllegalStateException("AI gateway " + res.statusCode());
            }
            return extractContent(res.body());
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Bad request body", ex);
        } catch (java.io.IOException | InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("AI gateway request failed", ex);
        }
    }

    /**
     * Send one user turn with text + image.
     */
    public String completeWithImage(String systemPrompt, String userPrompt, String imageDataUrl) {
        chargeBudget();
        if (!isConfigured()) {
            throw new IllegalStateException("AI_GATEWAY_TOKEN is not set");
        }
        if (!StringUtils.hasText(userPrompt) || !StringUtils.hasText(imageDataUrl)) {
            throw new IllegalArgumentException("userPrompt and imageDataUrl are required");
        }

        List<Map<String, Object>> messages = new ArrayList<>();
        if (StringUtils.hasText(systemPrompt)) {
            messages.add(Map.of("role", "system", "content", systemPrompt));
        }

        // Chat-completions shape: image_url is an OBJECT holding a url, where the
        // Responses API took a bare string. This is the one part of the payload
        // the compat endpoint does not forgive.
        List<Map<String, Object>> content = new ArrayList<>();
        content.add(Map.of("type", "text", "text", userPrompt));
        content.add(Map.of("type", "image_url", "image_url", Map.of("url", imageDataUrl)));
        messages.add(Map.of("role", "user", "content", content));

        Map<String, Object> body = Map.of(
                "model", model,
                "max_tokens", MAX_TOKENS,
                "messages", messages
        );

        try {
            String payload = json.writeValueAsString(body);
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint()))
                    .timeout(Duration.ofSeconds(45))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(payload))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                log.warn("AI gateway (image) returned {}: {}", res.statusCode(), res.body());
                throw new IllegalStateException("AI gateway " + res.statusCode());
            }
            return extractContent(res.body());
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Bad request body", ex);
        } catch (java.io.IOException | InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("AI gateway request failed", ex);
        }
    }

    /**
     * Pull the assistant text out of a chat-completions payload:
     * {@code {"choices":[{"message":{"content":"…"}}]}}.
     *
     * <p>Package-private so {@code AiPayloadTest} can hold it to that shape
     * without a gateway. This is the half of the move off OpenAI that fails
     * <em>silently</em> — a parser aimed at the old shape returns "" and every
     * AI feature quietly serves its fallback — so it is the half with a test.
     */
    String extractContent(String body) {
        try {
            var content = json.readTree(body).path("choices").path(0).path("message").path("content");
            if (content.isTextual()) {
                return content.asText();
            }
            // Some providers answer with content as an array of typed parts.
            StringBuilder sb = new StringBuilder();
            for (var part : content) {
                String text = part.path("text").asText("");
                if (!text.isBlank()) {
                    if (sb.length() > 0) sb.append("\n");
                    sb.append(text);
                }
            }
            return sb.toString();
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException("Could not parse AI gateway response", ex);
        }
    }

    public record ChatTurn(String role, String content) {}

    /**
     * Count this call against the acting user and refuse past the ceiling.
     *
     * <p>Throws {@link ApiException} 429, so an endpoint that does NOT swallow it
     * tells the user something true. One that does swallow it into a fallback
     * still gets what matters: the request never reaches OpenAI, so it costs
     * nothing. That is the point of putting the check here — cost control that
     * does not depend on every caller behaving.
     *
     * <p>Calls with no request behind them (the schedulers) count against one
     * shared "system" budget rather than going uncounted.
     */
    private void chargeBudget() {
        String who;
        try {
            who = "u:" + CurrentUser.id();
        } catch (RuntimeException noRequest) {
            who = "system";
        }
        if (!limiter.allow("aicall:" + who, CALL_LIMIT, CALL_WINDOW_MS)) {
            log.warn("AI call budget exhausted for {}", who);
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,
                    "You've used the AI features a lot in the last hour — take a short break and try again.");
        }
    }
}
