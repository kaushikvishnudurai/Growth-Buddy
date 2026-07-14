package com.growthbuddy.wellness;

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

record SleepRequest(
        LocalDate date,
        @Size(max = 5) String bedtime,
        @Size(max = 5) String wakeTime,
        @Size(max = 16) String quality,
        @Size(max = 2000) String note) {
}

record MoodRequest(
        LocalDate date,
        @Size(max = 16) String mood,
        @Size(max = 16) String energy,
        @Size(max = 16) String stress,
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
