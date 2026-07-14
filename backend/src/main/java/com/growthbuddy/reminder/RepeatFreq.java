package com.growthbuddy.reminder;

/**
 * Recurrence frequency for a calendar reminder. Lowercase names match the
 * frontend JSON ("none", "daily", "weekly", "monthly", "yearly").
 */
public enum RepeatFreq {
    none, daily, weekly, monthly, yearly
}
