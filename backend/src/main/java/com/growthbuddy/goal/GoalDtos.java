package com.growthbuddy.goal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

enum GoalHorizon {
    short_term,
    mid_term,
    long_term
}

record CreateGoalRequest(
        @NotBlank @Size(max = 255) String title,
        @Size(max = 1000) String description,
        GoalHorizon horizon,
        LocalDate targetDate) {
}

/**
 * Edit a goal. A null field is left as it is; a blank description clears it, and
 * {@code clearTargetDate} is the only way to remove a target date (a null
 * targetDate means "unchanged").
 */
record UpdateGoalRequest(
        @Size(max = 255) String title,
        @Size(max = 1000) String description,
        GoalHorizon horizon,
        LocalDate targetDate,
        Boolean clearTargetDate) {
}

record CreateGoalActionRequest(
        @NotBlank @Size(max = 1000) String note,
        LocalDate actionDate) {
}

record UpdateGoalActionRequest(
        @NotBlank @Size(max = 1000) String note,
        LocalDate actionDate) {
}

record GoalActionResponse(
        UUID id,
        UUID goalId,
        String note,
        LocalDate actionDate,
        Instant createdAt) {

    static GoalActionResponse from(GoalAction action) {
        return new GoalActionResponse(action.getId(), action.getGoalId(), action.getNote(),
                action.getActionDate(), action.getCreatedAt());
    }
}

record GoalResponse(
        UUID id,
        String title,
        String description,
        GoalHorizon horizon,
        LocalDate targetDate,
        boolean completed,
        Instant completedAt,
        Instant createdAt,
        Instant updatedAt,
        long actionCount,
        Instant latestActionAt,
        List<GoalActionResponse> recentActions,
        JsonNode progress,
        /**
         * Finished linked tasks the midnight sweep already cleared. The live ones
         * are in {@code GET /api/tasks} (by their {@code goalId}); these are not,
         * so "Tasks: done/total" adds them to both numbers.
         */
        long clearedTaskCount,
        /**
         * Which progress blob this is: send it back as {@code If-Match} on
         * {@code PUT /progress} and a save on top of a newer blob is a 409
         * (HOS-2). A hash of the stored text, not updated_at: exact, and a
         * title edit does not make a milestone save stale.
         */
        String progressVersion) {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    GoalResponse withClearedTaskCount(long n) {
        return new GoalResponse(id, title, description, horizon, targetDate, completed, completedAt,
                createdAt, updatedAt, actionCount, latestActionAt, recentActions, progress, n, progressVersion);
    }

    /** First 16 hex digits of SHA-256 over the stored blob; "0" for none. */
    static String progressVersion(String json) {
        if (json == null) {
            return "0";
        }
        try {
            byte[] d = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(json.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(d, 0, 8);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Parse the stored progress blob; null/blank or malformed -> null. */
    static JsonNode parseProgress(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    static GoalResponse from(Goal goal, long actionCount, Instant latestActionAt) {
        return new GoalResponse(goal.getId(), goal.getTitle(), goal.getDescription(), goal.getHorizon(),
                goal.getTargetDate(), goal.isCompleted(), goal.getCompletedAt(),
                goal.getCreatedAt(), goal.getUpdatedAt(), actionCount, latestActionAt, List.of(),
                parseProgress(goal.getProgressJson()), 0, progressVersion(goal.getProgressJson()));
    }

    static GoalResponse from(Goal goal, long actionCount, Instant latestActionAt,
            List<GoalActionResponse> recentActions) {
        return new GoalResponse(goal.getId(), goal.getTitle(), goal.getDescription(), goal.getHorizon(),
                goal.getTargetDate(), goal.isCompleted(), goal.getCompletedAt(),
                goal.getCreatedAt(), goal.getUpdatedAt(), actionCount, latestActionAt,
                recentActions != null ? recentActions : List.of(),
                parseProgress(goal.getProgressJson()), 0, progressVersion(goal.getProgressJson()));
    }
}

record GoalSectionResponse(
        GoalHorizon horizon,
        List<GoalResponse> goals) {
}