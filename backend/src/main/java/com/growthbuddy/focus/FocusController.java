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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/focus")
class FocusController {

    private final FocusService service;

    FocusController(FocusService service) {
        this.service = service;
    }

    @GetMapping("/stats")
    public FocusService.FocusStats stats() {
        return service.stats(CurrentUser.id());
    }

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
