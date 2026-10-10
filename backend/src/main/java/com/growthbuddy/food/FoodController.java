package com.growthbuddy.food;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
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
@RequestMapping("/api/food")
public class FoodController {

    private final FoodService service;
    private final FoodWeek week;

    public FoodController(FoodService service, FoodWeek week) {
        this.service = service;
        this.week = week;
    }

    /** Last 7 days of calories against the goal. No AI. */
    @GetMapping("/week")
    public FoodWeekResponse week() {
        return week.week(CurrentUser.id());
    }

    /** Is the week (or one day of it) short on protein or fiber? AI, so rate-limited in WebConfig. */
    @PostMapping("/diet-check")
    public DietCheckResponse dietCheck(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return week.check(CurrentUser.id(), date);
    }

    @GetMapping
    public FoodSummaryResponse summary(
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return service.summary(CurrentUser.id(), date);
    }

    /** Recent distinct foods, for one-tap re-logging in the add form. No AI. */
    @GetMapping("/recent")
    public List<FoodEntryResponse> recent() {
        return service.recent(CurrentUser.id());
    }

    @GetMapping("/search")
    public List<FoodSearchItem> search(@RequestParam String q) {
        return service.search(q);
    }

    @PostMapping("/entries")
    @ResponseStatus(HttpStatus.CREATED)
    public FoodSummaryResponse addEntry(@Valid @RequestBody AddFoodEntryRequest req) {
        return service.addEntry(CurrentUser.id(), req);
    }

    /**
     * The same add, for an entry whose calories the user typed. Its own path so it
     * sits outside the AI rate limit (WebConfig limits POST /entries by exact
     * path): with kcal present addEntry makes no AI call and no lookup, and kcal is
     * required here so this path can never reach one. Logging from a label used to
     * spend the same budget as a photo estimate.
     */
    @PostMapping("/entries/manual")
    @ResponseStatus(HttpStatus.CREATED)
    public FoodSummaryResponse addManualEntry(@Valid @RequestBody AddFoodEntryRequest req) {
        if (req.kcal() == null) {
            throw com.growthbuddy.common.ApiException.badRequest("kcal is required here");
        }
        return service.addEntry(CurrentUser.id(), req);
    }

    @PutMapping("/entries/{id}")
    public FoodSummaryResponse updateEntry(@PathVariable UUID id, @Valid @RequestBody UpdateFoodEntryRequest req) {
        return service.updateEntry(CurrentUser.id(), id, req);
    }

    /**
     * "Copy yesterday's breakfast": the slot's entries from {@code from} (default
     * yesterday) again on {@code to} (default today), as manual kcal. No AI.
     */
    @PostMapping("/entries/copy")
    @ResponseStatus(HttpStatus.CREATED)
    public FoodSummaryResponse copySlot(@RequestParam MealSlot slot,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return service.copySlot(CurrentUser.id(), slot, from, to);
    }

    /** Starred foods, newest first: the "Log food" form's first chip row. */
    @GetMapping("/favourites")
    public List<FoodFavouriteResponse> favourites() {
        return service.favourites(CurrentUser.id());
    }

    @PostMapping("/favourites")
    @ResponseStatus(HttpStatus.CREATED)
    public List<FoodFavouriteResponse> addFavourite(@Valid @RequestBody AddFavouriteRequest req) {
        return service.addFavourite(CurrentUser.id(), req.entryId());
    }

    @DeleteMapping("/favourites/{id}")
    public List<FoodFavouriteResponse> deleteFavourite(@PathVariable UUID id) {
        return service.deleteFavourite(CurrentUser.id(), id);
    }

    /** One packaged product from OpenFoodFacts by barcode, per 100 g. No AI; 404 when unknown. */
    @GetMapping("/barcode/{code}")
    public BarcodeProduct barcode(@PathVariable String code) {
        return service.barcode(code);
    }

    @PostMapping("/photo-estimate")
    public PhotoFoodEstimateResponse photoEstimate(@Valid @RequestBody PhotoFoodEstimateRequest req) {
        return service.estimateFromPhoto(req);
    }

    @PostMapping("/photo-estimate-multi")
    public PhotoFoodEstimateMultiResponse photoEstimateMulti(@Valid @RequestBody PhotoFoodEstimateRequest req) {
        return service.estimateFromPhotoMulti(req);
    }

    @DeleteMapping("/entries/{id}")
    public FoodSummaryResponse deleteEntry(@PathVariable UUID id) {
        return service.deleteEntry(CurrentUser.id(), id);
    }

    /** Recent food-photo analyses (the "recent scans" list). */
    @GetMapping("/photo-history")
    public List<PhotoHistoryItem> photoHistory() {
        return service.photoHistory(CurrentUser.id());
    }

    @PostMapping("/photo-history")
    @ResponseStatus(HttpStatus.CREATED)
    public List<PhotoHistoryItem> recordPhoto(@Valid @RequestBody PhotoHistoryRequest req) {
        return service.recordPhoto(CurrentUser.id(), req);
    }
}
