package com.growthbuddy.food;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Locale;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface FoodEntryRepository extends JpaRepository<FoodEntry, UUID> {
    List<FoodEntry> findByUserIdAndLogDateOrderByLoggedAtDesc(UUID userId, LocalDate logDate);

    @Query("select coalesce(sum(e.kcalEstimated), 0) from FoodEntry e where e.userId = :userId and e.logDate = :logDate")
    int totalCaloriesForDay(@Param("userId") UUID userId, @Param("logDate") LocalDate logDate);
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
        Instant loggedAt) {
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
        LocalDate logDate) {

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
                e.getLogDate());
    }
}

record FoodSummaryResponse(
        LocalDate date,
        int totalCalories,
        List<FoodEntryResponse> entries) {
}
