package com.growthbuddy.weekly;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Backend-backed weekly reviews so a user's reflections sync across devices. */
@RestController
@RequestMapping("/api/weekly-review")
class WeeklyReviewController {

    private final WeeklyReviewRepository repo;

    WeeklyReviewController(WeeklyReviewRepository repo) {
        this.repo = repo;
    }

    @GetMapping
    public List<ReviewDto> list() {
        return repo.findByUserIdOrderByWeekStartDesc(CurrentUser.id()).stream()
                .map(r -> new ReviewDto(r.getWeekStart(), r.getWins(), r.getFocus(), r.getSavedAt()))
                .toList();
    }

    @PutMapping
    @Transactional
    public ReviewDto save(@jakarta.validation.Valid @RequestBody SaveReviewRequest req) {
        UUID userId = CurrentUser.id();
        WeeklyReview r = repo.findByUserIdAndWeekStart(userId, req.weekStart()).orElseGet(WeeklyReview::new);
        r.setUserId(userId);
        r.setWeekStart(req.weekStart());
        r.setWins(req.wins());
        r.setFocus(req.focus());
        repo.save(r);
        return new ReviewDto(r.getWeekStart(), r.getWins(), r.getFocus(), r.getSavedAt());
    }

    record ReviewDto(LocalDate weekStart, String wins, String focus, Instant savedAt) {}

    record SaveReviewRequest(
            @NotNull LocalDate weekStart,
            @Size(max = 4000) String wins,
            @Size(max = 255) String focus) {}
}

interface WeeklyReviewRepository extends JpaRepository<WeeklyReview, UUID> {
    List<WeeklyReview> findByUserIdOrderByWeekStartDesc(UUID userId);

    java.util.Optional<WeeklyReview> findByUserIdAndWeekStart(UUID userId, LocalDate weekStart);
}
