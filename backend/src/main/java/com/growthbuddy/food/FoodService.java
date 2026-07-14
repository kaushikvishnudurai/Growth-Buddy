package com.growthbuddy.food;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.mentor.OpenAIClient.ChatTurn;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class FoodService {

    private static final Logger log = LoggerFactory.getLogger(FoodService.class);

    private static final int FALLBACK_HOME_KCAL_100G = 220;
    private static final int FALLBACK_HOTEL_KCAL_100G = 300;

    private static final String AI_PROMPT = """
            You estimate calories for Indian food with simple user-friendly assumptions.
            The user may not know grams. Inputs can include portionSize (small|medium|large)
            and riceBase (yes|no|unsure).

            Return strict JSON only with keys:
            kcalPer100g (integer),
            quantityGrams (integer),
            reason (short string).

            Rules:
            - Use practical Indian home/hotel averages.
            - If meal is hotel style, account for heavier oil/ghee and richer gravies.
            - Keep kcalPer100g in realistic range 40..900.
            - Keep quantityGrams in realistic range 80..700.
            - Prefer moderate assumptions; do not ask many follow-ups.
            - If riceBase=yes, assume somewhat larger carb quantity.
            """;

    private static final String PHOTO_AI_MULTI_PROMPT = """
            You analyze a plate photo for Indian meals and identify all visible food items separately.
            Return strict JSON only with key "items" containing an array of food items.
            Each item must have: foodName, kcalPer100g, quantityGrams.

            Rules:
            - Parse ALL distinct food items visible on the plate (e.g., rice, curry, bread, salad).
            - foodName should be short and user-friendly (e.g., "Rice", "Chicken curry", "Roti").
            - kcalPer100g integer range: 40..900.
            - quantityGrams integer range: 80..700.
            - Return as JSON: {"items": [{foodName, kcalPer100g, quantityGrams}, ...], "confidence": 0.8, "fallbackNeeded": false}
            - confidence range: 0..1.
            - fallbackNeeded should be true when image is unclear or composition uncertain.
            """;

    @Transactional(readOnly = true)
    public PhotoFoodEstimateMultiResponse estimateFromPhotoMulti(PhotoFoodEstimateRequest req) {
        if (req == null || !StringUtils.hasText(req.imageDataUrl())) {
            throw ApiException.badRequest("imageDataUrl is required");
        }
        if (!req.imageDataUrl().startsWith("data:image/")) {
            throw ApiException.badRequest("imageDataUrl must be a data URL image");
        }
        if (!openai.isConfigured()) {
            log.warn("Photo multi-analysis fallback: OpenAI is not configured in this backend process (OPENAI_API_KEY/MENTOR_API_KEY missing)");
            return new PhotoFoodEstimateMultiResponse(
                    List.of(),
                    0.0,
                    true,
                    "Photo analysis unavailable. Using fallback quick questions.",
                    "fallback");
        }

        MealType mealType = req.mealType() != null ? req.mealType() : MealType.home;
        PortionSize portion = req.portionSize() != null ? req.portionSize() : PortionSize.medium;
        RiceBase rice = req.riceBase() != null ? req.riceBase() : RiceBase.unsure;

        try {
            String userPrompt = "Meal type: " + mealType.name()
                    + "\nPortion hint: " + portion.name()
                    + "\nRice hint: " + rice.name()
                    + "\nReturn strict JSON only with 'items', 'confidence', 'fallbackNeeded' keys.";
            String raw = openai.completeWithImage(PHOTO_AI_MULTI_PROMPT, userPrompt, req.imageDataUrl());
            JsonNode node = json.readTree(raw);

            List<FoodItem> items = new ArrayList<>();
            JsonNode itemsNode = node.path("items");
            if (itemsNode.isArray()) {
                for (JsonNode item : itemsNode) {
                    String foodName = textOrNull(item, "foodName");
                    Integer kcalPer100g = numberAsInt(item, "kcalPer100g");
                    Integer quantityGrams = numberAsInt(item, "quantityGrams");
                    
                    if (StringUtils.hasText(foodName) && kcalPer100g != null && quantityGrams != null) {
                        items.add(new FoodItem(
                                foodName.trim(),
                                clampQuantity(quantityGrams),
                                clamp(kcalPer100g)
                        ));
                    }
                }
            }

            double confidence = numberAsDouble(node, "confidence", 0.0);
            boolean fallbackNeeded = node.path("fallbackNeeded").asBoolean(confidence < 0.70 || items.isEmpty());
            String message = !items.isEmpty() 
                    ? "Detected " + items.size() + " item(s) from photo."
                    : "Image unclear. Please answer fallback questions.";

            return new PhotoFoodEstimateMultiResponse(
                    items,
                    Math.max(0.0, Math.min(1.0, confidence)),
                    fallbackNeeded,
                    message,
                    "ai-photo-multi");
        } catch (Exception ex) {
            log.warn("Photo multi-analysis fallback: OpenAI image analysis failed", ex);
            return new PhotoFoodEstimateMultiResponse(
                    List.of(),
                    0.0,
                    true,
                    "Could not analyze photo. Please use fallback quick questions.",
                    "fallback");
        }
    }

    private static final String PHOTO_AI_PROMPT = """
            You analyze a plate photo for Indian meals and suggest practical nutrition estimates.
            Return strict JSON only with keys:
            foodName, kcalPer100g, quantityGrams, confidence, fallbackNeeded, reason.

            Rules:
            - foodName should be short and user-friendly (e.g., "Chicken biryani", "Meals with rice and curry").
            - kcalPer100g integer range: 40..900.
            - quantityGrams integer range: 80..700.
            - confidence range: 0..1.
            - fallbackNeeded should be true when image is unclear or mixed dish is uncertain.
            - Keep reason concise.
            """;

    private final FoodEntryRepository entries;
    private final FoodPhotoLogRepository photoLogs;
    private final OpenAIClient openai;
    private final ObjectMapper json;
    private final HttpClient http;

    public FoodService(FoodEntryRepository entries, FoodPhotoLogRepository photoLogs, OpenAIClient openai) {
        this.entries = entries;
        this.photoLogs = photoLogs;
        this.openai = openai;
        this.json = new ObjectMapper();
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
    }

    /** Recent food-photo analyses, newest first (capped at 12). */
    @Transactional(readOnly = true)
    public List<PhotoHistoryItem> photoHistory(UUID userId) {
        return photoLogs.findTop12ByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(PhotoHistoryItem::from).toList();
    }

    /** Append a photo-analysis record; returns the trimmed recent list. */
    @Transactional
    public List<PhotoHistoryItem> recordPhoto(UUID userId, PhotoHistoryRequest req) {
        FoodPhotoLog p = new FoodPhotoLog();
        p.setUserId(userId);
        p.setLogDate(req.date() != null ? req.date() : LocalDate.now());
        p.setFoodName(req.foodName().trim());
        p.setMealType(req.mealType());
        p.setConfidence(req.confidence());
        p.setFallbackNeeded(req.fallbackNeeded());
        photoLogs.save(p);
        return photoHistory(userId);
    }

    @Transactional(readOnly = true)
    public FoodSummaryResponse summary(UUID userId, LocalDate date) {
        LocalDate day = date != null ? date : LocalDate.now();
        int total = entries.totalCaloriesForDay(userId, day);
        List<FoodEntryResponse> row = entries.findByUserIdAndLogDateOrderByLoggedAtDesc(userId, day)
                .stream().map(FoodEntryResponse::from).toList();
        return new FoodSummaryResponse(day, total, row);
    }

    @Transactional(readOnly = true)
    public List<FoodSearchItem> search(String query) {
        if (!StringUtils.hasText(query)) {
            return List.of();
        }
        return searchOpenFoodFacts(query.trim());
    }

    @Transactional
    public FoodSummaryResponse addEntry(UUID userId, AddFoodEntryRequest req) {
        if (req == null || !StringUtils.hasText(req.foodName())) {
            throw ApiException.badRequest("foodName is required");
        }

        String food = req.foodName().trim();
        MealType mealType = req.mealType() != null ? req.mealType() : MealType.home;
        EstimateInput input = new EstimateInput(
                food,
                mealType,
                req.portionSize() != null ? req.portionSize() : PortionSize.medium,
                req.riceBase() != null ? req.riceBase() : RiceBase.unsure,
                req.note());

        int quantity = req.quantityGrams() != null
                ? req.quantityGrams()
                : estimateQuantityGrams(input);

        CalorieEstimate estimate = estimateCalories(input);
        int kcal = Math.max(1, (int) Math.round((estimate.kcalPer100g() * quantity) / 100.0));

        FoodEntry e = new FoodEntry();
        e.setUserId(userId);
        e.setFoodName(food);
        e.setQuantityGrams(quantity);
        e.setMealType(mealType);
        e.setKcalPer100g(estimate.kcalPer100g());
        e.setKcalEstimated(kcal);
        e.setEstimateSource(estimate.source());
        e.setNote(StringUtils.hasText(req.note()) ? req.note().trim() : null);
        if (req.loggedAt() != null) {
            Instant ts = req.loggedAt();
            e.setLoggedAt(ts);
            e.setLogDate(ts.atZone(ZoneOffset.UTC).toLocalDate());
        }

        FoodEntry saved = entries.save(e);
        return summary(userId, saved.getLogDate());
    }

    @Transactional
    public FoodSummaryResponse deleteEntry(UUID userId, UUID entryId) {
        FoodEntry entry = entries.findById(entryId)
                .orElseThrow(() -> ApiException.notFound("Entry not found"));
        if (!entry.getUserId().equals(userId)) {
            throw ApiException.forbidden("Unauthorized");
        }
        LocalDate date = entry.getLogDate();
        entries.deleteById(entryId);
        return summary(userId, date);
    }

    @Transactional(readOnly = true)
    public PhotoFoodEstimateResponse estimateFromPhoto(PhotoFoodEstimateRequest req) {
        if (req == null || !StringUtils.hasText(req.imageDataUrl())) {
            throw ApiException.badRequest("imageDataUrl is required");
        }
        if (!req.imageDataUrl().startsWith("data:image/")) {
            throw ApiException.badRequest("imageDataUrl must be a data URL image");
        }
        if (!openai.isConfigured()) {
            log.warn("Photo analysis fallback: OpenAI is not configured in this backend process (OPENAI_API_KEY/MENTOR_API_KEY missing)");
            return new PhotoFoodEstimateResponse(
                    null,
                    null,
                    null,
                    0.0,
                    true,
                    "Photo analysis unavailable. Using fallback quick questions.",
                    "fallback");
        }

        MealType mealType = req.mealType() != null ? req.mealType() : MealType.home;
        PortionSize portion = req.portionSize() != null ? req.portionSize() : PortionSize.medium;
        RiceBase rice = req.riceBase() != null ? req.riceBase() : RiceBase.unsure;

        try {
            String userPrompt = "Meal type: " + mealType.name()
                    + "\nPortion hint: " + portion.name()
                    + "\nRice hint: " + rice.name()
                    + "\nReturn strict JSON only.";
            String raw = openai.completeWithImage(PHOTO_AI_PROMPT, userPrompt, req.imageDataUrl());
            JsonNode node = json.readTree(raw);

            String foodName = textOrNull(node, "foodName");
            Integer kcalPer100g = numberAsInt(node, "kcalPer100g");
            Integer quantityGrams = numberAsInt(node, "quantityGrams");
            double confidence = numberAsDouble(node, "confidence", 0.0);
            boolean fallbackNeeded = node.path("fallbackNeeded").asBoolean(confidence < 0.70);
            String reason = textOrNull(node, "reason");

            return new PhotoFoodEstimateResponse(
                    StringUtils.hasText(foodName) ? foodName.trim() : null,
                    quantityGrams != null ? clampQuantity(quantityGrams) : null,
                    kcalPer100g != null ? clamp(kcalPer100g) : null,
                    Math.max(0.0, Math.min(1.0, confidence)),
                    fallbackNeeded,
                    StringUtils.hasText(reason)
                            ? reason.trim()
                            : (fallbackNeeded ? "Image unclear. Please answer fallback questions." : "Estimated from photo."),
                    "ai-photo");
        } catch (Exception ex) {
            log.warn("Photo analysis fallback: OpenAI image analysis failed", ex);
            return new PhotoFoodEstimateResponse(
                    null,
                    null,
                    null,
                    0.0,
                    true,
                    "Could not analyze photo. Please use fallback quick questions.",
                    "fallback");
        }
    }

    private CalorieEstimate estimateCalories(EstimateInput input) {
        Integer fromApi = bestFromOpenFoodFacts(input.foodName());
        if (fromApi != null) {
            int adjusted = input.mealType() == MealType.hotel ? (int) Math.round(fromApi * 1.18) : fromApi;
            return new CalorieEstimate(clamp(adjusted), "openfoodfacts");
        }

        if (openai.isConfigured()) {
            Integer fromAi = estimateWithAi(input);
            if (fromAi != null) {
                return new CalorieEstimate(clamp(fromAi), "ai-estimate");
            }
        }

        return new CalorieEstimate(
                input.mealType() == MealType.hotel ? FALLBACK_HOTEL_KCAL_100G : FALLBACK_HOME_KCAL_100G,
                "fallback-average");
    }

    private int estimateQuantityGrams(EstimateInput input) {
        if (openai.isConfigured()) {
            Integer aiQuantity = estimateQuantityWithAi(input);
            if (aiQuantity != null) {
                return clampQuantity(aiQuantity);
            }
        }

        int base = switch (input.portionSize()) {
            case small -> 140;
            case medium -> 220;
            case large -> 320;
        };
        if (input.riceBase() == RiceBase.yes) {
            base += 60;
        } else if (input.riceBase() == RiceBase.unsure) {
            base += 30;
        }
        return clampQuantity(base);
    }

    private Integer estimateWithAi(EstimateInput input) {
        try {
            String userPrompt = "Food: " + input.foodName()
                    + "\nMeal type: " + input.mealType().name()
                    + "\nPortion size: " + input.portionSize().name()
                    + "\nWhite rice base: " + input.riceBase().name()
                    + "\nNote: " + (input.note() != null ? input.note() : "");
            String raw = openai.complete(AI_PROMPT, List.of(new ChatTurn("user", userPrompt)));
            JsonNode node = json.readTree(raw);
            if (node.has("kcalPer100g") && node.get("kcalPer100g").isNumber()) {
                return node.get("kcalPer100g").asInt();
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    private Integer estimateQuantityWithAi(EstimateInput input) {
        try {
            String userPrompt = "Food: " + input.foodName()
                    + "\nMeal type: " + input.mealType().name()
                    + "\nPortion size: " + input.portionSize().name()
                    + "\nWhite rice base: " + input.riceBase().name()
                    + "\nNote: " + (input.note() != null ? input.note() : "")
                    + "\nReturn quantityGrams only in JSON.";
            String raw = openai.complete(AI_PROMPT, List.of(new ChatTurn("user", userPrompt)));
            JsonNode node = json.readTree(raw);
            if (node.has("quantityGrams") && node.get("quantityGrams").isNumber()) {
                return node.get("quantityGrams").asInt();
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    private List<FoodSearchItem> searchOpenFoodFacts(String query) {
        try {
            String encoded = URLEncoder.encode(query, StandardCharsets.UTF_8);
            String url = "https://world.openfoodfacts.org/cgi/search.pl?search_terms=" + encoded
                    + "&search_simple=1&action=process&json=1&page_size=8";
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(10))
                    .GET()
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                return List.of();
            }
            JsonNode root = json.readTree(res.body());
            JsonNode products = root.path("products");
            List<FoodSearchItem> out = new ArrayList<>();
            for (JsonNode p : products) {
                String name = textOrNull(p, "product_name");
                if (!StringUtils.hasText(name)) {
                    continue;
                }
                JsonNode n = p.path("nutriments");
                Integer kcal = numberAsInt(n, "energy-kcal_100g");
                if (kcal == null) {
                    kcal = numberAsInt(n, "energy-kcal_value");
                }
                out.add(new FoodSearchItem(name.trim(), kcal != null ? clamp(kcal) : null, "openfoodfacts"));
            }
            return out.stream().limit(8).toList();
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private Integer bestFromOpenFoodFacts(String foodName) {
        return searchOpenFoodFacts(foodName).stream()
                .map(FoodSearchItem::kcalPer100g)
                .filter(v -> v != null && v > 0)
                .min(Comparator.comparingInt(v -> Math.abs(v - 240)))
                .orElse(null);
    }

    private static Integer numberAsInt(JsonNode node, String key) {
        JsonNode val = node.path(key);
        if (!val.isNumber()) {
            return null;
        }
        return (int) Math.round(val.asDouble());
    }

    private static String textOrNull(JsonNode node, String key) {
        JsonNode val = node.path(key);
        return val.isTextual() ? val.asText() : null;
    }

    private static double numberAsDouble(JsonNode node, String key, double fallback) {
        JsonNode val = node.path(key);
        if (!val.isNumber()) {
            return fallback;
        }
        return val.asDouble();
    }

    private static int clamp(int value) {
        return Math.max(40, Math.min(900, value));
    }

    private static int clampQuantity(int value) {
        return Math.max(80, Math.min(700, value));
    }

    private record EstimateInput(
            String foodName,
            MealType mealType,
            PortionSize portionSize,
            RiceBase riceBase,
            String note) {
    }

    private record CalorieEstimate(int kcalPer100g, String source) {
    }
}
