package com.growthbuddy.circle;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CircleService {

    private final CircleRepository circles;
    private final CircleMemberRepository members;
    private final CirclePostRepository posts;
    private final CircleChallengeRepository challenges;
    private final UserRepository users;
    private final HabitService habits;

    public CircleService(CircleRepository circles, CircleMemberRepository members,
                         CirclePostRepository posts, CircleChallengeRepository challenges,
                         UserRepository users, HabitService habits) {
        this.circles = circles;
        this.members = members;
        this.posts = posts;
        this.challenges = challenges;
        this.users = users;
        this.habits = habits;
    }

    @Transactional(readOnly = true)
    public List<CircleResponse> listAll(UUID userId) {
        return circles.findAll().stream()
                .map(c -> CircleResponse.of(c, members.countByCircleId(c.getId()),
                        members.existsByCircleIdAndUserId(c.getId(), userId)))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<CircleResponse> listMine(UUID userId) {
        List<UUID> ids = members.findByUserId(userId).stream()
                .map(CircleMember::getCircleId).toList();
        if (ids.isEmpty()) {
            return List.of();
        }
        // One query for all my circles instead of findById per membership.
        return circles.findAllById(ids).stream()
                .map(c -> CircleResponse.of(c, members.countByCircleId(c.getId()), true))
                .toList();
    }

    @Transactional
    public CircleResponse create(UUID userId, CreateCircleRequest req) {
        Circle c = new Circle();
        c.setName(req.name().trim());
        c.setGoal(req.goal());
        c.setCreatedBy(userId);
        circles.save(c);

        // Creator becomes the owner member.
        CircleMember owner = new CircleMember();
        owner.setCircleId(c.getId());
        owner.setUserId(userId);
        owner.setRole(CircleMember.Role.owner);
        members.save(owner);

        return CircleResponse.of(c, 1, true);
    }

    @Transactional
    public CircleResponse join(UUID userId, UUID circleId) {
        Circle c = require(circleId);
        if (!members.existsByCircleIdAndUserId(circleId, userId)) {
            CircleMember m = new CircleMember();
            m.setCircleId(circleId);
            m.setUserId(userId);
            m.setRole(CircleMember.Role.member);
            members.save(m);
        }
        return CircleResponse.of(c, members.countByCircleId(circleId), true);
    }

    @Transactional
    public void leave(UUID userId, UUID circleId) {
        require(circleId);
        members.findByCircleIdAndUserId(circleId, userId).ifPresent(m -> {
            if (m.getRole() == CircleMember.Role.owner) {
                throw ApiException.badRequest("The owner cannot leave their own circle");
            }
            members.delete(m);
        });
    }

    @Transactional(readOnly = true)
    public List<PostResponse> posts(UUID userId, UUID circleId) {
        requireMember(userId, circleId);
        return posts.findByCircleIdOrderByCreatedAtDesc(circleId).stream()
                .map(PostResponse::from).toList();
    }

    @Transactional
    public PostResponse post(UUID userId, UUID circleId, CreatePostRequest req) {
        requireMember(userId, circleId);
        CirclePost p = new CirclePost();
        p.setCircleId(circleId);
        p.setUserId(userId);
        p.setBody(req.body().trim());
        return PostResponse.from(posts.save(p));
    }

    /* ---- Challenges + leaderboard ---- */

    @Transactional
    public ChallengeResponse createChallenge(UUID userId, UUID circleId, CreateChallengeRequest req) {
        requireMember(userId, circleId);
        int days = req.days() != null ? req.days() : 7;
        CircleChallenge ch = new CircleChallenge();
        ch.setCircleId(circleId);
        ch.setTitle(req.title().trim());
        ch.setStartDate(LocalDate.now());
        ch.setEndDate(LocalDate.now().plusDays(days - 1L));
        ch.setCreatedBy(userId);
        challenges.save(ch);
        return toChallengeResponse(ch);
    }

    @Transactional(readOnly = true)
    public List<ChallengeResponse> listChallenges(UUID userId, UUID circleId) {
        requireMember(userId, circleId);
        return challenges.findByCircleIdOrderByStartDateDesc(circleId).stream()
                .map(this::toChallengeResponse)
                .toList();
    }

    private ChallengeResponse toChallengeResponse(CircleChallenge ch) {
        LocalDate today = LocalDate.now();
        boolean active = !today.isBefore(ch.getStartDate()) && !today.isAfter(ch.getEndDate());
        // Count check-ins only up to today so an in-progress challenge is fair.
        LocalDate countTo = today.isBefore(ch.getEndDate()) ? today : ch.getEndDate();
        return new ChallengeResponse(ch.getId(), ch.getCircleId(), ch.getTitle(),
                ch.getStartDate(), ch.getEndDate(), active,
                leaderboard(ch.getCircleId(), ch.getStartDate(), countTo));
    }

    /** Rank circle members by habit check-ins completed in [start, end]. */
    private List<LeaderboardEntry> leaderboard(UUID circleId, LocalDate start, LocalDate end) {
        List<CircleMember> roster = members.findByCircleId(circleId);
        List<UUID> ids = roster.stream().map(CircleMember::getUserId).toList();

        Map<UUID, String> names = new HashMap<>();
        for (User u : users.findAllById(ids)) {
            names.put(u.getId(), u.getDisplayName());
        }

        // One grouped query for the whole roster instead of one per member.
        Map<UUID, Long> counts = end.isBefore(start) ? Map.of() : habits.countDoneBetween(ids, start, end);
        List<LeaderboardEntry> unranked = new ArrayList<>();
        for (UUID uid : ids) {
            long value = counts.getOrDefault(uid, 0L);
            unranked.add(new LeaderboardEntry(uid, names.getOrDefault(uid, "Member"), value, 0));
        }
        return rank(unranked);
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

    private Circle require(UUID circleId) {
        return circles.findById(circleId).orElseThrow(() -> ApiException.notFound("Circle"));
    }

    private void requireMember(UUID userId, UUID circleId) {
        require(circleId);
        if (!members.existsByCircleIdAndUserId(circleId, userId)) {
            throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN,
                    "You must join this circle first");
        }
    }
}
