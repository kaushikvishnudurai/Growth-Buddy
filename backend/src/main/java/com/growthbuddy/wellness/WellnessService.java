package com.growthbuddy.wellness;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Persists per-day sleep, mood, and metric snapshots; reads them back as the
 * date-keyed maps the frontend's wellness + trends stores expect. */
@Service
public class WellnessService {

    private final DailyLogRepository logs;

    public WellnessService(DailyLogRepository logs) {
        this.logs = logs;
    }

    private DailyLog upsert(UUID userId, LocalDate date) {
        DailyLog.Key key = new DailyLog.Key();
        key.setUserId(userId);
        key.setLogDate(date);
        return logs.findById(key).orElseGet(() -> {
            DailyLog d = new DailyLog();
            d.setUserId(userId);
            d.setLogDate(date);
            return d;
        });
    }

    private static LocalDate orToday(LocalDate d) {
        return d != null ? d : LocalDate.now();
    }

    @Transactional
    public void saveSleep(UUID userId, SleepRequest req) {
        DailyLog d = upsert(userId, orToday(req.date()));
        d.setBedtime(req.bedtime());
        d.setWakeTime(req.wakeTime());
        d.setSleepQuality(req.quality() != null ? req.quality() : "okay");
        d.setSleepNote(req.note());
        logs.save(d);
    }

    @Transactional
    public void saveMood(UUID userId, MoodRequest req) {
        DailyLog d = upsert(userId, orToday(req.date()));
        d.setMood(req.mood() != null ? req.mood() : "okay");
        d.setEnergy(req.energy() != null ? req.energy() : "medium");
        d.setStress(req.stress() != null ? req.stress() : "normal");
        d.setMoodNote(req.note());
        logs.save(d);
    }

    @Transactional
    public void snapshot(UUID userId, SnapshotRequest req) {
        DailyLog d = upsert(userId, orToday(req.date()));
        d.setScore(req.score() != null ? req.score() : 0);
        d.setWaterMl(req.waterMl() != null ? req.waterMl() : 0);
        d.setWaterGoalMl(req.waterGoalMl() != null ? req.waterGoalMl() : 0);
        d.setKcal(req.kcal() != null ? req.kcal() : 0);
        logs.save(d);
    }

    /** Last {@code days} days of logs as the three maps the frontend consumes. */
    @Transactional(readOnly = true)
    public DailyLogsResponse range(UUID userId, int days) {
        int span = Math.max(1, Math.min(366, days));
        LocalDate end = LocalDate.now();
        LocalDate start = end.minusDays(span - 1L);

        Map<String, SleepEntry> sleep = new LinkedHashMap<>();
        Map<String, MoodEntry> mood = new LinkedHashMap<>();
        Map<String, MetricEntry> metric = new LinkedHashMap<>();

        for (DailyLog d : logs.findByUserIdAndLogDateBetween(userId, start, end)) {
            String key = d.getLogDate().toString();
            if (d.getSleepQuality() != null || d.getBedtime() != null) {
                sleep.put(key, new SleepEntry(key, d.getBedtime(), d.getWakeTime(),
                        d.getSleepQuality(), d.getSleepNote()));
            }
            if (d.getMood() != null) {
                mood.put(key, new MoodEntry(key, d.getMood(), d.getEnergy(),
                        d.getStress(), d.getMoodNote()));
            }
            if (d.getScore() != null) {
                metric.put(key, new MetricEntry(key, d.getScore(),
                        nz(d.getWaterMl()), nz(d.getWaterGoalMl()), nz(d.getKcal())));
            }
        }
        return new DailyLogsResponse(sleep, mood, metric);
    }

    private static int nz(Integer v) {
        return v != null ? v : 0;
    }
}
