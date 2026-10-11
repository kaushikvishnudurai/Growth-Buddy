package com.growthbuddy.score;

import com.growthbuddy.common.CurrentUser;
import com.growthbuddy.common.ApiException;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/score")
public class ScoreController {

    private final ScoreService service;

    public ScoreController(ScoreService service) {
        this.service = service;
    }

    /** A finished day's score and its parts, so Insights can say why it moved. */
    @GetMapping("/day")
    public ScoreService.ScoreResponse day(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return service.on(CurrentUser.id(), date);
    }

    /**
     * Finished days' scores, oldest first: {@code [{"date":"YYYY-MM-DD","score":0-100}]}.
     * Today excluded; days with nothing to score left out; at most
     * {@value ScoreService#RANGE_MAX_DAYS} days.
     */
    @GetMapping("/range")
    public List<ScoreService.DayScore> range(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        if (from.isAfter(to)) {
            throw ApiException.badRequest("from must be on or before to.");
        }
        if (ChronoUnit.DAYS.between(from, to) >= ScoreService.RANGE_MAX_DAYS) {
            throw ApiException.badRequest("A score range covers at most " + ScoreService.RANGE_MAX_DAYS + " days.");
        }
        return service.range(CurrentUser.id(), from, to);
    }

    /** Live score computed from current tasks and habits. */
    @GetMapping("/today")
    public ScoreService.ScoreResponse today() {
        return service.today(CurrentUser.id());
    }

    /** Persist today's score snapshot into history. */
    @PostMapping("/today/snapshot")
    public ScoreService.ScoreResponse snapshot() {
        return service.snapshotToday(CurrentUser.id());
    }
}
