package com.growthbuddy.goal;

import com.growthbuddy.common.ApiException;
import java.time.Instant;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class GoalService {

    private final GoalRepository goals;
    private final GoalActionRepository actions;

    public GoalService(GoalRepository goals, GoalActionRepository actions) {
        this.goals = goals;
        this.actions = actions;
    }

    @Transactional(readOnly = true)
    public List<GoalSectionResponse> list(UUID userId) {
        Map<GoalHorizon, List<GoalResponse>> grouped = new EnumMap<>(GoalHorizon.class);
        for (GoalHorizon horizon : GoalHorizon.values()) {
            grouped.put(horizon, List.of());
        }
        List<Goal> items = goals.findByUserIdOrderByCreatedAtDesc(userId);
        for (GoalHorizon horizon : GoalHorizon.values()) {
            List<GoalResponse> rows = items.stream()
                    .filter(g -> g.getHorizon() == horizon)
                        .map(g -> GoalResponse.from(g, actions.countByGoalId(g.getId()), latestActionAt(g.getId()),
                            recentActions(g.getId())))
                    .toList();
            grouped.put(horizon, rows);
        }
        return GoalHorizon.values().length == 0
                ? List.of()
                : List.of(
                        new GoalSectionResponse(GoalHorizon.short_term, grouped.get(GoalHorizon.short_term)),
                        new GoalSectionResponse(GoalHorizon.mid_term, grouped.get(GoalHorizon.mid_term)),
                        new GoalSectionResponse(GoalHorizon.long_term, grouped.get(GoalHorizon.long_term)));
    }

    @Transactional
    public GoalResponse create(UUID userId, CreateGoalRequest req) {
        if (req == null || !StringUtils.hasText(req.title())) {
            throw ApiException.badRequest("title is required");
        }
        Goal goal = new Goal();
        goal.setUserId(userId);
        goal.setTitle(req.title().trim());
        goal.setDescription(StringUtils.hasText(req.description()) ? req.description().trim() : null);
        goal.setHorizon(req.horizon() != null ? req.horizon() : GoalHorizon.short_term);
        goal.setTargetDate(req.targetDate());
        Goal saved = goals.save(goal);
        return GoalResponse.from(saved, 0, null);
    }

    @Transactional
    public GoalResponse toggleComplete(UUID userId, UUID goalId) {
        Goal goal = requireGoal(userId, goalId);
        goal.setCompleted(!goal.isCompleted());
        goal.setCompletedAt(goal.isCompleted() ? Instant.now() : null);
        Goal saved = goals.save(goal);
        return GoalResponse.from(saved, actions.countByGoalId(goalId), latestActionAt(goalId), recentActions(goalId));
    }

    @Transactional
    public void delete(UUID userId, UUID goalId) {
        Goal goal = requireGoal(userId, goalId);
        goals.delete(goal);
    }

    /** Persist the frontend's opaque per-goal progress blob verbatim. */
    @Transactional
    public GoalResponse saveProgress(UUID userId, UUID goalId, com.fasterxml.jackson.databind.JsonNode progress) {
        Goal goal = requireGoal(userId, goalId);
        goal.setProgressJson(progress == null || progress.isNull() ? null : progress.toString());
        Goal saved = goals.save(goal);
        return GoalResponse.from(saved, actions.countByGoalId(goalId), latestActionAt(goalId), recentActions(goalId));
    }

    @Transactional(readOnly = true)
    public List<GoalActionResponse> listActions(UUID userId, UUID goalId) {
        requireGoal(userId, goalId);
        return actions.findByGoalIdOrderByCreatedAtDesc(goalId).stream()
                .map(GoalActionResponse::from).toList();
    }

    @Transactional
    public GoalActionResponse addAction(UUID userId, UUID goalId, CreateGoalActionRequest req) {
        requireGoal(userId, goalId);
        if (req == null || !StringUtils.hasText(req.note())) {
            throw ApiException.badRequest("note is required");
        }
        GoalAction action = new GoalAction();
        action.setGoalId(goalId);
        action.setUserId(userId);
        action.setNote(req.note().trim());
        action.setActionDate(req.actionDate() != null ? req.actionDate() : java.time.LocalDate.now());
        return GoalActionResponse.from(actions.save(action));
    }

    @Transactional
    public GoalActionResponse updateAction(UUID userId, UUID goalId, UUID actionId, UpdateGoalActionRequest req) {
        requireGoal(userId, goalId);
        GoalAction action = requireAction(userId, goalId, actionId);
        if (req == null || !StringUtils.hasText(req.note())) {
            throw ApiException.badRequest("note is required");
        }
        action.setNote(req.note().trim());
        action.setActionDate(req.actionDate() != null ? req.actionDate() : action.getActionDate());
        return GoalActionResponse.from(actions.save(action));
    }

    @Transactional
    public void deleteAction(UUID userId, UUID goalId, UUID actionId) {
        requireGoal(userId, goalId);
        actions.delete(requireAction(userId, goalId, actionId));
    }

    private Goal requireGoal(UUID userId, UUID goalId) {
        return goals.findByIdAndUserId(goalId, userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Goal not found"));
    }

    private GoalAction requireAction(UUID userId, UUID goalId, UUID actionId) {
        GoalAction action = actions.findByIdAndUserId(actionId, userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Goal action not found"));
        if (!goalId.equals(action.getGoalId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Goal action not found");
        }
        return action;
    }

    private List<GoalActionResponse> recentActions(UUID goalId) {
        return actions.findTop3ByGoalIdOrderByCreatedAtDesc(goalId).stream()
                .map(GoalActionResponse::from)
                .toList();
    }

    private Instant latestActionAt(UUID goalId) {
        return actions.findByGoalIdOrderByCreatedAtDesc(goalId).stream()
                .findFirst()
                .map(GoalAction::getCreatedAt)
                .orElse(null);
    }
}