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

    /** The whole document plus the version a later write must match. */
    public record Versioned(JsonNode data, String version) {}

    /**
     * A version tag for the stored document: a hash of the document itself, so it
     * changes exactly when the content does. "0" means nothing is stored yet (an
     * empty object hashes to 0 too, which is the same thing to a first write).
     *
     * <p>ponytail: content hash, not {@code updatedAt}. That column is a MySQL
     * TIMESTAMP — whole seconds — so the epoch-millis tag handed back after a
     * write never matched the truncated value read back on the next one, and
     * every conditional save 409'd with "changed somewhere else" against itself.
     * A hash needs no column, no migration, and no clock. If 32 bits ever feels
     * thin, move to a real @Version column.
     */
    private static String versionOf(MoneyState state) {
        JsonNode data = state == null ? null : state.getData();
        return data == null ? "0" : Integer.toHexString(data.hashCode());
    }

    @Transactional(readOnly = true)
    public Versioned get(UUID userId) {
        return repo.findById(userId)
                .map(s -> new Versioned(s.getData(), versionOf(s)))
                .orElseGet(() -> new Versioned(json.createObjectNode(), "0"));
    }

    /**
     * Replace the document, optionally only if it still looks the way the caller
     * last saw it.
     *
     * <p>This endpoint takes the WHOLE money document on every edit, so two
     * clients editing at once — a phone and a laptop, or two tabs — meant the
     * slower save silently overwrote the faster one's expenses. In-tab ordering
     * was already handled by a promise queue on the client; nothing covered two
     * of them.
     *
     * <p>{@code expectedVersion} comes from the caller's {@code If-Match}. Absent,
     * the write goes through unconditionally — old clients keep working. Present
     * and stale, it is refused with 409 and the caller merges and retries.
     */
    @Transactional
    public Versioned save(UUID userId, JsonNode body, String expectedVersion) {
        if (body == null || !body.isObject()) {
            throw ApiException.badRequest("Money data must be a JSON object.");
        }
        if (body.toString().length() > MAX_BYTES) {
            throw ApiException.badRequest("Money data is too large.");
        }
        MoneyState state = repo.findById(userId).orElseGet(MoneyState::new);
        if (expectedVersion != null && !expectedVersion.isBlank()
                && !expectedVersion.equals(versionOf(state))) {
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT,
                    "Your money data changed somewhere else.");
        }
        state.setUserId(userId);
        state.setData(body);
        MoneyState saved = repo.save(state);
        return new Versioned(saved.getData(), versionOf(saved));
    }
}
