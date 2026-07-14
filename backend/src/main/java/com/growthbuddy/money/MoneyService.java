package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.mentor.OpenAIClient.ChatTurn;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class MoneyService {

    private static final Logger log = LoggerFactory.getLogger(MoneyService.class);

    /** Guard against an unbounded blob (the doc holds a user's whole history). */
    private static final int MAX_BYTES = 512 * 1024;

    /** Warm money coach. Mirrors the Mentor's tone: encouraging, never guilt. */
    private static final String ADVISOR_PROMPT = """
            You are Buddy, a warm, honest money coach inside the Growth Buddy app.
            The user is weighing a purchase. Using their item, price, stated reason,
            and money context, give a genuine second opinion — not a reflexive no.
            Lead with a clear recommendation (e.g. "Go for it", "Maybe sleep on it",
            "Worth a short pause"), then 2-3 sentences of specific, kind reasoning
            that references their actual budget room and savings goals when relevant.
            Money is growth, never shame. Under 90 words. Plain prose, no Markdown,
            no bullet stars. Speak in second person.
            """;

    private final MoneyRepository repo;
    private final ObjectMapper json;
    private final OpenAIClient openai;

    public MoneyService(MoneyRepository repo, ObjectMapper json, OpenAIClient openai) {
        this.repo = repo;
        this.json = json;
        this.openai = openai;
    }

    /** Clamp free-text fields that flow into the LLM prompt (trust boundary). */
    private static String cap(String s, int max) {
        if (s == null) return "";
        s = s.strip();
        return s.length() <= max ? s : s.substring(0, max);
    }

    /**
     * AI purchase advice. Returns {@code configured=false} when no API key is
     * set or the call fails, so the frontend falls back to its local heuristic.
     */
    public AdviceResult advise(String item, int price, String reason, String context) {
        if (!openai.isConfigured() || cap(item, 100).isEmpty()) {
            return new AdviceResult(false, null);
        }
        String user = "Item: " + cap(item, 100)
                + "\nPrice: " + Math.max(0, price)
                + "\nWhy they want it: " + cap(reason, 300)
                + "\nTheir money context: " + cap(context, 800)
                + "\n\nGive your honest recommendation.";
        try {
            String advice = openai.complete(ADVISOR_PROMPT, List.of(new ChatTurn("user", user))).trim();
            return StringUtils.hasText(advice) ? new AdviceResult(true, advice) : new AdviceResult(false, null);
        } catch (RuntimeException ex) {
            log.warn("Money advisor LLM call failed, falling back to heuristic: {}", ex.getMessage());
            return new AdviceResult(false, null);
        }
    }

    public record AdviceResult(boolean configured, String advice) {}

    @Transactional(readOnly = true)
    public JsonNode get(UUID userId) {
        return repo.findById(userId)
                .map(MoneyState::getData)
                .orElseGet(json::createObjectNode);
    }

    @Transactional
    public JsonNode save(UUID userId, JsonNode body) {
        if (body == null || !body.isObject()) {
            throw ApiException.badRequest("Money data must be a JSON object.");
        }
        if (body.toString().length() > MAX_BYTES) {
            throw ApiException.badRequest("Money data is too large.");
        }
        MoneyState state = repo.findById(userId).orElseGet(MoneyState::new);
        state.setUserId(userId);
        state.setData(body);
        return repo.save(state).getData();
    }
}
