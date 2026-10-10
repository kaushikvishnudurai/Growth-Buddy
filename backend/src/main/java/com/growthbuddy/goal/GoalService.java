package com.growthbuddy.goal;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.task.TaskRepository;
import com.growthbuddy.user.UserClock;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class GoalService {

    /**
     * Largest progress blob a goal may store. The blob is the client's day tracker
     * and milestones, so a real one is a few KB; this only stops a TEXT column
     * being used as free storage.
     */
    static final int MAX_PROGRESS_BYTES = 64 * 1024;

    private final GoalRepository goals;
    private final GoalActionRepository actions;
    private final UserClock clock;
    private final TaskRepository tasks;

    public GoalService(GoalRepository goals, GoalActionRepository actions, UserClock clock,
            TaskRepository tasks) {
        this.goals = goals;
        this.actions = actions;
        this.clock = clock;
        this.tasks = tasks;
    }

    /** Whether {@code goalId} is one of this user's goals: what a task may be linked to. */
    @Transactional(readOnly = true)
    public boolean ownsGoal(UUID userId, UUID goalId) {
        return goalId != null && goals.existsByIdAndUserId(goalId, userId);
    }

    /** An action is something already done: a day that hasn't happened yet is not one. */
    LocalDate pastOrToday(UUID userId, LocalDate date) {
        if (date != null && date.isAfter(clock.today(userId))) {
            throw ApiException.badRequest("An action can't be dated in the future.");
        }
        return date;
    }

    @Transactional(readOnly = true)
    public List<GoalSectionResponse> list(UUID userId) {
        Map<GoalHorizon, List<GoalResponse>> grouped = new EnumMap<>(GoalHorizon.class);
        for (GoalHorizon horizon : GoalHorizon.values()) {
            grouped.put(horizon, List.of());
        }
        List<Goal> items = goals.findByUserIdOrderByCreatedAtDesc(userId);
        // One batched count, then the top 3 per goal; the latest action's time is
        // the first of those. Was three queries per goal, one of which loaded the
        // goal's whole action history to read its first row.
        Map<UUID, Long> counts = new HashMap<>();
        Map<UUID, Long> cleared = new HashMap<>();
        if (!items.isEmpty()) {
            List<UUID> ids = items.stream().map(Goal::getId).toList();
            for (Object[] row : actions.countByGoalIds(ids)) {
                counts.put((UUID) row[0], (Long) row[1]);
            }
            for (Object[] row : tasks.countClearedByGoalIds(userId, ids)) {
                cleared.put((UUID) row[0], ((Number) row[1]).longValue());
            }
        }
        for (GoalHorizon horizon : GoalHorizon.values()) {
            List<GoalResponse> rows = items.stream()
                    .filter(g -> g.getHorizon() == horizon)
                    .map(g -> withActions(g, counts.getOrDefault(g.getId(), 0L),
                            cleared.getOrDefault(g.getId(), 0L)))
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
    public GoalResponse update(UUID userId, UUID goalId, UpdateGoalRequest req) {
        Goal goal = requireGoal(userId, goalId);
        if (req == null) {
            return withActions(goal, actions.countByGoalId(goalId));
        }
        if (req.title() != null) {
            if (!StringUtils.hasText(req.title())) {
                throw ApiException.badRequest("title is required");
            }
            goal.setTitle(req.title().trim());
        }
        if (req.description() != null) {
            goal.setDescription(StringUtils.hasText(req.description()) ? req.description().trim() : null);
        }
        if (req.horizon() != null) {
            goal.setHorizon(req.horizon());
        }
        if (req.targetDate() != null) {
            goal.setTargetDate(req.targetDate());
        } else if (Boolean.TRUE.equals(req.clearTargetDate())) {
            goal.setTargetDate(null);
        }
        Goal saved = goals.save(goal);
        return withActions(saved, actions.countByGoalId(goalId));
    }

    @Transactional
    public GoalResponse toggleComplete(UUID userId, UUID goalId) {
        Goal goal = requireGoal(userId, goalId);
        applyToggle(goal, Instant.now());
        Goal saved = goals.save(goal);
        return withActions(saved, actions.countByGoalId(goalId));
    }

    /** Flip done, stamping or clearing completedAt with it. */
    static void applyToggle(Goal goal, Instant now) {
        goal.setCompleted(!goal.isCompleted());
        goal.setCompletedAt(goal.isCompleted() ? now : null);
    }

    @Transactional
    public void delete(UUID userId, UUID goalId) {
        Goal goal = requireGoal(userId, goalId);
        // tasks.goal_id has no foreign key (tasks is created before goals), so
        // the link is cleared here: the tasks stay, on no goal.
        tasks.clearGoal(userId, goalId);
        goals.delete(goal);
    }

    /**
     * Persist the frontend's per-goal progress blob verbatim. It stays opaque, but
     * it must be a JSON object (the client always sends one) and fit in
     * {@link #MAX_PROGRESS_BYTES}; null clears it.
     */
    @Transactional
    public GoalResponse saveProgress(UUID userId, UUID goalId, com.fasterxml.jackson.databind.JsonNode progress) {
        Goal goal = requireGoal(userId, goalId);
        goal.setProgressJson(progressJson(progress));
        Goal saved = goals.save(goal);
        return withActions(saved, actions.countByGoalId(goalId));
    }

    static String progressJson(com.fasterxml.jackson.databind.JsonNode progress) {
        if (progress == null || progress.isNull()) {
            return null;
        }
        if (!progress.isObject()) {
            throw ApiException.badRequest("Goal progress must be a JSON object.");
        }
        String json = progress.toString();
        if (json.getBytes(StandardCharsets.UTF_8).length > MAX_PROGRESS_BYTES) {
            throw ApiException.badRequest("Goal progress is too large.");
        }
        return json;
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
        LocalDate date = pastOrToday(userId, req.actionDate());
        action.setActionDate(date != null ? date : clock.today(userId));
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
        LocalDate date = pastOrToday(userId, req.actionDate());
        action.setActionDate(date != null ? date : action.getActionDate());
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

    GoalAction requireAction(UUID userId, UUID goalId, UUID actionId) {
        GoalAction action = actions.findByIdAndUserId(actionId, userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Goal action not found"));
        if (!goalId.equals(action.getGoalId())) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Goal action not found");
        }
        return action;
    }

    /** The response with its recent actions; the latest action's time is the first of them. */
    private GoalResponse withActions(Goal goal, long actionCount) {
        long cleared = 0;
        for (Object[] row : tasks.countClearedByGoalIds(goal.getUserId(), List.of(goal.getId()))) {
            cleared += ((Number) row[1]).longValue();
        }
        return withActions(goal, actionCount, cleared);
    }

    private GoalResponse withActions(Goal goal, long actionCount, long clearedTasks) {
        List<GoalActionResponse> recent = actions.findTop3ByGoalIdOrderByCreatedAtDesc(goal.getId()).stream()
                .map(GoalActionResponse::from)
                .toList();
        Instant latest = recent.isEmpty() ? null : recent.get(0).createdAt();
        return GoalResponse.from(goal, actionCount, latest, recent).withClearedTaskCount(clearedTasks);
    }
}