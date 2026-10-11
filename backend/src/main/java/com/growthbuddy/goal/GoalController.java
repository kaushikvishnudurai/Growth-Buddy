package com.growthbuddy.goal;

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
@RequestMapping("/api/goals")
public class GoalController {

    private final GoalService service;

    public GoalController(GoalService service) {
        this.service = service;
    }

    @GetMapping
    public List<GoalSectionResponse> list() {
        return service.list(CurrentUser.id());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public GoalResponse create(@Valid @RequestBody CreateGoalRequest req) {
        return service.create(CurrentUser.id(), req);
    }

    @PutMapping("/{id}")
    public GoalResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateGoalRequest req) {
        return service.update(CurrentUser.id(), id, req);
    }

    @PatchMapping("/{id}/toggle")
    public GoalResponse toggle(@PathVariable UUID id) {
        return service.toggleComplete(CurrentUser.id(), id);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(CurrentUser.id(), id);
    }

    /** Persist the goal's progress blob (milestones, day-tracker, …). */
    @PutMapping("/{id}/progress")
    public org.springframework.http.ResponseEntity<GoalResponse> saveProgress(@PathVariable UUID id,
            @org.springframework.web.bind.annotation.RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody(required = false) com.fasterxml.jackson.databind.JsonNode progress) {
        // 409 carries the current goal (its progress + progressVersion) so the
        // client can re-apply its edit without another GET.
        try {
            return org.springframework.http.ResponseEntity.ok(service.saveProgress(CurrentUser.id(), id, progress, ifMatch));
        } catch (GoalService.StaleProgress stale) {
            return org.springframework.http.ResponseEntity.status(HttpStatus.CONFLICT).body(stale.current);
        }
    }

    @GetMapping("/{id}/actions")
    public List<GoalActionResponse> actions(@PathVariable UUID id) {
        return service.listActions(CurrentUser.id(), id);
    }

    @PostMapping("/{id}/actions")
    @ResponseStatus(HttpStatus.CREATED)
    public GoalActionResponse addAction(@PathVariable UUID id, @Valid @RequestBody CreateGoalActionRequest req) {
        return service.addAction(CurrentUser.id(), id, req);
    }

    @PutMapping("/{id}/actions/{actionId}")
    public GoalActionResponse updateAction(@PathVariable UUID id, @PathVariable UUID actionId,
            @Valid @RequestBody UpdateGoalActionRequest req) {
        return service.updateAction(CurrentUser.id(), id, actionId, req);
    }

    @DeleteMapping("/{id}/actions/{actionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAction(@PathVariable UUID id, @PathVariable UUID actionId) {
        service.deleteAction(CurrentUser.id(), id, actionId);
    }
}