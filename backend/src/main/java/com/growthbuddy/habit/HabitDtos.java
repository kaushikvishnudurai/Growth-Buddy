package com.growthbuddy.habit;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

record CreateHabitRequest(
        @NotBlank @Size(max = 120) String name,
        HabitDomain domain,
        @NotBlank @Size(max = 64) String icon,
        @Size(max = 16) String color,
        Cadence cadence,
        Integer targetPerWeek,
        LocalTime reminderTime) {
}

record UpdateHabitRequest(
        @Size(max = 120) String name,
        HabitDomain domain,
        @Size(max = 64) String icon,
        @Size(max = 16) String color,
        Cadence cadence,
        Integer targetPerWeek,
        LocalTime reminderTime,
        Boolean active) {
}

/** Body for a check-in; {@code date} defaults to today, {@code done} defaults to true. */
record CheckinRequest(LocalDate date, Boolean done, String note) {
}

/** Body for protecting/unprotecting a habit day; {@code date} defaults to today. */
record ProtectRequest(LocalDate date) {
}

/** The user's freeze-token wallet snapshot. */
record FreezeStatus(int tokens, int cap) {
}

record HabitResponse(
        UUID id,
        String name,
        HabitDomain domain,
        String icon,
        String color,
        Cadence cadence,
        int targetPerWeek,
        LocalTime reminderTime,
        boolean active,
        int streak,
        int longestStreak,
        boolean doneToday,
        // ---- streak-freeze fields ----
        boolean protectedToday,
        boolean atRisk,
        int riskStreak,
        int freezeTokens) {

    static HabitResponse of(Habit h, HabitStreak streak, int currentStreak, boolean doneToday,
                            boolean protectedToday, boolean atRisk, int riskStreak, int freezeTokens) {
        // Current streak is computed live (date-aware) by the caller so a streak
        // that broke from a missed day shows immediately on read — without waiting
        // for the next check-in to recompute the stored value. Longest comes from
        // the stored record (it only grows on a mutation).
        int longest = Math.max(streak != null ? streak.getLongestStreak() : 0, currentStreak);
        return new HabitResponse(h.getId(), h.getName(), h.getDomain(), h.getIcon(), h.getColor(),
                h.getCadence(), h.getTargetPerWeek(), h.getReminderTime(),
                h.isActive(), currentStreak, longest, doneToday,
                protectedToday, atRisk, riskStreak, freezeTokens);
    }
}
