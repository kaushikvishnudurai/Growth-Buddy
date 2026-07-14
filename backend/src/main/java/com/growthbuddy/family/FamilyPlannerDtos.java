package com.growthbuddy.family;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

// --- Repositories ---

interface FamilyFavouriteMenuRepository extends JpaRepository<FamilyFavouriteMenu, UUID> {
    List<FamilyFavouriteMenu> findByFamilyIdOrderByCreatedAtDesc(UUID familyId);
}

interface FamilyMultiDayPlanRepository extends JpaRepository<FamilyMultiDayPlan, UUID> {
    Optional<FamilyMultiDayPlan> findFirstByFamilyIdOrderByCreatedAtDesc(UUID familyId);
}

interface FamilyPantryItemRepository extends JpaRepository<FamilyPantryItem, UUID> {
    List<FamilyPantryItem> findByFamilyIdAndDeletedAtIsNullOrderByCreatedAtDesc(UUID familyId);
}

interface FamilyShoppingItemRepository extends JpaRepository<FamilyShoppingItem, UUID> {
    List<FamilyShoppingItem> findByFamilyIdOrderByCheckedAscCreatedAtDesc(UUID familyId);
}

interface FamilyDishPreferenceRepository extends JpaRepository<FamilyDishPreference, UUID> {
    Optional<FamilyDishPreference> findByFamilyIdAndDishName(UUID familyId, String dishName);

    List<FamilyDishPreference> findTop12ByFamilyIdOrderByScoreDescLastSeenDesc(UUID familyId);
}

// --- Occasion ---

enum Occasion {
    normal,
    festival,
    fasting
}

// --- Favourites ---

record SaveFavouriteRequest(
        @NotBlank @Size(max = 120) String name,
        UUID planId, // optional: a specific meal plan; else the latest
        JsonNode plan,  // optional: an explicit plan body to save
        String occasion) {
}

record FavouriteMenuResponse(
        UUID id,
        String name,
        String occasion,
        JsonNode plan,
        Instant createdAt) {
}

// --- Multi-day plan ---

record MultiDayPlanRequest(
        Integer days, // 1..14 (UI offers 7 = weekly, 14 = fortnight; monthly = 4 weekly calls)
        String occasion, // normal | festival | fasting
        List<GroceryItem> ingredients,
        List<UUID> memberIds,
        Boolean usePantry) {
}

record MultiDayPlanResponse(
        UUID planId,
        int days,
        String occasion,
        JsonNode plan,
        String source,
        Instant createdAt) {
}

// --- Pantry ---

record PantryItemRequest(
        @NotBlank @Size(max = 120) String name,
        @Size(max = 32) String category,
        @Size(max = 60) String quantity,
        LocalDate expiryDate,
        Boolean leftover) {
}

record PantryScanRequest(
        @NotBlank @Size(max = 2_000_000) String imageDataUrl) {

    public PantryScanRequest {
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

record PantryItemResponse(
        UUID id,
        String name,
        String category,
        String quantity,
        LocalDate expiryDate,
        Integer daysToExpiry,
        boolean expiringSoon,
        boolean expired,
        boolean leftover,
        Instant createdAt) {
}

record PantryScanResponse(
        List<PantryItemResponse> added,
        int count,
        boolean fallbackNeeded,
        String message,
        String source) {
}

// --- Shopping list ---

record ShoppingItemRequest(
        @NotBlank @Size(max = 120) String name,
        @Size(max = 60) String quantity,
        Integer estimatedCost) {
}

record ShoppingItemResponse(
        UUID id,
        String name,
        String quantity,
        Integer estimatedCost,
        boolean checked,
        Instant createdAt) {
}

record ShoppingListResponse(
        List<ShoppingItemResponse> items,
        int totalEstimatedCost) {
}

record GenerateShoppingRequest(
        UUID planId, // optional: base the list on a specific plan; else latest
        Boolean estimateCost) {
}
