package com.growthbuddy.habit;

/**
 * What a habit's check-in measures, on top of "done".
 *
 * <p>{@link #none} is every habit that existed before this: ticking it is the
 * whole record. The rest ask for a number when you tick them — distance for a
 * run or a ride, steps for a walk — and the streak still works off done/not, so
 * nothing about streaks or freeze tokens changes.
 *
 * <p>Speed is deliberately absent: it is {@code km / minutes}, derived where
 * it's shown. A stored speed is a third number that can disagree with the two
 * it came from.
 */
public enum HabitMetric {
    none,
    km,
    steps,
    minutes
}
