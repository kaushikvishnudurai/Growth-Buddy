package com.growthbuddy.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.mentor.OpenAIClient;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The one camera button: guesses which scanner a photo belongs to (receipt,
 * plate, groceries) so the client can preselect it. {kind: null} is the
 * fallback, and the client shows the same three-choice picker either way, so
 * this never fails a request over the AI: no token, a 429 budget, garbage
 * JSON or an unknown label all answer null.
 */
@RestController
public class PhotoRouteController {

    static final String PROMPT = "Classify this photo as exactly one of receipt, plate (cooked food or a meal), "
            + "groceries (fridge, pantry shelf, shopping haul). Strict JSON {\"kind\":\"receipt\"|\"plate\"|\"groceries\"}";
    private static final Set<String> KINDS = Set.of("receipt", "plate", "groceries");
    private static final Pattern IMAGE =
            Pattern.compile("data:image/(jpeg|jpg|png|webp);base64,", Pattern.CASE_INSENSITIVE);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final OpenAIClient openai;

    public PhotoRouteController(OpenAIClient openai) {
        this.openai = openai;
    }

    // Same cap as the other scan requests (GroceryScanRequest: 2,000,000 chars).
    public record RouteRequest(@NotBlank @Size(max = 2_000_000) String imageDataUrl) {}

    @PostMapping("/api/photo/route")
    public Map<String, Object> route(@Valid @RequestBody RouteRequest req) {
        String img = req == null ? null : req.imageDataUrl();
        if (img == null || !IMAGE.matcher(img).lookingAt()) {
            throw ApiException.badRequest("Send a JPEG, PNG or WebP photo.");
        }
        Map<String, Object> out = new HashMap<>();
        out.put("kind", classify(img));
        return out;
    }

    String classify(String img) {
        if (!openai.isConfigured()) {
            return null;
        }
        try {
            String raw = openai.completeWithImage(PROMPT, "Which one is it? Strict JSON only.", img);
            String kind = JSON.readTree(OpenAIClient.jsonOf(raw)).path("kind").asText("").toLowerCase(Locale.ROOT);
            return KINDS.contains(kind) ? kind : null;
        } catch (Exception e) {
            return null;
        }
    }
}
