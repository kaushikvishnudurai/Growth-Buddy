package com.growthbuddy.wellness;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Sleep, mood, and daily metric snapshots — the backing store for the
 * frontend's wellness + trends data (previously localStorage-only). */
@RestController
@RequestMapping("/api/daily-logs")
public class WellnessController {

    private final WellnessService service;

    public WellnessController(WellnessService service) {
        this.service = service;
    }

    /** Last {@code days} days as { sleepByDate, moodByDate, byDate }. */
    @GetMapping
    public DailyLogsResponse range(@RequestParam(defaultValue = "60") int days) {
        return service.range(CurrentUser.id(), days);
    }

    @PostMapping("/sleep")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void sleep(@Valid @RequestBody SleepRequest req) {
        service.saveSleep(CurrentUser.id(), req);
    }

    @PostMapping("/mood")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void mood(@Valid @RequestBody MoodRequest req) {
        service.saveMood(CurrentUser.id(), req);
    }

    @PostMapping("/snapshot")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void snapshot(@Valid @RequestBody SnapshotRequest req) {
        service.snapshot(CurrentUser.id(), req);
    }
}
