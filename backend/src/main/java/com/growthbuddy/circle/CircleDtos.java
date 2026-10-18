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
    List<CircleChallenge> findTop20ByCircleIdOrderByStartDateDesc(UUID circleId);
    List<CircleChallenge> findByCircleIdAndEndDateGreaterThanEqual(UUID circleId, java.time.LocalDate today);

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

interface CircleRemovalRepository extends JpaRepository<CircleRemoval, CircleMember.Key> {
    List<CircleRemoval> findByUserId(UUID userId);

    boolean existsByCircleIdAndUserId(UUID circleId, UUID userId);

    @Modifying
    @Query("delete from CircleRemoval r where r.circleId = :circleId")
    void deleteAllByCircle(@Param("circleId") UUID circleId);
}

interface CirclePostRepository extends JpaRepository<CirclePost, UUID> {
    /** Id breaks createdAt ties so the page's last post is a stable cursor. */
    List<CirclePost> findByCircleIdOrderByCreatedAtDescIdDesc(UUID circleId, Pageable page);

    /** Old clients send no id: strictly-before by time alone. */
    List<CirclePost> findByCircleIdAndCreatedAtBeforeOrderByCreatedAtDescIdDesc(
            UUID circleId, Instant before, Pageable page);

    /** "Load older" after (before, beforeId): created_at is whole seconds, so same-second posts are common. */
    @Query("select p from CirclePost p where p.circleId = :circleId and (p.createdAt < :before"
            + " or (p.createdAt = :before and p.id < :beforeId)) order by p.createdAt desc, p.id desc")
    List<CirclePost> findOlder(@Param("circleId") UUID circleId, @Param("before") Instant before,
                               @Param("beforeId") UUID beforeId, Pageable page);

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

interface CirclePostCommentRepository extends JpaRepository<CirclePostComment, UUID> {
    List<CirclePostComment> findByPostIdOrderByCreatedAtAsc(UUID postId, Pageable page);

    long countByPostId(UUID postId);

    /** Reply counts for a page of posts in one grouped query: rows of [postId, count]. */
    @Query("select c.postId, count(c) from CirclePostComment c where c.postId in :ids group by c.postId")
    List<Object[]> countByPostIds(@Param("ids") Collection<UUID> ids);

    @Modifying
    @Query("delete from CirclePostComment c where c.postId = :postId")
    void deleteAllByPost(@Param("postId") UUID postId);

    @Modifying
    @Query("delete from CirclePostComment c where c.postId in "
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

/**
 * {@code doneToday}: habit check-ins on the member's own today (their zone), what
 * lights their seat on the Circle screen; null when they keep progress private
 * (Settings, Privacy). You always get your own. {@code cheeredByMe}: the caller
 * has used today's one cheer for this member, so the seat doesn't offer another.
 */
record MemberResponse(UUID userId, String name, String role, Instant joinedAt, Long doneToday,
                      boolean cheeredByMe) {
    MemberResponse(UUID userId, String name, String role, Instant joinedAt) {
        this(userId, name, role, joinedAt, null, false);
    }
}

/**
 * {@code kudos}: how many members gave one; {@code reacted}: whether the CALLER did;
 * {@code comments}: how many replies it has.
 */
record PostResponse(UUID id, UUID circleId, UUID userId, String authorName, String body, Instant createdAt,
        long kudos, boolean reacted, long comments) {
    static PostResponse from(CirclePost p, String authorName, long kudos, boolean reacted, long comments) {
        return new PostResponse(p.getId(), p.getCircleId(), p.getUserId(), authorName,
                p.getBody(), p.getCreatedAt(), kudos, reacted, comments);
    }
}

/** Replies are a line or two, not a second post. */
record CreateCommentRequest(@NotBlank @Size(max = 500) String body) {
}

record CommentResponse(UUID id, UUID postId, UUID userId, String authorName, String body, Instant createdAt) {
    static CommentResponse from(CirclePostComment c, String authorName) {
        return new CommentResponse(c.getId(), c.getPostId(), c.getUserId(), authorName, c.getBody(),
                c.getCreatedAt());
    }
}

/** A cheer for a circle member: an optional short line, like a mentorship cheer. */
record CheerRequest(@Size(max = 140) String text) {
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
