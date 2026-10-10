package com.growthbuddy.food;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Locale;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface FoodEntryRepository extends JpaRepository<FoodEntry, UUID> {
    List<FoodEntry> findByUserIdAndLogDateOrderByLoggedAtDesc(UUID userId, LocalDate logDate);

    List<FoodEntry> findByUserIdAndLogDateBetween(UUID userId, LocalDate from, LocalDate to);

    /** One day's rows, unordered; FoodService.copySlot picks a slot from them. */
    List<FoodEntry> findByUserIdAndLogDate(UUID userId, LocalDate logDate);

    /** The newest entries, for the add form's "recent foods" chips (deduped in FoodService.recent). */
    List<FoodEntry> findTop60ByUserIdOrderByLoggedAtDesc(UUID userId);

    /**
     * Fills an estimate in place. An UPDATE, not save(): the entity was read
     * before a seconds-long AI call, and merging it back would re-insert an entry
     * the user deleted meanwhile. "is null" keeps a parallel estimate from
     * overwriting this one.
     */
    @org.springframework.transaction.annotation.Transactional
    @org.springframework.data.jpa.repository.Modifying
    @Query("update FoodEntry e set e.proteinG = coalesce(e.proteinG, :p), e.carbsG = coalesce(e.carbsG, :c),"
            + " e.fatG = coalesce(e.fatG, :f), e.fiberG = coalesce(e.fiberG, :fi) where e.id = :id")
    int setNutrientsIfMissing(@Param("id") UUID id, @Param("p") int p, @Param("c") int c,
            @Param("f") int f, @Param("fi") int fi);

    @Query("select coalesce(sum(e.kcalEstimated), 0) from FoodEntry e where e.userId = :userId and e.logDate = :logDate")
    int totalCaloriesForDay(@Param("userId") UUID userId, @Param("logDate") LocalDate logDate);
}

interface FoodFavouriteRepository extends JpaRepository<FoodFavourite, UUID> {
    List<FoodFavourite> findByUserIdOrderByCreatedAtDesc(UUID userId);

    long countByUserId(UUID userId);

    java.util.Optional<FoodFavourite> findFirstByUserIdAndFoodNameIgnoreCase(UUID userId, String foodName);
}

interface FoodPhotoLogRepository extends JpaRepository<FoodPhotoLog, UUID> {
    List<FoodPhotoLog> findTop12ByUserIdOrderByCreatedAtDesc(UUID userId);
}

/** Recorded after a photo analysis; mirrors the frontend's recent-scan card. */
record PhotoHistoryRequest(
        @NotBlank @Size(max = 255) String foodName,
        @Size(max = 32) String mealType,
        Integer confidence,
        boolean fallbackNeeded,
        LocalDate date) {
}

record PhotoHistoryItem(
        UUID id,
        String date,
        String foodName,
        String mealType,
        Integer confidence,
        boolean fallbackNeeded,
        Instant createdAt) {

    static PhotoHistoryItem from(FoodPhotoLog p) {
        return new PhotoHistoryItem(p.getId(), p.getLogDate().toString(), p.getFoodName(),
                p.getMealType(), p.getConfidence(), p.isFallbackNeeded(), p.getCreatedAt());
    }
}

enum MealType {
    home,
    hotel
}

/**
 * Which meal of the day. Defaulted from the local hour the food was logged at
 * when the request has none; mirrored by {@code mealSlotAt} in scripts/nutrition.js,
 * which groups the rows from before slots existed (null here) the same way.
 */
enum MealSlot {
    breakfast,
    lunch,
    dinner,
    snack;

    /** 04-10 breakfast, 11-15 lunch, 18-22 dinner, anything else a snack. */
    static MealSlot forHour(int hour) {
        if (hour >= 4 && hour < 11) {
            return breakfast;
        }
        if (hour >= 11 && hour < 16) {
            return lunch;
        }
        if (hour >= 18 && hour < 23) {
            return dinner;
        }
        return snack;
    }

    static MealSlot at(Instant instant, java.time.ZoneId zone) {
        return forHour(instant.atZone(zone).getHour());
    }
}

enum PortionSize {
        small,
        medium,
        large
}

enum RiceBase {
        no,
        yes,
        unsure
}

record AddFoodEntryRequest(
        @NotBlank @Size(max = 255) String foodName,
                @Min(10) @Max(2000) Integer quantityGrams,
        MealType mealType,
                PortionSize portionSize,
                RiceBase riceBase,
        @Size(max = 255) String note,
        Instant loggedAt,
        /**
         * Calories the user typed in themselves. Present means "use this number,
         * don't guess" — the estimator is skipped entirely, which also means the
         * entry costs no OpenFoodFacts lookup and no AI call.
         *
         * <p>Bounds match the column's own CHECK (1..5000), so a slipped finger is
         * a clear 400 rather than a constraint violation surfacing as a 500. It is
         * a ceiling for one entry, not for a day.
         */
        @Min(1) @Max(5000) Integer kcal,
        /**
         * "2 dosa": a count instead of grams, for food nobody weighs. Turned into
         * grams on the server (the AI, else a per-piece table); quantityGrams wins
         * when both are sent.
         */
        @Min(1) @Max(30) Integer pieces,
        /** Absent: from the local hour of loggedAt (MealSlot.forHour). */
        MealSlot mealSlot,
        /**
         * Label figures for the portion, sent with a barcode product (OpenFoodFacts)
         * or a favourite. Taken only alongside a typed kcal; an estimate fills its
         * own. Bounds are the columns'.
         */
        @Min(0) @Max(900) Integer proteinG,
        @Min(0) @Max(900) Integer carbsG,
        @Min(0) @Max(900) Integer fatG,
        @Min(0) @Max(900) Integer fiberG,
        @Min(0) @Max(900) Integer sugarG,
        @Min(0) @Max(50000) Integer sodiumMg) {

    /** The shape before slots and label nutrients. */
    AddFoodEntryRequest(String foodName, Integer quantityGrams, MealType mealType, PortionSize portionSize,
            RiceBase riceBase, String note, Instant loggedAt, Integer kcal, Integer pieces) {
        this(foodName, quantityGrams, mealType, portionSize, riceBase, note, loggedAt, kcal, pieces,
                null, null, null, null, null, null, null);
    }
}

/**
 * PUT /api/food/entries/{id}: every field optional, absent = unchanged. Same bounds
 * as adding one, so an edit can't store what an add would refuse.
 */
record UpdateFoodEntryRequest(
        @Size(max = 255) String foodName,
        @Min(10) @Max(2000) Integer quantityGrams,
        @Min(1) @Max(5000) Integer kcal,
        MealType mealType,
        LocalDate date,
        @Size(max = 255) String note,
        MealSlot mealSlot) {

    UpdateFoodEntryRequest(String foodName, Integer quantityGrams, Integer kcal, MealType mealType,
            LocalDate date, String note) {
        this(foodName, quantityGrams, kcal, mealType, date, note, null);
    }
}

/** A starred food (FoodFavourite). */
record FoodFavouriteResponse(UUID id, String foodName, int quantityGrams, int kcal,
        Integer proteinG, Integer carbsG, Integer fatG, Integer fiberG) {

    static FoodFavouriteResponse from(FoodFavourite f) {
        return new FoodFavouriteResponse(f.getId(), f.getFoodName(), f.getQuantityGrams(), f.getKcal(),
                f.getProteinG(), f.getCarbsG(), f.getFatG(), f.getFiberG());
    }
}

/** POST /api/food/favourites: star this entry. */
record AddFavouriteRequest(@jakarta.validation.constraints.NotNull UUID entryId) {
}

/**
 * GET /api/food/barcode/{code}: one OpenFoodFacts product, per 100 g. Any figure
 * the label lacks is null; servingGrams is the label's serving when it has one.
 */
record BarcodeProduct(String code, String name, Integer kcalPer100g, Double proteinPer100g,
        Double carbsPer100g, Double fatPer100g, Double fiberPer100g, Double sugarPer100g,
        Integer sodiumMgPer100g, Integer servingGrams) {
}

record PhotoFoodEstimateRequest(
        @NotBlank @Size(max = 2_000_000) String imageDataUrl,
        MealType mealType,
        PortionSize portionSize,
        RiceBase riceBase) {
    
    public PhotoFoodEstimateRequest {
        if (mealType == null)   mealType   = MealType.home;
        if (portionSize == null) portionSize = PortionSize.medium;
        if (riceBase == null)   riceBase   = RiceBase.unsure;
        // Reject unsupported MIME types before forwarding to OpenAI.
        if (imageDataUrl != null) {
            String lower = imageDataUrl.toLowerCase(Locale.ROOT);
            if (!lower.startsWith("data:image/jpeg;base64,")
                    && !lower.startsWith("data:image/jpg;base64,")
                    && !lower.startsWith("data:image/png;base64,")
                    && !lower.startsWith("data:image/webp;base64,")
                    && !lower.startsWith("data:image/heic;base64,")
                    && !lower.startsWith("data:image/heif;base64,")) {
                throw new IllegalArgumentException(
                    "Image must be JPEG, PNG, or WebP. Other formats are not supported.");
            }
        }
    }
}

record FoodItem(
        String foodName,
        Integer quantityGrams,
        Integer kcalPer100g) {
}

record PhotoFoodEstimateResponse(
        String suggestedFoodName,
        Integer quantityGrams,
        Integer kcalPer100g,
        double confidence,
        boolean fallbackNeeded,
        String message,
        String source) {
}

record PhotoFoodEstimateMultiResponse(
        List<FoodItem> items,
        double confidence,
        boolean fallbackNeeded,
        String message,
        String source) {
}

record FoodSearchItem(
        String name,
        Integer kcalPer100g,
        String source) {
}

record FoodEntryResponse(
        UUID id,
        String foodName,
        int quantityGrams,
        MealType mealType,
        int kcalEstimated,
        int kcalPer100g,
        String estimateSource,
        String note,
        Instant loggedAt,
        LocalDate logDate,
        /** null on rows from before slots; the app derives one from loggedAt. */
        MealSlot mealSlot,
        Integer proteinG,
        Integer carbsG,
        Integer fatG,
        Integer fiberG,
        Integer sugarG,
        Integer sodiumMg) {

    static FoodEntryResponse from(FoodEntry e) {
        return new FoodEntryResponse(
                e.getId(),
                e.getFoodName(),
                e.getQuantityGrams(),
                e.getMealType(),
                e.getKcalEstimated(),
                e.getKcalPer100g(),
                e.getEstimateSource(),
                e.getNote(),
                e.getLoggedAt(),
                e.getLogDate(),
                e.getMealSlot(),
                e.getProteinG(),
                e.getCarbsG(),
                e.getFatG(),
                e.getFiberG(),
                e.getSugarG(),
                e.getSodiumMg());
    }
}

/**
 * The Summary screen: 7 days, oldest first, empty days included. proteinTargetG
 * and sources (protein's) predate targets / sourcesBy and stay for builds that
 * still read them. averages / avgKcal / levels are what the diet check judges
 * by too, so the screen and Buddy can't disagree. levels: nutrient to
 * low|ok|high.
 */
record FoodWeekResponse(int goalKcal, int proteinTargetG, List<FoodWeekDay> days, List<ProteinSource> sources,
        Nutrients targets, Nutrients averages, int avgKcal, Map<String, String> levels,
        Map<String, List<NutrientSource>> sourcesBy) {
}

/** Grams a day of each nutrient. */
record Nutrients(int proteinG, int carbsG, int fatG, int fiberG) {
}

/** Grams are estimated: the AI's per-entry figure where it has one, else the keyword table. */
record FoodWeekDay(String date, int kcal, int count, int proteinG, int carbsG, int fatG, int fiberG) {
}

record ProteinSource(String name, int count, int proteinG) {
}

record NutrientSource(String name, int count, int g) {
}

/** Each nutrient is low|ok|high, or null when nothing is logged; source is ai|rules. */
/** {@code water}: low/ok/high, or null when no water was logged in the window (Water off, or never used). */
record DietCheckResponse(String protein, String carbs, String fat, String fiber, String water, String summary,
        List<String> add, String source) {
}

/**
 * One day. fiberG / sugarG / sodiumMg are the day's sums over the entries that
 * carry the figure, null when none does: fiber is estimated (FoodWeek fills it),
 * sugar and sodium come only from a barcode label, so the card shows a line only
 * for what is actually known.
 */
record FoodSummaryResponse(
        LocalDate date,
        int totalCalories,
        List<FoodEntryResponse> entries,
        Integer fiberG,
        Integer sugarG,
        Integer sodiumMg) {

    FoodSummaryResponse(LocalDate date, int totalCalories, List<FoodEntryResponse> entries) {
        this(date, totalCalories, entries, null, null, null);
    }
}
