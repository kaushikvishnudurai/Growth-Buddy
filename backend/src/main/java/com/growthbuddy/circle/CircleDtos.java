package com.growthbuddy.circle;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface CircleRepository extends JpaRepository<Circle, UUID> {
    Optional<Circle> findByJoinCode(String joinCode);
}

interface CircleChallengeRepository extends JpaRepository<CircleChallenge, UUID> {
    List<CircleChallenge> findByCircleIdOrderByStartDateDesc(UUID circleId);

    /** Challenges still running on {@code day} (or later) — the cap counts these. */
    long countByCircleIdAndEndDateGreaterThanEqual(UUID circleId, LocalDate day);

    @Modifying
    @Query("delete from CircleChallenge c where c.circleId = :circleId")
    void deleteAllByCircle(@Param("circleId") UUID circleId);
}

interface CircleMemberRepository extends JpaRepository<CircleMember, CircleMember.Key> {
    List<CircleMember> findByUserId(UUID userId);

    List<CircleMember> findByCircleId(UUID circleId);

    List<CircleMember> findByCircleIdOrderByJoinedAtAsc(UUID circleId);

    boolean existsByCircleIdAndUserId(UUID circleId, UUID userId);

    Optional<CircleMember> findByCircleIdAndUserId(UUID circleId, UUID userId);

    long countByCircleId(UUID circleId);

    /** Member counts for many circles in one grouped query: rows of [circleId, count]. */
    @Query("select m.circleId, count(m) from CircleMember m where m.circleId in :ids group by m.circleId")
    List<Object[]> countByCircleIds(@Param("ids") Collection<UUID> ids);

    @Modifying
    @Query("delete from CircleMember m where m.circleId = :circleId")
    void deleteAllByCircle(@Param("circleId") UUID circleId);
}

interface CirclePostRepository extends JpaRepository<CirclePost, UUID> {
    List<CirclePost> findByCircleIdOrderByCreatedAtDesc(UUID circleId, Pageable page);

    List<CirclePost> findByCircleIdAndCreatedAtBeforeOrderByCreatedAtDesc(
            UUID circleId, Instant before, Pageable page);

    @Modifying
    @Query("delete from CirclePost p where p.circleId = :circleId")
    void deleteAllByCircle(@Param("circleId") UUID circleId);
}

interface CirclePostReactionRepository extends JpaRepository<CirclePostReaction, CirclePostReaction.Key> {
    boolean existsByPostIdAndUserId(UUID postId, UUID userId);

    long countByPostId(UUID postId);

    /** Kudos counts for a page of posts in one grouped query: rows of [postId, count]. */
    @Query("select r.postId, count(r) from CirclePostReaction r where r.postId in :ids group by r.postId")
    List<Object[]> countByPostIds(@Param("ids") Collection<UUID> ids);

    /** Which of these posts {@code userId} has already given kudos to. */
    @Query("select r.postId from CirclePostReaction r where r.userId = :userId and r.postId in :ids")
    List<UUID> reactedAmong(@Param("userId") UUID userId, @Param("ids") Collection<UUID> ids);

    @Modifying
    @Query("delete from CirclePostReaction r where r.postId = :postId")
    void deleteAllByPost(@Param("postId") UUID postId);

    @Modifying
    @Query("delete from CirclePostReaction r where r.postId in "
            + "(select p.id from CirclePost p where p.circleId = :circleId)")
    void deleteAllByCircle(@Param("circleId") UUID circleId);
}

/* ---- Payloads ---- */

record CreateCircleRequest(
        @NotBlank @Size(max = 120) String name,
        @Size(max = 500) String goal,
        /* "private" = unlisted, joined only with the code the response carries;
           anything else (or absent) = public. */
        @Size(max = 16) String visibility) {
}

record JoinByCodeRequest(@NotBlank @Size(max = 12) String code) {
}

record TransferRequest(@NotNull UUID userId) {
}

/** Posts are a feed, not documents — 2,000 characters is a long message. */
record CreatePostRequest(@NotBlank @Size(max = 2000) String body) {
}

/**
 * {@code joinCode} is filled only for a member of a private circle — it is how
 * they invite someone, and a non-member must never be able to read it.
 * {@code owner} is whether the CALLER owns the circle (drives the owner menu).
 */
record CircleResponse(
        UUID id, String name, String goal, UUID createdBy,
        Instant createdAt, long memberCount, boolean joined,
        String visibility, String joinCode, boolean owner) {

    static CircleResponse of(Circle c, long memberCount, boolean joined, UUID viewer) {
        boolean isPrivate = "private".equals(c.getVisibility());
        return new CircleResponse(c.getId(), c.getName(), c.getGoal(), c.getCreatedBy(),
                c.getCreatedAt(), memberCount, joined,
                isPrivate ? "private" : "public",
                isPrivate && joined ? c.getJoinCode() : null,
                viewer != null && viewer.equals(c.getCreatedBy()));
    }
}

record MemberResponse(UUID userId, String name, String role, Instant joinedAt) {
}

/** {@code kudos}: how many members gave one; {@code reacted}: whether the CALLER did. */
record PostResponse(UUID id, UUID circleId, UUID userId, String authorName, String body, Instant createdAt,
        long kudos, boolean reacted) {
    static PostResponse from(CirclePost p, String authorName, long kudos, boolean reacted) {
        return new PostResponse(p.getId(), p.getCircleId(), p.getUserId(), authorName,
                p.getBody(), p.getCreatedAt(), kudos, reacted);
    }
}

/** The answer to a kudos toggle: the post's new count and the caller's state. */
record KudosResponse(UUID postId, long kudos, boolean reacted) {
}

/* ---- Challenges ---- */

/**
 * {@code metric}: habit_checkins (default) | focus_minutes | water_days.
 * {@code startDate}: absent = the creator's today; may be later, never earlier.
 */
record CreateChallengeRequest(
        @NotBlank @Size(max = 120) String title,
        @Min(1) @Max(90) Integer days,
        @Size(max = 16) String metric,
        LocalDate startDate) {

    CreateChallengeRequest(String title, Integer days) {
        this(title, days, null, null);
    }
}

/** One member's standing in a challenge; {@code value} is in the challenge's metric's unit. */
record LeaderboardEntry(UUID userId, String name, long value, int rank) {
}

/**
 * {@code hiddenCount}: members left off the board because they switched off
 * progress sharing — the UI says so rather than showing a short roster.
 * {@code metric}: what {@code value} counts (see {@link ChallengeMetrics.Metric}).
 */
record ChallengeResponse(
        UUID id, UUID circleId, String title,
        LocalDate startDate, LocalDate endDate, boolean active,
        List<LeaderboardEntry> leaderboard, int hiddenCount, String metric) {
}
