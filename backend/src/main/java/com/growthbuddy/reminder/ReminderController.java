package com.growthbuddy.reminder;

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
@RequestMapping("/api/reminders")
public class ReminderController {

    private final ReminderService service;

    public ReminderController(ReminderService service) {
        this.service = service;
    }

    /** Raw reminder definitions for the current user. */
    @GetMapping
    public List<ReminderResponse> list() {
        return service.list(CurrentUser.id());
    }

    /** Expanded occurrences in a date range — used to render calendar dots. */
    @GetMapping("/occurrences")
    public List<OccurrenceResponse> occurrences(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return service.occurrences(CurrentUser.id(), from, to);
    }

    /** Occurrences on a single day. */
    @GetMapping("/day/{date}")
    public List<OccurrenceResponse> day(
            @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return service.occurrencesOn(CurrentUser.id(), date);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ReminderResponse create(@Valid @RequestBody CreateReminderRequest req) {
        return service.create(CurrentUser.id(), req);
    }

    /**
     * Scoped delete. {@code scope} is one of all|this|future|before; {@code date}
     * is the occurrence the user acted on (required for recurring scopes).
     */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @PathVariable UUID id,
            @RequestParam(defaultValue = "all") String scope,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        service.delete(CurrentUser.id(), id, scope, date);
    }
}
