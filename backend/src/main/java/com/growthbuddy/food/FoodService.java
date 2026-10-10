package com.growthbuddy.food;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.UserClock;
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
            proteinPer100g, carbsPer100g, fatPer100g, fiberPer100g (numbers, grams),
            reason (short string).

            Rules:
            - Use practical Indian home/hotel averages.
            - If meal is hotel style, account for heavier oil/ghee and richer gravies.
            - Keep kcalPer100g in realistic range 40..900.
            - Keep quantityGrams in realistic range 80..700.
            - Prefer moderate assumptions; do not ask many follow-ups.
            - If riceBase=yes, assume somewhat larger carb quantity.
            - If Pieces is given, quantityGrams is the total weight of that many pieces
              (range 10..2000 then, not 80..700).
            """;

    private static final String PHOTO_AI_MULTI_PROMPT = """
            You analyze a plate photo for Indian meals and identify all visible food items separately.
            Return strict JSON only, with exactly these three top-level keys:
              "items"          an array of food items, each with foodName, kcalPer100g, quantityGrams
              "confidence"     a NUMBER from 0 to 1 — how sure you are of the whole reading
              "fallbackNeeded" a boolean
            All three are required. Never omit "confidence".

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
            log.warn("Photo multi-analysis fallback: AI gateway is not configured in this backend process (AI_GATEWAY_TOKEN/AI_GATEWAY_URL missing)");
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
            JsonNode node = json.readTree(OpenAIClient.jsonOf(raw));

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
            log.warn("Photo multi-analysis fallback: AI image analysis failed", ex);
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
    private final FoodFavouriteRepository favourites;
    private final OpenAIClient openai;
    private final ObjectMapper json;
    private final HttpClient http;

    private final UserClock clock;

    /** A starred food list is a chip row, not a pantry. */
    static final int MAX_FAVOURITES = 24;

    public FoodService(FoodEntryRepository entries, FoodPhotoLogRepository photoLogs,
                       FoodFavouriteRepository favourites, OpenAIClient openai, UserClock clock) {
        this.entries = entries;
        this.photoLogs = photoLogs;
        this.favourites = favourites;
        this.openai = openai;
        this.json = new ObjectMapper();
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
        this.clock = clock;
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
        // LocalDate.now() here was the SERVER's day. Food is something a user sees
        // dated, so it belongs to UserClock like habits, water and the daily score.
        LocalDate day = date != null ? date : clock.today(userId);
        int total = entries.totalCaloriesForDay(userId, day);
        List<FoodEntryResponse> row = entries.findByUserIdAndLogDateOrderByLoggedAtDesc(userId, day)
                .stream().map(FoodEntryResponse::from).toList();
        return new FoodSummaryResponse(day, total, row,
                daySum(row, FoodEntryResponse::fiberG),
                daySum(row, FoodEntryResponse::sugarG),
                daySum(row, FoodEntryResponse::sodiumMg));
    }

    /** The day's sum over the entries that carry the figure; null when none does. */
    static Integer daySum(List<FoodEntryResponse> rows, java.util.function.Function<FoodEntryResponse, Integer> f) {
        Integer sum = null;
        for (FoodEntryResponse r : rows) {
            Integer v = f.apply(r);
            if (v != null) {
                sum = (sum == null ? 0 : sum) + v;
            }
        }
        return sum;
    }

    /**
     * Up to 8 different foods from the user's latest entries, newest first, one per
     * name (case-insensitive): the "Log food" form offers them as one-tap re-logs,
     * sent with their calories typed, so a repeat costs no estimate.
     */
    @Transactional(readOnly = true)
    public List<FoodEntryResponse> recent(UUID userId) {
        java.util.Map<String, FoodEntryResponse> out = new java.util.LinkedHashMap<>();
        for (FoodEntry e : entries.findTop60ByUserIdOrderByLoggedAtDesc(userId)) {
            out.putIfAbsent(e.getFoodName().trim().toLowerCase(java.util.Locale.ROOT), FoodEntryResponse.from(e));
            if (out.size() == 8) {
                break;
            }
        }
        return List.copyOf(out.values());
    }

    // Not @Transactional: it is one HTTP call to OpenFoodFacts and no database at
    // all, and a read-only transaction held a pooled connection through it.
    public List<FoodSearchItem> search(String query) {
        if (!StringUtils.hasText(query)) {
            return List.of();
        }
        return searchOpenFoodFacts(query.trim());
    }

    // Not @Transactional: the estimate below can be an OpenFoodFacts lookup and
    // an AI call, and a transaction would hold a pooled connection through both.
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
                req.note(),
                req.pieces());

        // At most ONE AI call per entry: it answers grams, kcal and nutrients
        // together, asked the first time any of them is needed. Grams and kcal
        // used to be two calls with the same prompt.
        AiGuess[] ai = new AiGuess[1];
        boolean[] asked = {false};
        java.util.function.Supplier<AiGuess> askOnce = () -> {
            if (!asked[0]) {
                asked[0] = true;
                ai[0] = openai.isConfigured() ? askAi(input) : null;
            }
            return ai[0];
        };

        int quantity;
        if (req.quantityGrams() != null) {
            quantity = req.quantityGrams();
        } else if (req.kcal() != null) {
            // Typed calories: the grams are only a display figure, so no AI call for
            // them. It used to ask the AI here, so "no AI for a typed number" held
            // only when grams were typed too.
            quantity = defaultQuantity(input);
        } else {
            AiGuess g = askOnce.get();
            if (g != null && g.quantityGrams() != null) {
                // A counted portion can be one 40 g idli, under the 80 g a guessed
                // plate is held to; only the column's own range applies.
                quantity = input.pieces() != null
                        ? Math.max(10, Math.min(2000, g.quantityGrams()))
                        : clampQuantity(g.quantityGrams());
            } else {
                quantity = defaultQuantity(input);
            }
        }

        // A typed number beats every estimate we could produce, and the user has
        // the packet in their hand. Taking it also means this entry costs no
        // OpenFoodFacts lookup and no AI call — so someone logging from a label
        // never spends their AI budget on a number they already knew.
        int kcal;
        CalorieEstimate estimate;
        if (req.kcal() != null) {
            kcal = req.kcal();
            // Back-derive the per-100g figure so the entry still reports in the same
            // unit as every other row (the Food screen shows both). Clamped through
            // the estimator's own clamp because the column is CHECKed to 40..900 —
            // 90 kcal of coffee over a 300g default works out at 30, which the
            // database refuses. The typed number itself is never adjusted; only this
            // derived display figure is.
            estimate = new CalorieEstimate(
                    clamp((int) Math.round((kcal * 100.0) / Math.max(1, quantity))), "manual");
        } else {
            estimate = estimateCalories(input, askOnce);
            kcal = Math.max(1, (int) Math.round((estimate.kcalPer100g() * quantity) / 100.0));
        }

        FoodEntry e = new FoodEntry();
        e.setUserId(userId);
        e.setFoodName(food);
        e.setQuantityGrams(quantity);
        e.setMealType(mealType);
        e.setKcalPer100g(estimate.kcalPer100g());
        e.setKcalEstimated(kcal);
        e.setEstimateSource(estimate.source());
        e.setNote(StringUtils.hasText(req.note()) ? req.note().trim() : null);
        // Label figures (a barcode product, a favourite) only with typed calories:
        // an estimated entry's nutrients come from the same estimate as its kcal.
        if (req.kcal() != null) {
            e.setProteinG(req.proteinG());
            e.setCarbsG(req.carbsG());
            e.setFatG(req.fatG());
            e.setFiberG(req.fiberG());
            e.setSugarG(req.sugarG());
            e.setSodiumMg(req.sodiumMg());
        }
        // Free when the AI was asked anyway. Otherwise they stay null and the
        // Summary's batch fills them, 40 entries to a call.
        if (ai[0] != null && ai[0].per100g() != null) {
            double[] n = ai[0].per100g();
            e.setProteinG(nutrient(n[0], quantity));
            e.setCarbsG(nutrient(n[1], quantity));
            e.setFatG(nutrient(n[2], quantity));
            e.setFiberG(nutrient(n[3], quantity));
        }
        // The day this entry counts towards, in the zone the user lives in. It used
        // to be derived in UTC while summary() read the day in another zone
        // entirely, so in IST every meal logged after 5:30pm — dinner, the most
        // logged meal there is — was filed under yesterday and vanished from the
        // Food screen the moment it was saved.
        Instant ts = req.loggedAt() != null ? req.loggedAt() : Instant.now();
        e.setLoggedAt(ts);
        java.time.ZoneId zone = clock.zoneOf(userId);
        LocalDate logDate = ts.atZone(zone).toLocalDate();
        e.setMealSlot(defaultSlot(req.mealSlot(), ts, zone));
        // Backdating is the point of `loggedAt` — forward-dating is not. The form
        // caps its day picker at today, but this is an API anyone can POST to, and
        // a meal filed under next week sits in a summary nothing ever opens.
        // Compared as a DAY in the user's own zone, so a client clock a few
        // seconds ahead of the server isn't an error.
        if (logDate.isAfter(clock.today(userId))) {
            throw ApiException.badRequest("You can't log food for a day that hasn't happened yet.");
        }
        e.setLogDate(logDate);

        FoodEntry saved = entries.save(e);
        return summary(userId, saved.getLogDate());
    }

    /**
     * Fix a logged entry: name, grams, calories, meal or day. No AI and no lookup:
     * typed calories are taken as they are ("manual"); new grams without calories
     * rescale the entry's own kcal/100 g. A changed name or grams clears the four
     * nutrients so FoodWeek's batch refills them for the new food (its guarded
     * coalesce UPDATE only fills nulls). Returns the summary of the day the entry
     * is on afterwards.
     */
    @Transactional
    public FoodSummaryResponse updateEntry(UUID userId, UUID entryId, UpdateFoodEntryRequest req) {
        FoodEntry e = entries.findById(entryId)
                .orElseThrow(() -> ApiException.notFound("Entry not found"));
        if (!e.getUserId().equals(userId)) {
            throw ApiException.forbidden("Unauthorized");
        }
        boolean foodChanged = false;
        if (req.foodName() != null) {
            if (!StringUtils.hasText(req.foodName())) {
                throw ApiException.badRequest("foodName can't be empty");
            }
            String name = req.foodName().trim();
            foodChanged |= !name.equals(e.getFoodName());
            e.setFoodName(name);
        }
        if (req.quantityGrams() != null && req.quantityGrams() != e.getQuantityGrams()) {
            foodChanged = true;
            e.setQuantityGrams(req.quantityGrams());
            if (req.kcal() == null) {
                e.setKcalEstimated(Math.max(1, Math.min(5000,
                        (int) Math.round(e.getKcalPer100g() * req.quantityGrams() / 100.0))));
            }
        }
        if (req.kcal() != null) {
            e.setKcalEstimated(req.kcal());
            e.setKcalPer100g(clamp((int) Math.round((req.kcal() * 100.0) / Math.max(1, e.getQuantityGrams()))));
            e.setEstimateSource("manual");
        }
        if (req.mealType() != null) {
            e.setMealType(req.mealType());
        }
        if (req.mealSlot() != null) {
            e.setMealSlot(req.mealSlot());
        }
        if (req.date() != null && !req.date().equals(e.getLogDate())) {
            if (req.date().isAfter(clock.today(userId))) {
                throw ApiException.badRequest("You can't log food for a day that hasn't happened yet.");
            }
            e.setLogDate(req.date());
            // Noon local, as the add form sends for a past day.
            e.setLoggedAt(req.date().atTime(12, 0).atZone(clock.zoneOf(userId)).toInstant());
        }
        if (foodChanged) {
            e.setProteinG(null);
            e.setCarbsG(null);
            e.setFatG(null);
            e.setFiberG(null);
        }
        if (req.note() != null) {
            e.setNote(StringUtils.hasText(req.note()) ? req.note().trim() : null);
        }
        entries.save(e);
        return summary(userId, e.getLogDate());
    }

    /** The request's slot, else the one the local hour of the entry falls in. */
    static MealSlot defaultSlot(MealSlot requested, Instant loggedAt, java.time.ZoneId zone) {
        return requested != null ? requested : MealSlot.at(loggedAt, zone);
    }

    /** An entry's slot: its own, or (a row from before slots) its logged hour's. */
    static MealSlot slotOf(FoodEntry e, java.time.ZoneId zone) {
        return e.getMealSlot() != null ? e.getMealSlot() : MealSlot.at(e.getLoggedAt(), zone);
    }

    /**
     * "Copy yesterday's breakfast": every entry of {@code from}'s slot again on
     * {@code to} (defaults yesterday and today, in the user's zone), as manual
     * kcal with the figures it already had. No estimate, no AI, no lookup.
     */
    @Transactional
    public FoodSummaryResponse copySlot(UUID userId, MealSlot slot, LocalDate from, LocalDate to) {
        if (slot == null) {
            throw ApiException.badRequest("slot is required");
        }
        LocalDate today = clock.today(userId);
        LocalDate target = to != null ? to : today;
        LocalDate source = from != null ? from : target.minusDays(1);
        if (target.isAfter(today)) {
            throw ApiException.badRequest("You can't log food for a day that hasn't happened yet.");
        }
        java.time.ZoneId zone = clock.zoneOf(userId);
        List<FoodEntry> src = entries.findByUserIdAndLogDate(userId, source).stream()
                .filter(e -> slotOf(e, zone) == slot)
                .sorted(Comparator.comparing(FoodEntry::getLoggedAt))
                .toList();
        if (src.isEmpty()) {
            throw ApiException.badRequest("Nothing was logged for " + slot.name() + " that day.");
        }
        // Today: now, so it reads as just logged. A past day: its local noon, as the form does.
        Instant at = target.equals(today) ? Instant.now()
                : target.atTime(12, 0).atZone(zone).toInstant();
        for (FoodEntry e : src) {
            FoodEntry c = new FoodEntry();
            c.setUserId(userId);
            c.setFoodName(e.getFoodName());
            c.setQuantityGrams(e.getQuantityGrams());
            c.setMealType(e.getMealType());
            c.setKcalEstimated(e.getKcalEstimated());
            c.setKcalPer100g(e.getKcalPer100g());
            c.setEstimateSource("manual");
            c.setProteinG(e.getProteinG());
            c.setCarbsG(e.getCarbsG());
            c.setFatG(e.getFatG());
            c.setFiberG(e.getFiberG());
            c.setSugarG(e.getSugarG());
            c.setSodiumMg(e.getSodiumMg());
            c.setMealSlot(slot);
            c.setLoggedAt(at);
            c.setLogDate(target);
            entries.save(c);
        }
        return summary(userId, target);
    }

    @Transactional(readOnly = true)
    public List<FoodFavouriteResponse> favourites(UUID userId) {
        return favourites.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(FoodFavouriteResponse::from).toList();
    }

    /**
     * Star an entry: its name, portion, kcal and macros become a favourite. A name
     * already starred (case-insensitive) is refreshed rather than duplicated.
     * Returns the whole list, newest first.
     */
    @Transactional
    public List<FoodFavouriteResponse> addFavourite(UUID userId, UUID entryId) {
        FoodEntry e = entries.findById(entryId)
                .orElseThrow(() -> ApiException.notFound("Entry not found"));
        if (!e.getUserId().equals(userId)) {
            throw ApiException.forbidden("Unauthorized");
        }
        String name = e.getFoodName().trim();
        FoodFavourite f = favourites.findFirstByUserIdAndFoodNameIgnoreCase(userId, name).orElse(null);
        if (f == null) {
            if (favourites.countByUserId(userId) >= MAX_FAVOURITES) {
                throw ApiException.badRequest(
                        "You can keep up to " + MAX_FAVOURITES + " favourites. Remove one first.");
            }
            f = new FoodFavourite();
            f.setUserId(userId);
        }
        f.setFoodName(name);
        f.setQuantityGrams(e.getQuantityGrams());
        f.setKcal(e.getKcalEstimated());
        f.setProteinG(e.getProteinG());
        f.setCarbsG(e.getCarbsG());
        f.setFatG(e.getFatG());
        f.setFiberG(e.getFiberG());
        favourites.save(f);
        return favourites(userId);
    }

    @Transactional
    public List<FoodFavouriteResponse> deleteFavourite(UUID userId, UUID favouriteId) {
        FoodFavourite f = favourites.findById(favouriteId)
                .orElseThrow(() -> ApiException.notFound("Favourite not found"));
        if (!f.getUserId().equals(userId)) {
            throw ApiException.forbidden("Unauthorized");
        }
        favourites.delete(f);
        return favourites(userId);
    }

    /**
     * One packaged product by its barcode, from OpenFoodFacts' product endpoint.
     * No AI and no database. 404 when the code is unknown or the lookup fails, so
     * the form says "type it in" either way. Not @Transactional: one HTTP call.
     */
    public BarcodeProduct barcode(String code) {
        if (code == null || !code.matches("\\d{6,14}")) {
            throw ApiException.badRequest("A barcode is 6 to 14 digits.");
        }
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create("https://world.openfoodfacts.org/api/v2/product/" + code
                            + ".json?fields=product_name,brands,nutriments,serving_quantity"))
                    .timeout(Duration.ofSeconds(10))
                    .header("User-Agent", "GrowthBuddy/1.0 (food log)")
                    .GET()
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            BarcodeProduct p = res.statusCode() / 100 == 2 ? barcodeFrom(json.readTree(res.body()), code) : null;
            if (p != null) {
                return p;
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        } catch (Exception ex) {
            log.debug("Barcode lookup failed for {}", code, ex);
        }
        throw ApiException.notFound("Product not found");
    }

    /**
     * An OpenFoodFacts product answer, mapped to what the form needs; null when it
     * has no product or no name. kcal/100 g falls back to kJ / 4.184 and is clamped
     * like every other per-100 g figure; sodium is grams there, milligrams here,
     * and comes from salt / 2.5 when only salt is on the label.
     */
    static BarcodeProduct barcodeFrom(JsonNode root, String code) {
        if (root == null || root.path("status").asInt(0) != 1) {
            return null;
        }
        JsonNode p = root.path("product");
        String name = textOrNull(p, "product_name");
        if (!StringUtils.hasText(name)) {
            return null;
        }
        name = name.trim();
        String brand = textOrNull(p, "brands");
        if (StringUtils.hasText(brand)) {
            String first = brand.split(",")[0].trim();
            if (!first.isEmpty() && !name.toLowerCase(java.util.Locale.ROOT)
                    .contains(first.toLowerCase(java.util.Locale.ROOT))) {
                name = first + " " + name;
            }
        }
        JsonNode n = p.path("nutriments");
        Double kcal = numberOrNull(n, "energy-kcal_100g");
        if (kcal == null) {
            Double kj = numberOrNull(n, "energy_100g");
            kcal = kj != null ? kj / 4.184 : null;
        }
        Double sodiumG = numberOrNull(n, "sodium_100g");
        if (sodiumG == null) {
            Double salt = numberOrNull(n, "salt_100g");
            sodiumG = salt != null ? salt / 2.5 : null;
        }
        Double serving = numberOrNull(p, "serving_quantity");
        Integer servingGrams = serving != null && serving >= 10 && serving <= 2000
                ? (int) Math.round(serving) : null;
        return new BarcodeProduct(code, name.length() > 255 ? name.substring(0, 255) : name,
                kcal != null && kcal > 0 ? clamp((int) Math.round(kcal)) : null,
                numberOrNull(n, "proteins_100g"),
                numberOrNull(n, "carbohydrates_100g"),
                numberOrNull(n, "fat_100g"),
                numberOrNull(n, "fiber_100g"),
                numberOrNull(n, "sugars_100g"),
                sodiumG != null ? (int) Math.round(sodiumG * 1000) : null,
                servingGrams);
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
            log.warn("Photo analysis fallback: AI gateway is not configured in this backend process (AI_GATEWAY_TOKEN/AI_GATEWAY_URL missing)");
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
            JsonNode node = json.readTree(OpenAIClient.jsonOf(raw));

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
            log.warn("Photo analysis fallback: AI image analysis failed", ex);
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

    private CalorieEstimate estimateCalories(EstimateInput input, java.util.function.Supplier<AiGuess> ai) {
        // AI first: it reads the whole name ("rava dosa with chutney"), and it has
        // usually been asked already for the grams, so this costs nothing extra.
        AiGuess g = ai.get();
        if (g != null && g.kcalPer100g() != null) {
            return new CalorieEstimate(clamp(g.kcalPer100g()), "ai-estimate");
        }

        // Then a dish the keyword table knows, before OpenFoodFacts: that is a
        // packaged-goods database, and its "dosa" is a batter mix.
        Integer fromTable = FoodWeek.kcalPer100g(input.foodName());
        if (fromTable != null) {
            return new CalorieEstimate(clamp(hotel(input, fromTable)), "table");
        }

        Integer fromApi = bestFromOpenFoodFacts(input.foodName());
        if (fromApi != null) {
            return new CalorieEstimate(clamp(hotel(input, fromApi)), "openfoodfacts");
        }

        return new CalorieEstimate(
                input.mealType() == MealType.hotel ? FALLBACK_HOTEL_KCAL_100G : FALLBACK_HOME_KCAL_100G,
                "fallback-average");
    }

    /** Hotel cooking runs richer: more oil and ghee. */
    private static int hotel(EstimateInput input, int kcalPer100g) {
        return input.mealType() == MealType.hotel ? (int) Math.round(kcalPer100g * 1.18) : kcalPer100g;
    }

    private int defaultQuantity(EstimateInput input) {
        if (input.pieces() != null) {
            return Math.max(10, Math.min(2000, input.pieces() * FoodWeek.gramsPerPiece(input.foodName())));
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

    /** kcal, grams and nutrients in one call; null when the AI fails. */
    private AiGuess askAi(EstimateInput input) {
        try {
            String userPrompt = "Food: " + input.foodName()
                    + "\nMeal type: " + input.mealType().name()
                    + "\nPortion size: " + input.portionSize().name()
                    + "\nWhite rice base: " + input.riceBase().name()
                    + (input.pieces() != null ? "\nPieces: " + input.pieces() : "")
                    + "\nNote: " + (input.note() != null ? input.note() : "");
            JsonNode node = json.readTree(OpenAIClient.jsonOf(
                    openai.complete(AI_PROMPT, List.of(new ChatTurn("user", userPrompt)))));
            Double[] n = {numberOrNull(node, "proteinPer100g"), numberOrNull(node, "carbsPer100g"),
                numberOrNull(node, "fatPer100g"), numberOrNull(node, "fiberPer100g")};
            boolean all = java.util.Arrays.stream(n).allMatch(java.util.Objects::nonNull);
            return new AiGuess(numberAsInt(node, "kcalPer100g"), numberAsInt(node, "quantityGrams"),
                    all ? new double[] {n[0], n[1], n[2], n[3]} : null);
        } catch (Exception ex) {
            return null;
        }
    }

    /** Grams of a nutrient in the portion, from its per-100 g figure; the column's own bounds. */
    static int nutrient(double per100g, int quantity) {
        return (int) Math.max(0, Math.min(900, Math.round(per100g * quantity / 100.0)));
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
        Double d = numberOrNull(node, key);
        return d == null ? null : (int) Math.round(d);
    }

    /**
     * A JSON number, or a string that holds one. Models quote numbers as often
     * as not ({@code "confidence": "0.85"}), and reading only {@code isNumber()}
     * turned every one of those into the caller's fallback without a word — which
     * is why every plate photo reported 0% confidence.
     */
    private static Double numberOrNull(JsonNode node, String key) {
        JsonNode val = node.path(key);
        if (val.isNumber()) {
            return val.asDouble();
        }
        if (val.isTextual()) {
            try {
                return Double.valueOf(val.asText().trim());
            } catch (NumberFormatException ex) {
                return null;
            }
        }
        return null;
    }

    private static String textOrNull(JsonNode node, String key) {
        JsonNode val = node.path(key);
        return val.isTextual() ? val.asText() : null;
    }

    private static double numberAsDouble(JsonNode node, String key, double fallback) {
        Double d = numberOrNull(node, key);
        return d == null ? fallback : d;
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
            String note,
            Integer pieces) {
    }

    private record CalorieEstimate(int kcalPer100g, String source) {
    }

    /** One AI answer for a typed entry. per100g is protein, carbs, fat, fiber, or null if any is missing. */
    private record AiGuess(Integer kcalPer100g, Integer quantityGrams, double[] per100g) {
    }
}
