package com.growthbuddy.circle;

import com.growthbuddy.circle.ChallengeMetrics.Metric;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.UserZone;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.mentorship.ProgressSharing;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CircleService {

    /** Newest posts per page. The feed used to return every post a circle ever had. */
    static final int POSTS_PAGE = 50;
    /** Running challenges per circle — beyond this the board is noise, and it bounds the leaderboard work. */
    static final int MAX_ACTIVE_CHALLENGES = 10;
    /** No 0/O/1/I: a code is read aloud and typed on a phone. */
    private static final String CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int CODE_LENGTH = 8;
    /** How far ahead a challenge may be scheduled. */
    static final int MAX_START_LEAD_DAYS = 60;

    private final CircleRepository circles;
    private final CircleMemberRepository members;
    private final CirclePostRepository posts;
    private final CircleChallengeRepository challenges;
    private final CirclePostReactionRepository reactions;
    private final UserRepository users;
    private final HabitService habits;
    private final ChallengeMetrics metrics;
    private final UserClock clock;
    private final SecureRandom rng = new SecureRandom();

    public CircleService(CircleRepository circles, CircleMemberRepository members,
                         CirclePostRepository posts, CircleChallengeRepository challenges,
                         CirclePostReactionRepository reactions,
                         UserRepository users, HabitService habits, ChallengeMetrics metrics,
                         UserClock clock) {
        this.circles = circles;
        this.members = members;
        this.posts = posts;
        this.challenges = challenges;
        this.reactions = reactions;
        this.users = users;
        this.habits = habits;
        this.metrics = metrics;
        this.clock = clock;
    }

    /**
     * Browse: every PUBLIC circle, plus private ones the caller is already in.
     * A private circle is unlisted — the only way in is its code.
     */
    @Transactional(readOnly = true)
    public List<CircleResponse> listAll(UUID userId) {
        Set<UUID> mine = new HashSet<>();
        members.findByUserId(userId).forEach(m -> mine.add(m.getCircleId()));
        List<Circle> visible = circles.findAll().stream()
                .filter(c -> !isPrivate(c) || mine.contains(c.getId()))
                .toList();
        Map<UUID, Long> counts = counts(visible.stream().map(Circle::getId).toList());
        return visible.stream()
                .map(c -> CircleResponse.of(c, counts.getOrDefault(c.getId(), 0L),
                        mine.contains(c.getId()), userId))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<CircleResponse> listMine(UUID userId) {
        List<UUID> ids = members.findByUserId(userId).stream()
                .map(CircleMember::getCircleId).toList();
        if (ids.isEmpty()) {
            return List.of();
        }
        Map<UUID, Long> counts = counts(ids);
        return circles.findAllById(ids).stream()
                .map(c -> CircleResponse.of(c, counts.getOrDefault(c.getId(), 0L), true, userId))
                .toList();
    }

    /** One grouped query instead of a count per circle. */
    private Map<UUID, Long> counts(Collection<UUID> ids) {
        Map<UUID, Long> out = new HashMap<>();
        if (ids.isEmpty()) {
            return out;
        }
        for (Object[] row : members.countByCircleIds(ids)) {
            out.put((UUID) row[0], ((Number) row[1]).longValue());
        }
        return out;
    }

    @Transactional
    public CircleResponse create(UUID userId, CreateCircleRequest req) {
        Circle c = new Circle();
        c.setName(req.name().trim());
        c.setGoal(req.goal());
        c.setCreatedBy(userId);
        if ("private".equalsIgnoreCase(req.visibility())) {
            c.setVisibility("private");
            c.setJoinCode(freshCode());
        } else {
            c.setVisibility("public");
        }
        circles.save(c);

        // Creator becomes the owner member.
        CircleMember owner = new CircleMember();
        owner.setCircleId(c.getId());
        owner.setUserId(userId);
        owner.setRole(CircleMember.Role.owner);
        members.save(owner);

        return CircleResponse.of(c, 1, true, userId);
    }

    private String freshCode() {
        for (int attempt = 0; attempt < 10; attempt++) {
            StringBuilder sb = new StringBuilder(CODE_LENGTH);
            for (int i = 0; i < CODE_LENGTH; i++) {
                sb.append(CODE_ALPHABET.charAt(rng.nextInt(CODE_ALPHABET.length())));
            }
            String code = sb.toString();
            if (circles.findByJoinCode(code).isEmpty()) {
                return code;
            }
        }
        throw new IllegalStateException("Could not mint a unique circle code");
    }

    @Transactional
    public CircleResponse join(UUID userId, UUID circleId) {
        Circle c = require(circleId);
        if (isPrivate(c) && !members.existsByCircleIdAndUserId(circleId, userId)) {
            throw ApiException.forbidden("This circle is invite-only. Ask a member for its code.");
        }
        return addMember(c, userId);
    }

    @Transactional
    public CircleResponse joinByCode(UUID userId, String code) {
        String normalized = code == null ? "" : code.trim().toUpperCase(Locale.ROOT);
        Circle c = circles.findByJoinCode(normalized)
                .filter(CircleService::isPrivate)
                .orElseThrow(() -> ApiException.badRequest("No circle has that code. Check it and try again."));
        return addMember(c, userId);
    }

    private CircleResponse addMember(Circle c, UUID userId) {
        if (!members.existsByCircleIdAndUserId(c.getId(), userId)) {
            CircleMember m = new CircleMember();
            m.setCircleId(c.getId());
            m.setUserId(userId);
            m.setRole(CircleMember.Role.member);
            members.save(m);
        }
        return CircleResponse.of(c, members.countByCircleId(c.getId()), true, userId);
    }

    @Transactional
    public void leave(UUID userId, UUID circleId) {
        require(circleId);
        members.findByCircleIdAndUserId(circleId, userId).ifPresent(m -> {
            if (m.getRole() == CircleMember.Role.owner) {
                throw ApiException.badRequest(members.countByCircleId(circleId) > 1
                        ? "Hand the circle to another member before you leave, or delete it."
                        : "You're the only member. Delete the circle instead.");
            }
            members.delete(m);
        });
    }

    /* ---- Owner tools ---- */

    @Transactional(readOnly = true)
    public List<MemberResponse> members(UUID userId, UUID circleId) {
        requireMember(userId, circleId);
        List<CircleMember> roster = members.findByCircleIdOrderByJoinedAtAsc(circleId);
        Map<UUID, String> names = new HashMap<>();
        Set<UUID> leaving = new HashSet<>();
        if (!roster.isEmpty()) {
            for (User u : users.findAllById(roster.stream().map(CircleMember::getUserId).toList())) {
                names.put(u.getId(), u.getDisplayName());
                // Scheduled for deletion: gone from the roster for everyone else.
                if (u.isPendingDeletion()) {
                    leaving.add(u.getId());
                }
            }
        }
        return roster.stream()
                .filter(m -> !leaving.contains(m.getUserId()))
                .map(m -> new MemberResponse(m.getUserId(), names.getOrDefault(m.getUserId(), "Member"),
                        m.getRole().name(), m.getJoinedAt()))
                .toList();
    }

    /**
     * A private circle gets a new code: the removed member knows the old one, and
     * {@link #joinByCode} would let them straight back in. Answers the circle so
     * the owner's open menu shows the new code.
     */
    @Transactional
    public CircleResponse removeMember(UUID userId, UUID circleId, UUID targetId) {
        Circle c = requireOwner(userId, circleId);
        if (userId.equals(targetId)) {
            throw ApiException.badRequest("You can't remove yourself. Hand the circle on or delete it.");
        }
        CircleMember m = members.findByCircleIdAndUserId(circleId, targetId)
                .orElseThrow(() -> ApiException.notFound("that member"));
        members.delete(m);
        if (isPrivate(c)) {
            c.setJoinCode(freshCode());
            circles.save(c);
        }
        return CircleResponse.of(c, members.countByCircleId(circleId), true, userId);
    }

    @Transactional
    public CircleResponse transfer(UUID userId, UUID circleId, UUID targetId) {
        Circle c = requireOwner(userId, circleId);
        if (userId.equals(targetId)) {
            throw ApiException.badRequest("You already own this circle.");
        }
        CircleMember heir = members.findByCircleIdAndUserId(circleId, targetId)
                .orElseThrow(() -> ApiException.notFound("that member"));
        members.findByCircleIdAndUserId(circleId, userId).ifPresent(me -> {
            me.setRole(CircleMember.Role.member);
            members.save(me);
        });
        heir.setRole(CircleMember.Role.owner);
        members.save(heir);
        c.setCreatedBy(targetId);
        circles.save(c);
        return CircleResponse.of(c, members.countByCircleId(circleId), true, userId);
    }

    @Transactional
    public void delete(UUID userId, UUID circleId) {
        Circle c = requireOwner(userId, circleId);
        reactions.deleteAllByCircle(circleId);
        posts.deleteAllByCircle(circleId);
        challenges.deleteAllByCircle(circleId);
        members.deleteAllByCircle(circleId);
        circles.delete(c);
    }

    /* ---- Posts ---- */

    /** The newest {@link #POSTS_PAGE} posts, or the page before {@code before} for "Load older". */
    @Transactional(readOnly = true)
    public List<PostResponse> posts(UUID userId, UUID circleId, Instant before) {
        requireMember(userId, circleId);
        PageRequest page = PageRequest.of(0, POSTS_PAGE);
        List<CirclePost> list = before == null
                ? posts.findByCircleIdOrderByCreatedAtDesc(circleId, page)
                : posts.findByCircleIdAndCreatedAtBeforeOrderByCreatedAtDesc(circleId, before, page);
        Map<UUID, String> names = names(list.stream().map(CirclePost::getUserId).distinct().toList());
        // Two grouped queries for the whole page, not a count per post.
        List<UUID> ids = list.stream().map(CirclePost::getId).toList();
        Map<UUID, Long> kudos = new HashMap<>();
        Set<UUID> mine = new HashSet<>();
        if (!ids.isEmpty()) {
            for (Object[] row : reactions.countByPostIds(ids)) {
                kudos.put((UUID) row[0], ((Number) row[1]).longValue());
            }
            mine.addAll(reactions.reactedAmong(userId, ids));
        }
        return list.stream()
                .map(p -> PostResponse.from(p, names.getOrDefault(p.getUserId(), "Member"),
                        kudos.getOrDefault(p.getId(), 0L), mine.contains(p.getId())))
                .toList();
    }

    @Transactional
    public PostResponse post(UUID userId, UUID circleId, CreatePostRequest req) {
        requireMember(userId, circleId);
        CirclePost p = new CirclePost();
        p.setCircleId(circleId);
        p.setUserId(userId);
        p.setBody(req.body().trim());
        String name = users.findById(userId).map(User::getDisplayName).orElse("Member");
        return PostResponse.from(posts.save(p), name, 0, false);
    }

    /**
     * Kudos on or off. One per member per post: the row's key is (post, user),
     * so the second tap removes it rather than adding another.
     *
     * <p>ponytail: two simultaneous first taps from one person race to the same
     * key and the loser 500s; harmless (the row exists either way), and the
     * button is disabled while its request is in flight.
     */
    @Transactional
    public KudosResponse toggleKudos(UUID userId, UUID circleId, UUID postId) {
        requireMember(userId, circleId);
        requirePost(circleId, postId);
        boolean reacted;
        if (reactions.existsByPostIdAndUserId(postId, userId)) {
            reactions.deleteById(new CirclePostReaction.Key(postId, userId));
            reacted = false;
        } else {
            CirclePostReaction r = new CirclePostReaction();
            r.setPostId(postId);
            r.setUserId(userId);
            reactions.save(r);
            reacted = true;
        }
        return new KudosResponse(postId, reactions.countByPostId(postId), reacted);
    }

    /**
     * The author can take back their own post; the owner can take down anyone's.
     * Membership isn't asked of the author — someone who left can still remove
     * what they wrote.
     */
    @Transactional
    public void deletePost(UUID userId, UUID circleId, UUID postId) {
        Circle c = require(circleId);
        CirclePost p = requirePost(circleId, postId);
        if (!userId.equals(p.getUserId()) && !userId.equals(c.getCreatedBy())) {
            throw ApiException.forbidden("Only the author or the circle's owner can delete a post.");
        }
        reactions.deleteAllByPost(postId);
        posts.delete(p);
    }

    /** A post of THIS circle — a post id from another circle is not found here. */
    private CirclePost requirePost(UUID circleId, UUID postId) {
        return posts.findById(postId)
                .filter(p -> circleId.equals(p.getCircleId()))
                .orElseThrow(() -> ApiException.notFound("Post"));
    }

    /* ---- Challenges + leaderboard ---- */

    @Transactional
    public ChallengeResponse createChallenge(UUID userId, UUID circleId, CreateChallengeRequest req) {
        requireMember(userId, circleId);
        // The creator's day, not the server's: a challenge started at 8am in
        // India used to begin "yesterday" for anyone west of UTC+0 at midnight,
        // or on tomorrow's date for someone ahead of the server.
        LocalDate today = clock.today(userId);
        if (challenges.countByCircleIdAndEndDateGreaterThanEqual(circleId, today) >= MAX_ACTIVE_CHALLENGES) {
            throw ApiException.badRequest("This circle already has " + MAX_ACTIVE_CHALLENGES
                    + " challenges running. Let one finish first.");
        }
        Metric metric = Metric.parse(req.metric());
        // A future start is fine (an "upcoming" challenge, empty board until
        // then); a past one would back-date everyone's numbers.
        LocalDate start = req.startDate() != null ? req.startDate() : today;
        if (start.isBefore(today)) {
            throw ApiException.badRequest("A challenge can't start in the past.");
        }
        if (start.isAfter(today.plusDays(MAX_START_LEAD_DAYS))) {
            throw ApiException.badRequest("Start it within the next " + MAX_START_LEAD_DAYS + " days.");
        }
        int days = req.days() != null ? req.days() : 7;
        CircleChallenge ch = new CircleChallenge();
        ch.setCircleId(circleId);
        ch.setTitle(req.title().trim());
        ch.setMetric(metric.name());
        ch.setStartDate(start);
        ch.setEndDate(start.plusDays(days - 1L));
        ch.setCreatedBy(userId);
        challenges.save(ch);
        return toChallengeResponse(ch, userId, today);
    }

    @Transactional(readOnly = true)
    public List<ChallengeResponse> listChallenges(UUID userId, UUID circleId) {
        requireMember(userId, circleId);
        LocalDate today = clock.today(userId);
        return challenges.findByCircleIdOrderByStartDateDesc(circleId).stream()
                .map(ch -> toChallengeResponse(ch, userId, today))
                .toList();
    }

    private ChallengeResponse toChallengeResponse(CircleChallenge ch, UUID viewer, LocalDate today) {
        boolean active = !today.isBefore(ch.getStartDate()) && !today.isAfter(ch.getEndDate());
        // Count check-ins only up to today so an in-progress challenge is fair.
        LocalDate countTo = today.isBefore(ch.getEndDate()) ? today : ch.getEndDate();
        List<CircleMember> roster = members.findByCircleId(ch.getCircleId());
        Map<UUID, User> byId = new HashMap<>();
        users.findAllById(roster.stream().map(CircleMember::getUserId).toList())
                .forEach(u -> byId.put(u.getId(), u));
        // Scheduled for deletion: off the board entirely, not even in the
        // "N not sharing" count — to everyone else the account is already gone.
        List<UUID> ids = roster.stream().map(CircleMember::getUserId)
                .filter(id -> byId.get(id) == null || !byId.get(id).isPendingDeletion())
                .toList();

        // Progress sharing off (Settings → Privacy) means off here too: the
        // board used to rank everyone by their check-in count regardless. You
        // always see yourself — it's your own number.
        List<UUID> shown = new ArrayList<>();
        for (UUID id : ids) {
            if (id.equals(viewer) || ProgressSharing.sharesProgress(byId.get(id))) {
                shown.add(id);
            }
        }
        Metric metric = Metric.stored(ch.getMetric());
        Map<UUID, Long> counts = countTo.isBefore(ch.getStartDate()) || shown.isEmpty()
                ? Map.of()
                : measure(metric, shown, byId, ch.getStartDate(), countTo);
        List<LeaderboardEntry> unranked = new ArrayList<>();
        for (UUID uid : shown) {
            User u = byId.get(uid);
            unranked.add(new LeaderboardEntry(uid, u != null ? u.getDisplayName() : "Member",
                    counts.getOrDefault(uid, 0L), 0));
        }
        return new ChallengeResponse(ch.getId(), ch.getCircleId(), ch.getTitle(),
                ch.getStartDate(), ch.getEndDate(), active, rank(unranked), ids.size() - shown.size(),
                metric.name());
    }

    /** Each member's number for {@code metric} over [from, to]. */
    private Map<UUID, Long> measure(Metric metric, List<UUID> ids, Map<UUID, User> byId,
                                    LocalDate from, LocalDate to) {
        return switch (metric) {
            case habit_checkins -> habits.countDoneBetween(ids, from, to);
            case focus_minutes -> {
                Map<UUID, ZoneId> zones = new HashMap<>();
                for (UUID id : ids) {
                    User u = byId.get(id);
                    zones.put(id, u == null ? UserZone.FALLBACK : UserZone.of(u.getTimezone()));
                }
                yield metrics.focusMinutes(ids, zones, from, to);
            }
            case water_days -> metrics.waterGoalDays(ids, from, to);
        };
    }

    /** Sort by value desc and assign standard competition ranks (ties share a rank). */
    static List<LeaderboardEntry> rank(List<LeaderboardEntry> entries) {
        List<LeaderboardEntry> sorted = new ArrayList<>(entries);
        sorted.sort(Comparator.comparingLong(LeaderboardEntry::value).reversed());
        List<LeaderboardEntry> out = new ArrayList<>();
        for (int i = 0; i < sorted.size(); i++) {
            LeaderboardEntry e = sorted.get(i);
            int r = i > 0 && sorted.get(i - 1).value() == e.value() ? out.get(i - 1).rank() : i + 1;
            out.add(new LeaderboardEntry(e.userId(), e.name(), e.value(), r));
        }
        return out;
    }

    private Map<UUID, String> names(List<UUID> ids) {
        Map<UUID, String> out = new HashMap<>();
        if (!ids.isEmpty()) {
            users.findAllById(ids).forEach(u -> out.put(u.getId(), u.getDisplayName()));
        }
        return out;
    }

    private static boolean isPrivate(Circle c) {
        return "private".equals(c.getVisibility());
    }

    private Circle require(UUID circleId) {
        return circles.findById(circleId).orElseThrow(() -> ApiException.notFound("Circle"));
    }

    private void requireMember(UUID userId, UUID circleId) {
        require(circleId);
        if (!members.existsByCircleIdAndUserId(circleId, userId)) {
            throw ApiException.forbidden("You must join this circle first");
        }
    }

    private Circle requireOwner(UUID userId, UUID circleId) {
        Circle c = require(circleId);
        if (!userId.equals(c.getCreatedBy())) {
            throw ApiException.forbidden("Only the circle's owner can do that.");
        }
        return c;
    }
}
