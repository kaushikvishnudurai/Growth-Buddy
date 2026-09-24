package com.growthbuddy.habit;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.time.LocalTime;
import java.util.UUID;

record CreateHabitRequest(
        @NotBlank @Size(max = 120) String name,
        HabitDomain domain,
        @NotBlank @Size(max = 64) String icon,
        @Size(max = 16) String color,
        Cadence cadence,
        Integer targetPerWeek,
        LocalTime reminderTime,
        HabitMetric metric,
        @Size(max = 16) String sound) {
}

record UpdateHabitRequest(
        @Size(max = 120) String name,
        HabitDomain domain,
        @Size(max = 64) String icon,
        @Size(max = 16) String color,
        Cadence cadence,
        Integer targetPerWeek,
        LocalTime reminderTime,
        HabitMetric metric,
        Boolean active,
        @Size(max = 16) String sound) {
}

/**
 * Body for a check-in; {@code date} defaults to today, {@code done} defaults to
 * true. {@code value} is the habit's metric for that day (km, steps, minutes) and
 * is optional even on a measured habit — the tick counts either way.
 */
record CheckinRequest(
        LocalDate date,
        Boolean done,
        String note,
        @PositiveOrZero @Max(1000000) Double value,
        @PositiveOrZero @Max(1440) Integer durationMin) {
}

/** Body for protecting/unprotecting a habit day; {@code date} defaults to today. */
record ProtectRequest(LocalDate date) {
}

/** The user's freeze-token wallet snapshot. */
record FreezeStatus(int tokens, int cap) {
}

/** One day of a habit's history, for the freeze calendar. */
record HabitDay(LocalDate date, boolean done, boolean protectedDay) {
}

/**
 * A habit's history plus the day it started. Without {@code since} the calendar
 * has no way to tell "missed" from "did not exist yet", and a habit created this
 * morning painted the whole month red.
 */
record HabitHistory(LocalDate since, List<HabitDay> days) {
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
        int freezeTokens,
        HabitMetric metric,
        Double todayValue,
        Integer todayDurationMin,
        String sound) {

    static HabitResponse of(Habit h, HabitStreak streak, int currentStreak, boolean doneToday,
                            boolean protectedToday, boolean atRisk, int riskStreak, int freezeTokens) {
        return of(h, streak, currentStreak, doneToday, protectedToday, atRisk, riskStreak,
                freezeTokens, null, null);
    }

    static HabitResponse of(Habit h, HabitStreak streak, int currentStreak, boolean doneToday,
                            boolean protectedToday, boolean atRisk, int riskStreak, int freezeTokens,
                            Double todayValue, Integer todayDurationMin) {
        // Current streak is computed live (date-aware) by the caller so a streak
        // that broke from a missed day shows immediately on read — without waiting
        // for the next check-in to recompute the stored value. Longest comes from
        // the stored record (it only grows on a mutation).
        int longest = Math.max(streak != null ? streak.getLongestStreak() : 0, currentStreak);
        return new HabitResponse(h.getId(), h.getName(), h.getDomain(), h.getIcon(), h.getColor(),
                h.getCadence(), h.getTargetPerWeek(), h.getReminderTime(),
                h.isActive(), currentStreak, longest, doneToday,
                protectedToday, atRisk, riskStreak, freezeTokens,
                h.getMetric(), todayValue, todayDurationMin, h.getSound());
    }
}
