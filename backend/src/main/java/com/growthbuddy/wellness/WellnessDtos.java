package com.growthbuddy.wellness;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface DailyLogRepository extends JpaRepository<DailyLog, DailyLog.Key> {
    List<DailyLog> findByUserIdAndLogDateBetween(UUID userId, LocalDate start, LocalDate end);
}

/* ---- Requests (date defaults to today server-side if omitted) ---- */

/*
 * SEC-8: these strings come back in GET /api/daily-logs and go into Buddy's
 * prompt, so only the shapes the UI produces are accepted: "HH:MM" from a time
 * input, and the option values of the sleep and check-in dialogs (plus "poor",
 * which quick add's sleep can send). Mood stays words, not an allow-list: quick
 * add files the "one or two words" the parser read.
 */
record SleepRequest(
        LocalDate date,
        @Pattern(regexp = HHMM) String bedtime,
        @Pattern(regexp = HHMM) String wakeTime,
        @Pattern(regexp = "poor|low|okay|good|great") String quality,
        @Size(max = 2000) String note) {
    static final String HHMM = "([01]\\d|2[0-3]):[0-5]\\d";
}

record MoodRequest(
        LocalDate date,
        @Size(max = 16) @Pattern(regexp = "[\\p{L}\\p{M}' -]*") String mood,
        @Pattern(regexp = "low|medium|high") String energy,
        @Pattern(regexp = "calm|normal|high") String stress,
        @Size(max = 2000) String note) {
}

record SnapshotRequest(
        LocalDate date,
        Integer score,
        Integer waterMl,
        Integer waterGoalMl,
        Integer kcal) {
}

/* ---- Response: the three date-keyed maps the frontend already consumes ---- */

record SleepEntry(String date, String bedtime, String wakeTime, String quality, String note) {
}

record MoodEntry(String date, String mood, String energy, String stress, String note) {
}

record MetricEntry(String date, int score, int waterMl, int waterGoalMl, int kcal) {
}

record DailyLogsResponse(
        Map<String, SleepEntry> sleepByDate,
        Map<String, MoodEntry> moodByDate,
        Map<String, MetricEntry> byDate) {
}
