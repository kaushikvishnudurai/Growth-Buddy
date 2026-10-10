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
import org.springframework.web.bind.annotation.PatchMapping;
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
    private final ReminderSnoozeService snoozes;

    public ReminderController(ReminderService service, ReminderSnoozeService snoozes) {
        this.service = service;
        this.snoozes = snoozes;
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
     * Scoped edit, the mirror of the delete below. {@code scope} is
     * all|this|future; {@code date} is the occurrence the user acted on and is
     * required for the recurring scopes.
     */
    @PatchMapping("/{id}")
    public ReminderResponse update(
            @PathVariable UUID id,
            @RequestParam(defaultValue = "all") String scope,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @Valid @RequestBody UpdateReminderRequest req) {
        return service.update(CurrentUser.id(), id, scope, date, req);
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

    /** Every reminder as an iCalendar file, for Google / Apple / Outlook. */
    // No `produces`: the content type is set on the response itself, which skips
    // negotiation, so a client sending its usual Accept: application/json still gets the file.
    @GetMapping("/export.ics")
    public org.springframework.http.ResponseEntity<String> exportIcs() {
        return org.springframework.http.ResponseEntity.ok()
                .contentType(org.springframework.http.MediaType.parseMediaType("text/calendar; charset=utf-8"))
                .header("Content-Disposition", "attachment; filename=\"growth-buddy-reminders.ics\"")
                .body(service.exportIcs(CurrentUser.id()));
    }

    /** Check one occurrence off: it is not delivered, and the device queues no alarm for it. */
    @PostMapping("/{id}/done")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markDone(@PathVariable UUID id,
                         @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        service.setDone(CurrentUser.id(), id, date, true);
    }

    @DeleteMapping("/{id}/done")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unmarkDone(@PathVariable UUID id,
                           @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        service.setDone(CurrentUser.id(), id, date, false);
    }

    /** Ring it again in {@code minutes} (default: the user's snooze length). */
    @PostMapping("/{id}/snooze")
    public ReminderResponse snooze(@PathVariable UUID id, @Valid @RequestBody(required = false) SnoozeRequest req) {
        return snoozes.snooze(CurrentUser.id(), id, req == null ? null : req.minutes());
    }

    @DeleteMapping("/{id}/snooze")
    public ReminderResponse cancelSnooze(@PathVariable UUID id) {
        return snoozes.cancel(CurrentUser.id(), id);
    }

    /**
     * The Snooze button on a push notification, sent by the service worker,
     * which holds no session: the signed token is the authority (anonymous in
     * CurrentUserInterceptor). A bad or expired one gets the same 404 as a
     * deleted reminder, so the endpoint answers nothing about either.
     */
    @PostMapping("/snooze-link")
    public java.util.Map<String, java.time.Instant> snoozeByLink(@Valid @RequestBody SnoozeLinkRequest req) {
        return snoozes.snoozeByLink(req.token())
                .map(at -> java.util.Map.of("snoozedUntil", at))
                .orElseThrow(() -> com.growthbuddy.common.ApiException.notFound("Reminder"));
    }
}
