package com.growthbuddy.common;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.family.FamilyService;
import com.growthbuddy.food.FoodService;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.money.MoneyController;
import com.growthbuddy.money.MoneyService;
import com.growthbuddy.user.FeatureLocks;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The photo sheet's one AI call (snap.js routePhoto: Quick add's Photo, or a
 * picture shared in). {@code /api/photo/read} guesses the kind AND reads the
 * photo in ONE vision call: the prompt holds each reader's own rules, the model
 * names the kind and answers in that kind's format, and the answer goes through
 * that feature's own checks ({@code MoneyService.receiptFrom},
 * {@code FoodService.plateFrom}, {@code FamilyService.pantryFrom}, which adds to
 * the pantry as a scan does; the client takes them back out if the user doesn't
 * choose Groceries). The client opens that screen already filled in; a kind the
 * user picks instead calls its own reader. {kind: null} is the fallback (the
 * same three-choice picker), so this never fails a request over the AI: no
 * token, a 429 budget, garbage JSON or an unknown label all answer null.
 */
@RestController
public class PhotoRouteController {

    private static final Set<String> KINDS = Set.of("receipt", "plate", "groceries");
    private static final Pattern IMAGE =
            Pattern.compile("data:image/(jpeg|jpg|png|webp);base64,", Pattern.CASE_INSENSITIVE);
    private static final ObjectMapper JSON = new ObjectMapper();

    /** The feature each kind belongs to: a kind whose feature an operator locked is not offered to the model. */
    private static final Map<String, String> FEATURE = Map.of("receipt", "money", "plate", "food", "groceries", "family");

    private final OpenAIClient openai;
    private final MoneyService money;
    private final FoodService food;
    private final FamilyService family;

    public PhotoRouteController(OpenAIClient openai, MoneyService money, FoodService food, FamilyService family) {
        this.openai = openai;
        this.money = money;
        this.food = food;
        this.family = family;
    }

    /** kinds: what the user has switched on (the sheet's choices); categories: Money's, for the receipt part. */
    public record ReadRequest(@NotBlank @Size(max = 2_000_000) String imageDataUrl,
                              @Size(max = 3) List<String> kinds,
                              @Size(max = 60) List<MoneyController.ReceiptCategory> categories) {}

    /**
     * {kind, receipt | plate | groceries}: the kind the model picked and that
     * reader's answer, or {kind: null}. A kind with no answer (its checks threw,
     * no family for groceries) leaves the client to call that reader itself.
     */
    @PostMapping("/api/photo/read")
    public Map<String, Object> read(@Valid @RequestBody ReadRequest req) {
        String img = req == null ? null : req.imageDataUrl();
        if (img == null || !IMAGE.matcher(img).lookingAt()) {
            throw ApiException.badRequest("Send a JPEG, PNG or WebP photo.");
        }
        UUID userId = CurrentUser.id();
        List<String> kinds = (req.kinds() == null ? List.copyOf(KINDS) : req.kinds()).stream()
                .filter(KINDS::contains).distinct()
                .filter(k -> !FeatureLocks.isLocked(userId, FEATURE.get(k)))
                .toList();
        Map<String, Object> out = new HashMap<>();
        out.put("kind", null);
        if (kinds.isEmpty() || !openai.isConfigured()) return out;
        Map<String, String> cats = MoneyController.cleanCategories(req.categories());
        JsonNode node;
        try {
            node = JSON.readTree(OpenAIClient.jsonOf(openai.completeWithImage(readPrompt(kinds, cats),
                    "Which kind is it? Then read it as that kind says. Strict JSON only.", img)));
        } catch (Exception e) {
            return out;
        }
        String kind = node.path("kind").asText("").toLowerCase(Locale.ROOT);
        if (!kinds.contains(kind)) return out;
        out.put("kind", kind);
        try {
            out.put(kind, switch (kind) {
                case "receipt" -> MoneyService.receiptFrom(node, cats.keySet());
                case "plate" -> food.plateFrom(node);
                default -> family.pantryFrom(userId, node);
            });
        } catch (RuntimeException e) {
            // No answer for that kind: the client's own reader takes over.
        }
        return out;
    }

    /** The one-call prompt: pick a kind, then that kind's own reader rules, word for word. */
    static String readPrompt(List<String> kinds, Map<String, String> categories) {
        Map<String, String> parts = new LinkedHashMap<>();
        parts.put("receipt", "a shop receipt or bill, or a payment screenshot from a UPI or bank app\n"
                + MoneyService.receiptRules(categories));
        parts.put("plate", "cooked food or a meal\n" + FoodService.plateRules());
        parts.put("groceries", "a fridge, a pantry shelf, a shopping haul or packaged products\n" + FamilyService.pantryRules());
        StringBuilder p = new StringBuilder("You are given one photo. First decide which ONE of these kinds it is: ")
                .append(String.join(", ", kinds)).append(".\n")
                .append("Then read it exactly as that kind's section says, and answer with that section's strict JSON")
                .append(" plus one more top-level key, \"kind\", naming the kind you chose.\n")
                .append("If it is none of them, answer {\"kind\":null}.\n");
        for (String k : kinds) {
            p.append("\n## kind \"").append(k).append("\": ").append(parts.get(k));
        }
        return p.toString();
    }
}
