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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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

    private final String apiKey;
    private final String model;
    private final String baseUrl;
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    public OpenAIClient(
            @Value("${growthbuddy.mentor.api-key:}") String apiKey,
            @Value("${growthbuddy.mentor.model:gpt-4o-mini}") String model,
            @Value("${growthbuddy.mentor.base-url:https://api.openai.com/v1}") String baseUrl) {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl;
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
}
