package com.growthbuddy.reminder;

/**
 * Recurrence frequency for a calendar reminder. Lowercase names match the
 * frontend JSON ("none", "daily", "weekdays", "weekly", "monthly", "yearly")
 * and are what lands in the {@code repeat_freq} column, which is a
 * {@code varchar(16)} — a new value needs no migration, but it must fit.
 */
public enum RepeatFreq {
    none, daily, weekdays, weekly, monthly, yearly
}
