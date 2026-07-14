package com.growthbuddy.family;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

// --- Repositories ---

interface FamilyRepository extends JpaRepository<Family, UUID> {
}

interface FamilyMemberRepository extends JpaRepository<FamilyMember, UUID> {
    List<FamilyMember> findByFamilyIdAndDeletedAtIsNullOrderByCreatedAtAsc(UUID familyId);

    List<FamilyMember> findByLinkedUserIdAndDeletedAtIsNull(UUID linkedUserId);

    List<FamilyMember> findByLinkedUserIdAndStatusAndDeletedAtIsNull(UUID linkedUserId, MemberStatus status);

    boolean existsByFamilyIdAndLinkedUserIdAndDeletedAtIsNull(UUID familyId, UUID linkedUserId);
}

interface FamilyMealPlanRepository extends JpaRepository<FamilyMealPlan, UUID> {
    Optional<FamilyMealPlan> findFirstByFamilyIdOrderByCreatedAtDesc(UUID familyId);
}

// --- Enums ---

enum Relationship {
    self,
    mother,
    father,
    brother,
    sister,
    grandfather,
    grandmother,
    spouse,
    child,
    other
}

enum MemberStatus {
    unmapped,
    invited,
    mapped
}

// --- Food profile (shared request + response shape) ---

record FoodProfile(
        List<String> favouriteDishes,
        List<String> favouriteIngredients,
        String dietPreference,
        List<String> allergies,
        List<String> ingredientsToAvoid,
        List<String> medicalConditions) {
}

// --- Member requests/responses ---

record AddMemberRequest(
        @NotBlank @Size(max = 120) String name,
        Relationship relationship,
        LocalDate dob,
        @Size(max = 20) String gender,
        @Min(30) @Max(250) Integer heightCm,
        @Min(2) @Max(400) Integer weightKg,
        FoodProfile profile) {
}

record UpdateMemberRequest(
        @NotBlank @Size(max = 120) String name,
        Relationship relationship,
        LocalDate dob,
        @Size(max = 20) String gender,
        @Min(30) @Max(250) Integer heightCm,
        @Min(2) @Max(400) Integer weightKg) {
}

record LinkMemberRequest(
        @NotNull UUID userId,
        UUID memberId) {
}

record FamilyMemberResponse(
        UUID id,
        String name,
        Relationship relationship,
        LocalDate dob,
        Integer age,
        String ageCategory,
        String gender,
        Integer heightCm,
        Integer weightKg,
        MemberStatus status,
        UUID linkedUserId,
        boolean isOwner,
        boolean isSelf,
        FoodProfile profile) {
}

record FamilyResponse(
        UUID familyId,
        UUID ownerUserId,
        boolean isOwner,
        List<FamilyMemberResponse> members) {
}

// --- User search ---

record UserSearchResult(
        UUID id,
        String displayName,
        String email, // masked (e.g. k•••k@gmail.com) — never the raw address
        boolean alreadyInFamily) {
}

record InviteResponse(
        UUID memberId,
        UUID familyId,
        String ownerName,
        String invitedAs,
        Instant createdAt) {
}

// --- Grocery scan ---

record GroceryScanRequest(
        @NotBlank @Size(max = 2_000_000) String imageDataUrl) {

    public GroceryScanRequest {
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

record GroceryItem(
        String name,
        String category,
        String quantity,
        String freshness) {
}

record GroceryScanResponse(
        List<GroceryItem> items,
        double confidence,
        boolean fallbackNeeded,
        String message,
        String source) {
}

// --- Meal plan ---

record MealPlanRequest(
        List<GroceryItem> ingredients,
        List<UUID> memberIds) {
}

record MealPlanResponse(
        UUID planId,
        JsonNode plan,
        JsonNode groceryItems,
        String source,
        Instant createdAt) {
}
