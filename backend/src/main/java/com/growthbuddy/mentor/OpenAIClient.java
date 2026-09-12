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
 * Minimal OpenAI Chat Completions client built on the JDK HttpClient (no extra
 * SDK to keep dependencies thin). Stateless: each call sends the whole rolling
 * conversation. Callers cap history before sending.
 */
@Component
public class OpenAIClient {

    private static final Logger log = LoggerFactory.getLogger(OpenAIClient.class);

    /**
     * Per-user ceiling on actual OpenAI calls, counted here rather than at the
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
            @Value("${growthbuddy.mentor.model:gpt-4o-mini}") String model,
            @Value("${growthbuddy.mentor.base-url:https://api.openai.com/v1}") String baseUrl,
            RateLimiter limiter) {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl;
        this.limiter = limiter;
        if (isConfigured()) {
            log.info("OpenAI client enabled (model={}, baseUrl={})", model, baseUrl);
        } else {
            log.warn("OpenAI client disabled: OPENAI_API_KEY / MENTOR_API_KEY not found in process environment");
        }
    }

    public boolean isConfigured() {
        return StringUtils.hasText(apiKey);
    }

    /**
     * Send the system prompt + chat history and return the assistant's text.
     * Uses the Responses API (/v1/responses), which accepts a chat-style
     * {@code input} array and supports newer models like gpt-5.x and gpt-4o.
     * Throws on transport errors / non-2xx responses so callers can fall back.
     */
    public String complete(String systemPrompt, List<ChatTurn> turns) {
        if (!isConfigured()) {
            throw new IllegalStateException("OPENAI_API_KEY is not set");
        }
        chargeBudget();
        List<Map<String, String>> input = new ArrayList<>();
        if (StringUtils.hasText(systemPrompt)) {
            input.add(Map.of("role", "system", "content", systemPrompt));
        }
        for (ChatTurn t : turns) {
            input.add(Map.of("role", t.role(), "content", t.content()));
        }
        Map<String, Object> body = Map.of(
                "model", model,
                "input", input
        );
        try {
            String payload = json.writeValueAsString(body);
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/responses"))
                    .timeout(Duration.ofSeconds(45))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(payload))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                log.warn("OpenAI returned {}: {}", res.statusCode(), res.body());
                throw new IllegalStateException("OpenAI " + res.statusCode());
            }
            return extractContent(res.body());
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Bad request body", ex);
        } catch (java.io.IOException | InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("OpenAI request failed", ex);
        }
    }

    /**
     * Send one user turn with text + image using the Responses API.
     */
    public String completeWithImage(String systemPrompt, String userPrompt, String imageDataUrl) {
        chargeBudget();
        if (!isConfigured()) {
            throw new IllegalStateException("OPENAI_API_KEY is not set");
        }
        if (!StringUtils.hasText(userPrompt) || !StringUtils.hasText(imageDataUrl)) {
            throw new IllegalArgumentException("userPrompt and imageDataUrl are required");
        }

        List<Map<String, Object>> input = new ArrayList<>();
        if (StringUtils.hasText(systemPrompt)) {
            input.add(Map.of("role", "system", "content", systemPrompt));
        }

        List<Map<String, Object>> content = new ArrayList<>();
        content.add(Map.of("type", "input_text", "text", userPrompt));
        content.add(Map.of("type", "input_image", "image_url", imageDataUrl));
        input.add(Map.of("role", "user", "content", content));

        Map<String, Object> body = Map.of(
                "model", model,
                "input", input
        );

        try {
            String payload = json.writeValueAsString(body);
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/responses"))
                    .timeout(Duration.ofSeconds(45))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(payload))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                log.warn("OpenAI (image) returned {}: {}", res.statusCode(), res.body());
                throw new IllegalStateException("OpenAI " + res.statusCode());
            }
            return extractContent(res.body());
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Bad request body", ex);
        } catch (java.io.IOException | InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("OpenAI request failed", ex);
        }
    }

    /**
     * Pull the assistant text out of a Responses API payload.
     *
     * <p>Responses API shape:
     * <pre>{@code
     * { "output": [
     *     { "type": "message",
     *       "content": [ { "type": "output_text", "text": "..." }, ... ] },
     *     ... ] }
     * }</pre>
     *
     * <p>Some SDK responses also include a flattened {@code output_text} field;
     * we fall back to it if present.
     */
    private String extractContent(String body) {
        try {
            var root = json.readTree(body);
            var flat = root.path("output_text");
            if (flat.isTextual() && !flat.asText().isBlank()) {
                return flat.asText();
            }
            var output = root.path("output");
            StringBuilder sb = new StringBuilder();
            for (var item : output) {
                if (!"message".equals(item.path("type").asText())) continue;
                for (var part : item.path("content")) {
                    String type = part.path("type").asText();
                    if ("output_text".equals(type) || "text".equals(type)) {
                        if (sb.length() > 0) sb.append("\n");
                        sb.append(part.path("text").asText());
                    }
                }
            }
            return sb.toString();
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException("Could not parse OpenAI response", ex);
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
