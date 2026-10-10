package com.growthbuddy.habit;

/**
 * What a habit asks of the user. {@code build}: tick it to do it (every habit
 * before this existed). {@code quit}: "break a habit" — each day is clean by
 * default, and the user logs a slip; its streak is the days since the last one.
 * Lowercase to match the stored values, like {@link Cadence}.
 */
public enum HabitKind {
    build, quit
}
