package com.growthbuddy.water;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import java.time.LocalDate;
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
@RequestMapping("/api/water")
public class WaterController {

    private final WaterService service;

    public WaterController(WaterService service) {
        this.service = service;
    }

    @GetMapping
    public WaterSummaryResponse summary(
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return service.summary(CurrentUser.id(), date);
    }

    @PostMapping("/entries")
    @ResponseStatus(HttpStatus.CREATED)
    public WaterSummaryResponse addEntry(@Valid @RequestBody AddWaterEntryRequest req) {
        return service.addEntry(CurrentUser.id(), req);
    }

    @DeleteMapping("/entries/{id}")
    public WaterSummaryResponse deleteEntry(@PathVariable UUID id) {
        return service.deleteEntry(CurrentUser.id(), id);
    }

    @PutMapping("/goal")
    public WaterSummaryResponse updateGoal(@Valid @RequestBody UpdateWaterGoalRequest req) {
        return service.updateGoal(CurrentUser.id(), req);
    }
}
