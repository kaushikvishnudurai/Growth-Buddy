package com.growthbuddy.family;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/family")
public class FamilyController {

    private final FamilyService service;

    public FamilyController(FamilyService service) {
        this.service = service;
    }

    @GetMapping
    public FamilyResponse getFamily() {
        return service.getFamily(CurrentUser.id());
    }

    @PostMapping("/members")
    @ResponseStatus(HttpStatus.CREATED)
    public FamilyResponse addMember(@Valid @RequestBody AddMemberRequest req) {
        return service.addMember(CurrentUser.id(), req);
    }

    @PutMapping("/members/{id}")
    public FamilyResponse updateMember(@PathVariable UUID id, @Valid @RequestBody UpdateMemberRequest req) {
        return service.updateMember(CurrentUser.id(), id, req);
    }

    @PutMapping("/members/{id}/profile")
    public FamilyResponse updateProfile(@PathVariable UUID id, @RequestBody FoodProfile profile) {
        return service.updateProfile(CurrentUser.id(), id, profile);
    }

    @DeleteMapping("/members/{id}")
    public FamilyResponse removeMember(@PathVariable UUID id) {
        return service.removeMember(CurrentUser.id(), id);
    }

    @GetMapping("/search")
    public List<UserSearchResult> search(@RequestParam String q) {
        return service.searchUsers(CurrentUser.id(), q);
    }

    @PostMapping("/members/link")
    public FamilyResponse link(@Valid @RequestBody LinkMemberRequest req) {
        return service.linkMember(CurrentUser.id(), req);
    }

    @GetMapping("/invites")
    public List<InviteResponse> invites() {
        return service.listInvites(CurrentUser.id());
    }

    @PostMapping("/invites/{memberId}/accept")
    public FamilyResponse acceptInvite(@PathVariable UUID memberId) {
        return service.acceptInvite(CurrentUser.id(), memberId);
    }

    @PostMapping("/invites/{memberId}/decline")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void declineInvite(@PathVariable UUID memberId) {
        service.declineInvite(CurrentUser.id(), memberId);
    }

    @PostMapping("/leave")
    public FamilyResponse leave() {
        return service.leaveFamily(CurrentUser.id());
    }

    /** Owner only: make another mapped member the owner (the caller stays a member). */
    @PostMapping("/transfer")
    public FamilyResponse transfer(@Valid @RequestBody TransferOwnershipRequest req) {
        return service.transferOwnership(CurrentUser.id(), req.memberId());
    }

    @PostMapping("/grocery-scan")
    public GroceryScanResponse groceryScan(@Valid @RequestBody GroceryScanRequest req) {
        return service.scanGroceries(req);
    }

    @PostMapping("/meal-plan")
    public MealPlanResponse generateMealPlan(@RequestBody(required = false) MealPlanRequest req) {
        return service.generateMealPlan(CurrentUser.id(), req);
    }

    @GetMapping("/meal-plan")
    public ResponseEntity<MealPlanResponse> latestPlan() {
        MealPlanResponse plan = service.getLatestPlan(CurrentUser.id());
        if (plan == null) {
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.ok(plan);
    }

    /** The last 8 one-day plans, newest first (the current one included). */
    @GetMapping("/plans/history")
    public List<MealPlanResponse> planHistory() {
        return service.planHistory(CurrentUser.id());
    }

    /** Use again: copy an older plan forward as the current one. */
    @PostMapping("/meal-plan/{planId}/reuse")
    public MealPlanResponse reusePlan(@PathVariable UUID planId) {
        return service.reusePlan(CurrentUser.id(), planId);
    }

    @PutMapping("/meal-plan/{planId}/cook")
    public MealPlanResponse assignCook(@PathVariable UUID planId, @Valid @RequestBody AssignCookRequest req) {
        return service.assignCook(CurrentUser.id(), planId, req);
    }

    @PutMapping("/meal-plan/multi/{planId}/cook")
    public MultiDayPlanResponse assignMultiDayCook(@PathVariable UUID planId,
            @Valid @RequestBody AssignCookRequest req) {
        return service.assignMultiDayCook(CurrentUser.id(), planId, req);
    }

    // ---- Recipes (per dish) ----

    @GetMapping("/recipes")
    public List<RecipeResponse> recipes() {
        return service.listRecipes(CurrentUser.id());
    }

    /** Upsert by dish name; an empty recipe deletes it (204). */
    @PutMapping("/recipes")
    public ResponseEntity<RecipeResponse> saveRecipe(@Valid @RequestBody RecipeRequest req) {
        RecipeResponse r = service.saveRecipe(CurrentUser.id(), req);
        return r == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(r);
    }

    @DeleteMapping("/recipes/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteRecipe(@PathVariable UUID id) {
        service.deleteRecipe(CurrentUser.id(), id);
    }

    // ---- Chores ----

    @GetMapping("/chores")
    public List<ChoreResponse> chores() {
        return service.listChores(CurrentUser.id());
    }

    @PostMapping("/chores")
    public List<ChoreResponse> addChore(@Valid @RequestBody ChoreRequest req) {
        return service.addChore(CurrentUser.id(), req);
    }

    @PutMapping("/chores/{id}")
    public List<ChoreResponse> updateChore(@PathVariable UUID id, @Valid @RequestBody ChoreRequest req) {
        return service.updateChore(CurrentUser.id(), id, req);
    }

    @PostMapping("/chores/{id}/toggle")
    public List<ChoreResponse> toggleChore(@PathVariable UUID id,
            @RequestBody(required = false) ToggleChoreRequest req) {
        return service.toggleChore(CurrentUser.id(), id, req != null ? req.done() : null);
    }

    @DeleteMapping("/chores/{id}")
    public List<ChoreResponse> deleteChore(@PathVariable UUID id) {
        return service.deleteChore(CurrentUser.id(), id);
    }

    // ---- Favourites ----

    @GetMapping("/favourites")
    public List<FavouriteMenuResponse> favourites() {
        return service.listFavourites(CurrentUser.id());
    }

    @PostMapping("/favourites")
    @ResponseStatus(HttpStatus.CREATED)
    public FavouriteMenuResponse saveFavourite(@Valid @RequestBody SaveFavouriteRequest req) {
        return service.saveFavourite(CurrentUser.id(), req);
    }

    @DeleteMapping("/favourites/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteFavourite(@PathVariable UUID id) {
        service.deleteFavourite(CurrentUser.id(), id);
    }

    // ---- Multi-day (weekly / monthly) plans ----

    @PostMapping("/meal-plan/multi")
    public MultiDayPlanResponse generateMultiDay(@RequestBody(required = false) MultiDayPlanRequest req) {
        return service.generateMultiDay(CurrentUser.id(), req);
    }

    @GetMapping("/meal-plan/multi")
    public ResponseEntity<MultiDayPlanResponse> latestMultiDay() {
        MultiDayPlanResponse plan = service.getLatestMultiDay(CurrentUser.id());
        return plan == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(plan);
    }

    @PostMapping("/meal-plan/{planId}/cooked")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markCooked(@PathVariable UUID planId) {
        service.markPlanCooked(CurrentUser.id(), planId);
    }

    // ---- Pantry ----

    @GetMapping("/pantry")
    public List<PantryItemResponse> pantry() {
        return service.listPantry(CurrentUser.id());
    }

    @PostMapping("/pantry")
    @ResponseStatus(HttpStatus.CREATED)
    public PantryItemResponse addPantry(@Valid @RequestBody PantryItemRequest req) {
        return service.addPantry(CurrentUser.id(), req);
    }

    @PostMapping("/pantry/scan")
    public PantryScanResponse scanPantry(@Valid @RequestBody PantryScanRequest req) {
        return service.scanPantry(CurrentUser.id(), req);
    }

    @PutMapping("/pantry/{id}")
    public PantryItemResponse updatePantry(@PathVariable UUID id, @Valid @RequestBody PantryItemRequest req) {
        return service.updatePantry(CurrentUser.id(), id, req);
    }

    @DeleteMapping("/pantry/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deletePantry(@PathVariable UUID id) {
        service.deletePantry(CurrentUser.id(), id);
    }

    // ---- Shopping list ----

    @GetMapping("/shopping")
    public ShoppingListResponse shopping() {
        return service.listShopping(CurrentUser.id());
    }

    @PostMapping("/shopping")
    public ShoppingListResponse addShopping(@Valid @RequestBody ShoppingItemRequest req) {
        return service.addShopping(CurrentUser.id(), req);
    }

    @PostMapping("/shopping/generate")
    public ShoppingListResponse generateShopping(@RequestBody(required = false) GenerateShoppingRequest req) {
        return service.generateShopping(CurrentUser.id(), req);
    }

    /** Pantry items marked low or expiring within 2 days, onto the list (deduped). */
    @PostMapping("/shopping/from-pantry")
    public ShoppingListResponse shoppingFromPantry() {
        return service.restockFromPantry(CurrentUser.id());
    }

    @PostMapping("/shopping/{id}/toggle")
    public ShoppingListResponse toggleShopping(@PathVariable UUID id,
            @RequestBody(required = false) ToggleShoppingRequest req) {
        return service.toggleShopping(CurrentUser.id(), id, req != null ? req.checked() : null);
    }

    @DeleteMapping("/shopping/{id}")
    public ShoppingListResponse deleteShopping(@PathVariable UUID id) {
        return service.deleteShopping(CurrentUser.id(), id);
    }
}
