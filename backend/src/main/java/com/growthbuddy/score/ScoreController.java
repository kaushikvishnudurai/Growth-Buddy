package com.growthbuddy.score;

import com.growthbuddy.common.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/score")
public class ScoreController {

    private final ScoreService service;

    public ScoreController(ScoreService service) {
        this.service = service;
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
