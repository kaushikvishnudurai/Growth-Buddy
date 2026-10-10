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
        return complete(systemPrompt, turns, MAX_TOKENS);
    }

    /** {@link #complete(String, List)} with a tighter reply ceiling (the mentor's chat turns). */
    public String complete(String systemPrompt, List<ChatTurn> turns, int maxTokens) {
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
                "max_tokens", Math.max(1, Math.min(maxTokens, MAX_TOKENS)),
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
        } catch (InterruptedException ex) {
            // Only an interrupt re-asserts the flag. Setting it on an IOException
            // too (a timeout, a reset) left the request thread marked interrupted,
            // and the next blocking call on it — the DB save after the fallback —
            // could fail for no reason of its own.
            Thread.currentThread().interrupt();
            throw new IllegalStateException("AI gateway request interrupted", ex);
        } catch (java.io.IOException ex) {
            throw new IllegalStateException("AI gateway request failed", ex);
        }
    }

    /**
     * {@link #complete(String, List, int)} as a stream: {@code "stream": true} on
     * the same compat endpoint, read line by line, each {@code data:} chunk's
     * {@code choices[0].delta.content} handed to {@code onDelta} as it lands.
     * Returns the whole text.
     *
     * <p>Charges the budget like every other call, against {@link CurrentUser} —
     * a caller running this off the request thread must set it there first, or
     * the call is billed to the shared "system" budget. The 429 is thrown before
     * any byte is requested, so it can never arrive after a delta.
     *
     * <p>{@code cancelled} is polled between lines; once it reads true the
     * response stream is closed, which drops the upstream connection and stops
     * the tokens. ponytail: a gateway that stalls mid-body blocks the read until
     * it closes — HttpClient's timeout covers the headers only. Bound it with a
     * watchdog that closes the stream if that ever shows up in the logs.
     */
    public String stream(String systemPrompt, List<ChatTurn> turns, int maxTokens,
                         java.util.function.Consumer<String> onDelta,
                         java.util.function.BooleanSupplier cancelled) {
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
                "max_tokens", Math.max(1, Math.min(maxTokens, MAX_TOKENS)),
                "stream", true,
                "messages", messages
        );
        StringBuilder all = new StringBuilder();
        try {
            String payload = json.writeValueAsString(body);
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint()))
                    .timeout(Duration.ofSeconds(45))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream")
                    .POST(HttpRequest.BodyPublishers.ofString(payload))
                    .build();
            HttpResponse<java.util.stream.Stream<String>> res =
                    http.send(req, HttpResponse.BodyHandlers.ofLines());
            try (java.util.stream.Stream<String> lines = res.body()) {
                if (res.statusCode() / 100 != 2) {
                    String err = String.join("\n", lines.limit(20).toList());
                    log.warn("AI gateway (stream) returned {}: {}", res.statusCode(), err);
                    throw new IllegalStateException("AI gateway " + res.statusCode());
                }
                java.util.Iterator<String> it = lines.iterator();
                while (!cancelled.getAsBoolean() && it.hasNext()) {
                    StreamChunk chunk = parseStreamLine(it.next());
                    if (chunk == null) continue;
                    if (chunk.done()) break;
                    all.append(chunk.text());
                    onDelta.accept(chunk.text());
                }
            }
            return all.toString();
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Bad request body", ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("AI gateway request interrupted", ex);
        } catch (java.io.IOException | java.io.UncheckedIOException ex) {
            throw new IllegalStateException("AI gateway request failed", ex);
        }
    }

    /** One parsed line of a streamed reply: some text, or the end marker. */
    record StreamChunk(String text, boolean done) {
        static final StreamChunk DONE = new StreamChunk("", true);
    }

    private static final ObjectMapper STREAM_JSON = new ObjectMapper();

    /**
     * Parse one line of an OpenAI-style event stream. Pure, so it is tested
     * without a gateway.
     *
     * <ul>
     *   <li>{@code data: [DONE]} → {@link StreamChunk#DONE}</li>
     *   <li>{@code data: {"choices":[{"delta":{"content":"Hi"}}]}} → "Hi"</li>
     *   <li>blank lines, {@code :} comments (keep-alives), {@code event:}/{@code id:}
     *       lines, a chunk with no text (the role-only first delta, the
     *       finish_reason one) and malformed JSON → {@code null}, skipped. One bad
     *       line costs a few characters; failing the reply over it costs all of them.</li>
     *   <li>{@code data: {"error":…}} → throws: the provider gave up mid-stream, and
     *       skipping it would end the reply short with no word as to why.</li>
     * </ul>
     */
    static StreamChunk parseStreamLine(String line) {
        if (line == null || !line.startsWith("data:")) return null;
        String data = line.substring(5).trim();
        if (data.isEmpty()) return null;
        if ("[DONE]".equals(data)) return StreamChunk.DONE;
        com.fasterxml.jackson.databind.JsonNode node;
        try {
            node = STREAM_JSON.readTree(data);
        } catch (JsonProcessingException ex) {
            return null;
        }
        if (node == null || !node.isObject()) return null;
        if (node.hasNonNull("error")) {
            throw new IllegalStateException("AI gateway stream error: "
                    + node.path("error").path("message").asText(node.path("error").toString()));
        }
        var content = node.path("choices").path(0).path("delta").path("content");
        String text;
        if (content.isTextual()) {
            text = content.asText();
        } else {
            StringBuilder sb = new StringBuilder();
            for (var part : content) sb.append(part.path("text").asText(""));
            text = sb.toString();
        }
        return text.isEmpty() ? null : new StreamChunk(text, false);
    }

    /**
     * Send one user turn with text + image.
     */
    public String completeWithImage(String systemPrompt, String userPrompt, String imageDataUrl) {
        // Checked before charging: a call that can never be sent must not spend
        // the user's hourly budget (it did, and an unconfigured deploy's photo
        // estimates ran users into a 429 for calls that never left the server).
        if (!isConfigured()) {
            throw new IllegalStateException("AI_GATEWAY_TOKEN is not set");
        }
        if (!StringUtils.hasText(userPrompt) || !StringUtils.hasText(imageDataUrl)) {
            throw new IllegalArgumentException("userPrompt and imageDataUrl are required");
        }
        chargeBudget();

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
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("AI gateway request interrupted", ex);
        } catch (java.io.IOException ex) {
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

    /**
     * The JSON document inside a model reply.
     *
     * <p>OpenAI was asked for JSON and returned bare JSON. Claude answers the
     * same prompts with ```json fences, and sometimes a "Here's the JSON:" line
     * in front — so every caller that handed the raw text to {@code readTree}
     * started throwing the day we moved gateways, and silently served its canned
     * fallback instead. Nutrition suggestions, photo calorie estimates: all of
     * them, all at once.
     *
     * <p>ponytail: first opening bracket to the last matching one, not a parser.
     * Trailing prose containing a stray brace would trim wrong; no prompt here
     * asks for prose. If one ever does, parse with {@code JsonParser} instead.
     */
    public static String jsonOf(String raw) {
        if (raw == null) {
            return "";
        }
        String s = raw.trim();
        int obj = s.indexOf('{');
        int arr = s.indexOf('[');
        int start = obj < 0 ? arr : (arr < 0 ? obj : Math.min(obj, arr));
        if (start < 0) {
            return s;
        }
        int end = s.lastIndexOf(s.charAt(start) == '{' ? '}' : ']');
        return end > start ? s.substring(start, end + 1) : s;
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
