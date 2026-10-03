package com.growthbuddy.score;

import com.growthbuddy.common.CurrentUser;
import java.time.LocalDate;
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

    /** Live score computed from current tasks and habits. */
    /** A finished day's score and its parts, so Insights can say why it moved. */
    @GetMapping("/day")
    public ScoreService.ScoreResponse day(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return service.on(CurrentUser.id(), date);
    }

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
