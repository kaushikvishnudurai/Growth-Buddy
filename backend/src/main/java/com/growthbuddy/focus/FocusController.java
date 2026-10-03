package com.growthbuddy.focus;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/focus")
class FocusController {

    private final FocusService service;
    private final FocusSessionRepository repo;

    FocusController(FocusService service, FocusSessionRepository repo) {
        this.service = service;
        this.repo = repo;
    }

    @GetMapping("/stats")
    public FocusService.FocusStats stats() {
        return service.stats(CurrentUser.id());
    }

    /** Focus sessions finished in the last {@code days}: when and how long, for Insights. */
    @GetMapping("/sessions")
    public List<SessionView> sessions(@RequestParam(defaultValue = "30") int days) {
        Instant since = Instant.now().minus(java.time.Duration.ofDays(Math.max(1, Math.min(days, 90))));
        return repo.findByUserIdAndModeAndCompletedAtAfter(CurrentUser.id(), "focus", since).stream()
                .map(s -> new SessionView(s.getDurationSec(), s.getCompletedAt()))
                .toList();
    }

    record SessionView(int durationSec, Instant completedAt) {}

    /** Log a completed session; returns fresh stats. */
    @PostMapping("/sessions")
    public FocusService.FocusStats record(@jakarta.validation.Valid @RequestBody SessionRequest req) {
        return service.record(CurrentUser.id(), req.mode(), req.durationSec());
    }

    record SessionRequest(String mode, @NotNull @Min(1) @Max(21600) Integer durationSec) {}
}

interface FocusSessionRepository extends JpaRepository<FocusSession, UUID> {
    long countByUserId(UUID userId);

    List<FocusSession> findByUserIdAndModeAndCompletedAtAfter(UUID userId, String mode, Instant after);
}
