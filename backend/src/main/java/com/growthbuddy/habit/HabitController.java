package com.growthbuddy.habit;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/habits")
public class HabitController {

    private final HabitService service;

    public HabitController(HabitService service) {
        this.service = service;
    }

    @GetMapping
    public List<HabitResponse> list() {
        return service.list(CurrentUser.id());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public HabitResponse create(@Valid @RequestBody CreateHabitRequest req) {
        return service.create(CurrentUser.id(), req);
    }

    @PutMapping("/{id}")
    public HabitResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateHabitRequest req) {
        return service.update(CurrentUser.id(), id, req);
    }

    /** Record a check-in for a given day (defaults to today). */
    @PostMapping("/{id}/checkin")
    public HabitResponse checkin(@PathVariable UUID id, @RequestBody(required = false) CheckinRequest req) {
        return service.checkin(CurrentUser.id(), id, req != null ? req : new CheckinRequest(null, null, null));
    }

    /** Toggle today's completion. */
    @PatchMapping("/{id}/toggle")
    public HabitResponse toggleToday(@PathVariable UUID id) {
        return service.toggleToday(CurrentUser.id(), id);
    }

    /** Current freeze-token balance (granted weekly). */
    @GetMapping("/freeze")
    public FreezeStatus freezeStatus() {
        return service.freezeStatus(CurrentUser.id());
    }

    /** Protect a day (rest/freeze) so a missed day doesn't break the streak. */
    @PostMapping("/{id}/protect")
    public HabitResponse protect(@PathVariable UUID id, @RequestBody(required = false) ProtectRequest req) {
        return service.protect(CurrentUser.id(), id, req != null ? req.date() : null);
    }

    /** Undo a protected day and refund the token. */
    @PostMapping("/{id}/unprotect")
    public HabitResponse unprotect(@PathVariable UUID id, @RequestBody(required = false) ProtectRequest req) {
        return service.unprotect(CurrentUser.id(), id, req != null ? req.date() : null);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(CurrentUser.id(), id);
    }
}
