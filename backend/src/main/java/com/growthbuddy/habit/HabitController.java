package com.growthbuddy.habit;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
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
import org.springframework.web.bind.annotation.RequestParam;
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

    /** Save the user's order (top first); answers with the list in that order. Mapped before
     *  {@code /{id}} for readability — Spring prefers the literal path either way. */
    @PutMapping("/order")
    public List<HabitResponse> reorder(@Valid @RequestBody HabitOrderRequest req) {
        return service.reorder(CurrentUser.id(), req.ids());
    }

    @PutMapping("/{id}")
    public HabitResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateHabitRequest req) {
        return service.update(CurrentUser.id(), id, req);
    }

    /** Record a check-in for a given day (defaults to today). */
    @PostMapping("/{id}/checkin")
    public HabitResponse checkin(@PathVariable UUID id, @RequestBody(required = false) CheckinRequest req) {
        return service.checkin(CurrentUser.id(), id, req != null ? req : new CheckinRequest(null, null, null, null, null));
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

    /** Recent days for one habit — what the freeze calendar draws. */
    @GetMapping("/{id}/history")
    public HabitHistory history(@PathVariable UUID id,
                                  @RequestParam(defaultValue = "120") int days) {
        return service.history(CurrentUser.id(), id, days);
    }

    /**
     * Every habit's recent days at once, {@code {habitId: {since, days[]}}} —
     * Insights' read, which was one {@code /{id}/history} call per daily habit.
     * {@code days} is clamped to 1..400.
     */
    @GetMapping("/history")
    public Map<UUID, HabitHistory> historyAll(@RequestParam(defaultValue = "60") int days) {
        return service.historyAll(CurrentUser.id(), days);
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
