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
        JsonNode progress) {

    private static final ObjectMapper MAPPER = new ObjectMapper();

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
                parseProgress(goal.getProgressJson()));
    }

    static GoalResponse from(Goal goal, long actionCount, Instant latestActionAt,
            List<GoalActionResponse> recentActions) {
        return new GoalResponse(goal.getId(), goal.getTitle(), goal.getDescription(), goal.getHorizon(),
                goal.getTargetDate(), goal.isCompleted(), goal.getCompletedAt(),
                goal.getCreatedAt(), goal.getUpdatedAt(), actionCount, latestActionAt,
                recentActions != null ? recentActions : List.of(),
                parseProgress(goal.getProgressJson()));
    }
}

record GoalSectionResponse(
        GoalHorizon horizon,
        List<GoalResponse> goals) {
}