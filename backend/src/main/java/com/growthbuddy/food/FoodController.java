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
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/food")
public class FoodController {

    private final FoodService service;

    public FoodController(FoodService service) {
        this.service = service;
    }

    @GetMapping
    public FoodSummaryResponse summary(
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return service.summary(CurrentUser.id(), date);
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
