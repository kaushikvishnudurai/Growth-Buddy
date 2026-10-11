package com.growthbuddy.health;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
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

/** Health readings: typed by hand, or synced from Apple Health / Health Connect. */
@RestController
@RequestMapping("/api/health")
public class HealthController {

    private final HealthReadingService service;

    public HealthController(HealthReadingService service) {
        this.service = service;
    }

    @GetMapping("/readings")
    public List<HealthReadingResponse> list(@RequestParam(defaultValue = "90") int days) {
        return service.list(CurrentUser.id(), days);
    }

    @PostMapping("/readings")
    @ResponseStatus(HttpStatus.CREATED)
    public HealthReadingResponse create(@Valid @RequestBody CreateHealthReadingRequest req) {
        return service.create(CurrentUser.id(), req);
    }

    @PutMapping("/readings/{id}")
    public HealthReadingResponse update(@PathVariable UUID id, @RequestBody UpdateHealthReadingRequest req) {
        return service.update(CurrentUser.id(), id, req);
    }

    @DeleteMapping("/readings/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(CurrentUser.id(), id);
    }

    /** The phone app's daily totals and latest readings; invalid items are skipped. */
    @PostMapping("/sync")
    public SyncResponse sync(@RequestBody SyncRequest req) {
        return service.sync(CurrentUser.id(), req);
    }
}
