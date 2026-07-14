package com.growthbuddy.circle;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface CircleRepository extends JpaRepository<Circle, UUID> {
}

interface CircleChallengeRepository extends JpaRepository<CircleChallenge, UUID> {
    List<CircleChallenge> findByCircleIdOrderByStartDateDesc(UUID circleId);
}

interface CircleMemberRepository extends JpaRepository<CircleMember, CircleMember.Key> {
    List<CircleMember> findByUserId(UUID userId);

    List<CircleMember> findByCircleId(UUID circleId);

    boolean existsByCircleIdAndUserId(UUID circleId, UUID userId);

    Optional<CircleMember> findByCircleIdAndUserId(UUID circleId, UUID userId);

    long countByCircleId(UUID circleId);
}

interface CirclePostRepository extends JpaRepository<CirclePost, UUID> {
    List<CirclePost> findByCircleIdOrderByCreatedAtDesc(UUID circleId);
}

/* ---- Payloads ---- */

record CreateCircleRequest(
        @NotBlank @Size(max = 120) String name,
        String goal) {
}

record CreatePostRequest(@NotBlank String body) {
}

record CircleResponse(
        UUID id, String name, String goal, UUID createdBy,
        Instant createdAt, long memberCount, boolean joined) {

    static CircleResponse of(Circle c, long memberCount, boolean joined) {
        return new CircleResponse(c.getId(), c.getName(), c.getGoal(), c.getCreatedBy(),
                c.getCreatedAt(), memberCount, joined);
    }
}

record PostResponse(UUID id, UUID circleId, UUID userId, String body, Instant createdAt) {
    static PostResponse from(CirclePost p) {
        return new PostResponse(p.getId(), p.getCircleId(), p.getUserId(), p.getBody(), p.getCreatedAt());
    }
}

/* ---- Challenges ---- */

record CreateChallengeRequest(
        @NotBlank @Size(max = 120) String title,
        @Min(1) @Max(90) Integer days) {
}

/** One member's standing in a challenge (ranked by habit check-ins completed). */
record LeaderboardEntry(UUID userId, String name, long value, int rank) {
}

record ChallengeResponse(
        UUID id, UUID circleId, String title,
        LocalDate startDate, LocalDate endDate, boolean active,
        List<LeaderboardEntry> leaderboard) {
}
