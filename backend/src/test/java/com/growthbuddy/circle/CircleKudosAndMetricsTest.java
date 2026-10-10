package com.growthbuddy.circle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * Post kudos (one per member per post, toggled), who may delete a post, and
 * what a challenge counts: habit check-ins, focus minutes on each member's own
 * local day, or days the water goal was reached. Plus future start dates.
 */
class CircleKudosAndMetricsTest {

    private static final UUID OWNER = UUID.randomUUID();
    private static final UUID MEMBER = UUID.randomUUID();
    private static final UUID OTHER = UUID.randomUUID();
    private static final UUID STRANGER = UUID.randomUUID();
    private static final UUID CIRCLE = UUID.randomUUID();
    private static final UUID POST = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 10);

    private final CircleRepository circles = mock(CircleRepository.class);
    private final CircleMemberRepository members = mock(CircleMemberRepository.class);
    private final CirclePostRepository posts = mock(CirclePostRepository.class);
    private final CircleChallengeRepository challenges = mock(CircleChallengeRepository.class);
    private final CirclePostReactionRepository reactions = mock(CirclePostReactionRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final HabitService habits = mock(HabitService.class);
    private final ChallengeMetrics metrics = mock(ChallengeMetrics.class);
    private final UserClock clock = mock(UserClock.class);
    private final CircleService service =
            new CircleService(circles, members, posts, challenges, reactions, users, habits, metrics, clock);

    private CirclePost setUp(UUID author) {
        Circle c = new Circle();
        c.setId(CIRCLE);
        c.setName("Runners");
        c.setCreatedBy(OWNER);
        c.setVisibility("public");
        when(circles.findById(CIRCLE)).thenReturn(Optional.of(c));
        for (UUID u : List.of(OWNER, MEMBER, OTHER)) {
            when(members.existsByCircleIdAndUserId(CIRCLE, u)).thenReturn(true);
        }
        CirclePost p = new CirclePost();
        p.setId(POST);
        p.setCircleId(CIRCLE);
        p.setUserId(author);
        p.setBody("Ran 5k");
        when(posts.findById(POST)).thenReturn(Optional.of(p));
        return p;
    }

    private static void assertStatus(Runnable call, HttpStatus status) {
        assertThatThrownBy(call::run).isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(status);
    }

    /* ---- Kudos ---- */

    @Test
    void kudosIsOnePerMemberAndTheSecondTapTakesItBack() {
        setUp(MEMBER);
        // A tiny in-memory stand-in for the (post, user) primary key.
        List<CirclePostReaction.Key> rows = new ArrayList<>();
        when(reactions.existsByPostIdAndUserId(eq(POST), any())).thenAnswer(inv ->
                rows.contains(new CirclePostReaction.Key(POST, inv.getArgument(1))));
        when(reactions.save(any())).thenAnswer(inv -> {
            CirclePostReaction r = inv.getArgument(0);
            rows.add(new CirclePostReaction.Key(r.getPostId(), r.getUserId()));
            return r;
        });
        org.mockito.Mockito.doAnswer(inv -> rows.remove((CirclePostReaction.Key) inv.getArgument(0)))
                .when(reactions).deleteById(any());
        when(reactions.countByPostId(POST)).thenAnswer(inv -> (long) rows.size());

        KudosResponse first = service.toggleKudos(OTHER, CIRCLE, POST);
        assertThat(first.reacted()).isTrue();
        assertThat(first.kudos()).isEqualTo(1);

        KudosResponse again = service.toggleKudos(OTHER, CIRCLE, POST);
        assertThat(again.reacted()).isFalse();
        assertThat(again.kudos()).isZero();
        verify(reactions, times(1)).save(any());

        // Two different members: two kudos.
        service.toggleKudos(OTHER, CIRCLE, POST);
        assertThat(service.toggleKudos(OWNER, CIRCLE, POST).kudos()).isEqualTo(2);
    }

    @Test
    void kudosNeedsMembershipAndAPostOfThatCircle() {
        CirclePost p = setUp(MEMBER);
        assertStatus(() -> service.toggleKudos(STRANGER, CIRCLE, POST), HttpStatus.FORBIDDEN);
        p.setCircleId(UUID.randomUUID());
        assertStatus(() -> service.toggleKudos(OTHER, CIRCLE, POST), HttpStatus.NOT_FOUND);
        verify(reactions, never()).save(any());
    }

    @Test
    void theFeedCarriesCountsAndWhetherYouReacted() {
        CirclePost p = setUp(MEMBER);
        p.setCreatedAt(Instant.parse("2026-10-10T08:00:00Z"));
        when(posts.findByCircleIdOrderByCreatedAtDesc(eq(CIRCLE), any())).thenReturn(List.of(p));
        when(reactions.countByPostIds(List.of(POST))).thenReturn(List.<Object[]>of(new Object[] {POST, 3L}));
        when(reactions.reactedAmong(OTHER, List.of(POST))).thenReturn(List.of(POST));
        PostResponse r = service.posts(OTHER, CIRCLE, null).get(0);
        assertThat(r.kudos()).isEqualTo(3);
        assertThat(r.reacted()).isTrue();
    }

    /* ---- Deleting a post ---- */

    @Test
    void theAuthorDeletesTheirOwnPost() {
        CirclePost p = setUp(MEMBER);
        service.deletePost(MEMBER, CIRCLE, POST);
        verify(reactions).deleteAllByPost(POST);
        verify(posts).delete(p);
    }

    @Test
    void theOwnerDeletesAnyPost() {
        CirclePost p = setUp(MEMBER);
        service.deletePost(OWNER, CIRCLE, POST);
        verify(posts).delete(p);
    }

    @Test
    void anotherMemberCannotDeleteSomeoneElsesPost() {
        setUp(MEMBER);
        assertStatus(() -> service.deletePost(OTHER, CIRCLE, POST), HttpStatus.FORBIDDEN);
        assertStatus(() -> service.deletePost(STRANGER, CIRCLE, POST), HttpStatus.FORBIDDEN);
        verify(posts, never()).delete(any());
    }

    @Test
    void deletingTheCircleTakesKudosToo() {
        setUp(MEMBER);
        service.delete(OWNER, CIRCLE);
        verify(reactions).deleteAllByCircle(CIRCLE);
    }

    /* ---- Challenge metrics + start dates ---- */

    private CircleChallenge challenge(String metric) {
        CircleChallenge ch = new CircleChallenge();
        ch.setId(UUID.randomUUID());
        ch.setCircleId(CIRCLE);
        ch.setTitle("Sprint");
        ch.setStartDate(TODAY.minusDays(2));
        ch.setEndDate(TODAY.plusDays(4));
        if (metric != null) {
            ch.setMetric(metric);
        }
        return ch;
    }

    private void roster() {
        when(clock.today(OWNER)).thenReturn(TODAY);
        CircleMember a = new CircleMember();
        a.setCircleId(CIRCLE);
        a.setUserId(OWNER);
        CircleMember b = new CircleMember();
        b.setCircleId(CIRCLE);
        b.setUserId(MEMBER);
        when(members.findByCircleId(CIRCLE)).thenReturn(List.of(a, b));
        User o = new User();
        o.setId(OWNER);
        o.setDisplayName("Owner");
        o.setTimezone("Asia/Kolkata");
        User m = new User();
        m.setId(MEMBER);
        m.setDisplayName("Member");
        when(users.findAllById(any())).thenReturn(List.of(o, m));
    }

    @Test
    void aFocusChallengeRanksByFocusMinutesInEachMembersZone() {
        setUp(MEMBER);
        roster();
        when(challenges.findByCircleIdOrderByStartDateDesc(CIRCLE)).thenReturn(List.of(challenge("focus_minutes")));
        when(metrics.focusMinutes(anyList(), any(), eq(TODAY.minusDays(2)), eq(TODAY)))
                .thenReturn(Map.of(MEMBER, 90L, OWNER, 25L));
        ChallengeResponse r = service.listChallenges(OWNER, CIRCLE).get(0);
        assertThat(r.metric()).isEqualTo("focus_minutes");
        assertThat(r.leaderboard()).extracting(LeaderboardEntry::value).containsExactly(90L, 25L);
        verify(metrics).focusMinutes(anyList(),
                eq(Map.of(OWNER, ZoneId.of("Asia/Kolkata"), MEMBER, ZoneId.of("UTC"))), any(), any());
        verify(habits, never()).countDoneBetween(anyList(), any(), any());
    }

    @Test
    void aWaterChallengeRanksByGoalDays() {
        setUp(MEMBER);
        roster();
        when(challenges.findByCircleIdOrderByStartDateDesc(CIRCLE)).thenReturn(List.of(challenge("water_days")));
        when(metrics.waterGoalDays(anyList(), any(), any())).thenReturn(Map.of(OWNER, 3L));
        ChallengeResponse r = service.listChallenges(OWNER, CIRCLE).get(0);
        assertThat(r.metric()).isEqualTo("water_days");
        assertThat(r.leaderboard().get(0).name()).isEqualTo("Owner");
        assertThat(r.leaderboard().get(0).value()).isEqualTo(3L);
    }

    @Test
    void aChallengeFromBeforeTheColumnStillCountsHabitCheckins() {
        setUp(MEMBER);
        roster();
        CircleChallenge old = challenge(null);
        old.setMetric(null);
        when(challenges.findByCircleIdOrderByStartDateDesc(CIRCLE)).thenReturn(List.of(old));
        when(habits.countDoneBetween(anyList(), any(), any())).thenReturn(Map.of());
        assertThat(service.listChallenges(OWNER, CIRCLE).get(0).metric()).isEqualTo("habit_checkins");
        verify(habits).countDoneBetween(anyList(), any(), any());
    }

    @Test
    void aChallengeCanStartLaterAndShowsAnEmptyBoardUntilThen() {
        setUp(MEMBER);
        when(clock.today(MEMBER)).thenReturn(TODAY);
        when(members.findByCircleId(CIRCLE)).thenReturn(List.of());
        when(challenges.save(any())).thenAnswer(inv -> inv.getArgument(0));
        ChallengeResponse r = service.createChallenge(MEMBER, CIRCLE,
                new CreateChallengeRequest("Next week", 7, "focus_minutes", TODAY.plusDays(3)));
        assertThat(r.startDate()).isEqualTo(TODAY.plusDays(3));
        assertThat(r.endDate()).isEqualTo(TODAY.plusDays(9));
        assertThat(r.active()).isFalse();
        assertThat(r.metric()).isEqualTo("focus_minutes");
        verify(metrics, never()).focusMinutes(any(), any(), any(), any());
    }

    @Test
    void aChallengeCannotStartBeforeTheCreatorsToday() {
        setUp(MEMBER);
        when(clock.today(MEMBER)).thenReturn(TODAY);
        assertThatThrownBy(() -> service.createChallenge(MEMBER, CIRCLE,
                new CreateChallengeRequest("Late", 7, null, TODAY.minusDays(1))))
                .hasMessageContaining("past");
        assertThatThrownBy(() -> service.createChallenge(MEMBER, CIRCLE,
                new CreateChallengeRequest("Odd", 7, "pushups", null)))
                .hasMessageContaining("metric");
        verify(challenges, never()).save(any());
    }

    /* ---- The computations themselves ---- */

    @Test
    void focusMinutesBucketSessionsIntoTheMembersOwnDay() {
        ZoneId kolkata = ZoneId.of("Asia/Kolkata");
        LocalDate day = LocalDate.of(2026, 10, 10);
        List<Object[]> rows = List.of(
                // 19:00Z on the 9th = 00:30 on the 10th in Kolkata: inside.
                new Object[] {MEMBER, Instant.parse("2026-10-09T19:00:00Z"), 1500},
                // 18:00Z on the 10th = 23:30 on the 10th: inside.
                new Object[] {MEMBER, Instant.parse("2026-10-10T18:00:00Z"), 1530},
                // 19:00Z on the 10th = 00:30 on the 11th: outside.
                new Object[] {MEMBER, Instant.parse("2026-10-10T19:00:00Z"), 3000},
                // A UTC member at 19:00Z on the 10th: still the 10th for them.
                new Object[] {OTHER, Instant.parse("2026-10-10T19:00:00Z"), 600});
        Map<UUID, Long> out = ChallengeMetrics.sumFocusMinutes(rows, Map.of(MEMBER, kolkata), day, day);
        // 1500 + 1530 = 3030 s -> 50 min (floored after summing, not per session).
        assertThat(out).containsEntry(MEMBER, 50L).containsEntry(OTHER, 10L);
    }

    @Test
    void waterDaysCountOnlyDaysThatReachedTheGoal() {
        Map<LocalDate, Integer> totals = Map.of(
                TODAY, 2000, TODAY.minusDays(1), 1999, TODAY.minusDays(2), 2600);
        assertThat(ChallengeMetrics.goalDays(totals, 2000)).isEqualTo(2);
        // No usable goal: any water at all counts the day.
        assertThat(ChallengeMetrics.goalDays(Map.of(TODAY, 100, TODAY.minusDays(1), 0), 0)).isEqualTo(1);
    }

    @Test
    void metricParsingDefaultsAndRefuses() {
        assertThat(ChallengeMetrics.Metric.parse(null)).isEqualTo(ChallengeMetrics.Metric.habit_checkins);
        assertThat(ChallengeMetrics.Metric.parse(" Water_Days ")).isEqualTo(ChallengeMetrics.Metric.water_days);
        assertThatThrownBy(() -> ChallengeMetrics.Metric.parse("steps")).isInstanceOf(ApiException.class);
        assertThat(ChallengeMetrics.Metric.stored("garbage")).isEqualTo(ChallengeMetrics.Metric.habit_checkins);
    }
}
