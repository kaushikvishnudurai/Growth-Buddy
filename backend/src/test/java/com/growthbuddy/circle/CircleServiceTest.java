package com.growthbuddy.circle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * Circle membership is the trust boundary for posts and challenges; ownership
 * for delete / remove / transfer. Also: a private circle takes its code, the
 * leaderboard honours "share my progress", and challenge dates are the
 * creator's local day.
 */
class CircleServiceTest {

    private static final UUID OWNER = UUID.randomUUID();
    private static final UUID MEMBER = UUID.randomUUID();
    private static final UUID STRANGER = UUID.randomUUID();
    private static final UUID CIRCLE = UUID.randomUUID();

    private final CircleRepository circles = mock(CircleRepository.class);
    private final CircleMemberRepository members = mock(CircleMemberRepository.class);
    private final CirclePostRepository posts = mock(CirclePostRepository.class);
    private final CircleChallengeRepository challenges = mock(CircleChallengeRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final HabitService habits = mock(HabitService.class);
    private final UserClock clock = mock(UserClock.class);
    private final CirclePostReactionRepository reactions = mock(CirclePostReactionRepository.class);
    private final ChallengeMetrics metrics = mock(ChallengeMetrics.class);
    private final CircleService service =
            new CircleService(circles, members, posts, challenges, reactions, users, habits, metrics, clock);

    private Circle circle(String visibility) {
        Circle c = new Circle();
        c.setId(CIRCLE);
        c.setName("Runners");
        c.setCreatedBy(OWNER);
        c.setVisibility(visibility);
        c.setJoinCode("private".equals(visibility) ? "K7M2QX9P" : null);
        when(circles.findById(CIRCLE)).thenReturn(Optional.of(c));
        when(members.existsByCircleIdAndUserId(CIRCLE, OWNER)).thenReturn(true);
        when(members.existsByCircleIdAndUserId(CIRCLE, MEMBER)).thenReturn(true);
        when(members.findByCircleIdAndUserId(CIRCLE, OWNER)).thenReturn(Optional.of(member(OWNER, CircleMember.Role.owner)));
        when(members.findByCircleIdAndUserId(CIRCLE, MEMBER)).thenReturn(Optional.of(member(MEMBER, CircleMember.Role.member)));
        return c;
    }

    private static CircleMember member(UUID user, CircleMember.Role role) {
        CircleMember m = new CircleMember();
        m.setCircleId(CIRCLE);
        m.setUserId(user);
        m.setRole(role);
        return m;
    }

    private static void assertForbidden(Runnable call) {
        assertThatThrownBy(call::run).isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void nonMembersCannotReadOrWriteTheCircle() {
        circle("public");
        assertForbidden(() -> service.posts(STRANGER, CIRCLE, null));
        assertForbidden(() -> service.post(STRANGER, CIRCLE, new CreatePostRequest("hi")));
        assertForbidden(() -> service.listChallenges(STRANGER, CIRCLE));
        assertForbidden(() -> service.createChallenge(STRANGER, CIRCLE, new CreateChallengeRequest("x", 7)));
        assertForbidden(() -> service.members(STRANGER, CIRCLE));
    }

    @Test
    void theOwnerCannotLeaveTheirOwnCircle() {
        circle("public");
        when(members.countByCircleId(CIRCLE)).thenReturn(2L);
        assertThatThrownBy(() -> service.leave(OWNER, CIRCLE)).hasMessageContaining("Hand the circle");
        verify(members, never()).delete(any());
    }

    @Test
    void aMemberCanLeave() {
        circle("public");
        service.leave(MEMBER, CIRCLE);
        verify(members).delete(any(CircleMember.class));
    }

    @Test
    void onlyTheOwnerDeletesRemovesOrTransfers() {
        circle("public");
        assertForbidden(() -> service.delete(MEMBER, CIRCLE));
        assertForbidden(() -> service.removeMember(MEMBER, CIRCLE, OWNER));
        assertForbidden(() -> service.transfer(MEMBER, CIRCLE, MEMBER));
        verify(circles, never()).delete(any());
    }

    @Test
    void deletingTakesPostsChallengesAndMembersWithIt() {
        Circle c = circle("public");
        service.delete(OWNER, CIRCLE);
        verify(posts).deleteAllByCircle(CIRCLE);
        verify(challenges).deleteAllByCircle(CIRCLE);
        verify(members).deleteAllByCircle(CIRCLE);
        verify(circles).delete(c);
    }

    @Test
    void transferMovesOwnershipAndKeepsTheOldOwnerAsAMember() {
        Circle c = circle("public");
        CircleMember heir = member(MEMBER, CircleMember.Role.member);
        CircleMember me = member(OWNER, CircleMember.Role.owner);
        when(members.findByCircleIdAndUserId(CIRCLE, MEMBER)).thenReturn(Optional.of(heir));
        when(members.findByCircleIdAndUserId(CIRCLE, OWNER)).thenReturn(Optional.of(me));
        service.transfer(OWNER, CIRCLE, MEMBER);
        assertThat(c.getCreatedBy()).isEqualTo(MEMBER);
        assertThat(heir.getRole()).isEqualTo(CircleMember.Role.owner);
        assertThat(me.getRole()).isEqualTo(CircleMember.Role.member);
    }

    @Test
    void theOwnerCannotRemoveThemselves() {
        circle("public");
        assertThatThrownBy(() -> service.removeMember(OWNER, CIRCLE, OWNER)).isInstanceOf(ApiException.class);
    }

    @Test
    void removingAMemberRotatesAPrivateCode() {
        Circle c = circle("private");
        CircleResponse r = service.removeMember(OWNER, CIRCLE, MEMBER);
        // The removed member still knows the old code; it must no longer find the circle.
        assertThat(c.getJoinCode()).isNotEqualTo("K7M2QX9P").hasSize(8);
        assertThat(r.joinCode()).isEqualTo(c.getJoinCode());
        verify(circles).save(c);

        Circle open = circle("public");
        service.removeMember(OWNER, CIRCLE, MEMBER);
        assertThat(open.getJoinCode()).isNull();
    }

    @Test
    void aPrivateCircleNeedsItsCode() {
        circle("private");
        assertForbidden(() -> service.join(STRANGER, CIRCLE));
        verify(members, never()).save(any());
    }

    @Test
    void theCodeLetsYouIn() {
        Circle c = circle("private");
        when(circles.findByJoinCode("K7M2QX9P")).thenReturn(Optional.of(c));
        CircleResponse r = service.joinByCode(STRANGER, " k7m2qx9p ");
        assertThat(r.joined()).isTrue();
        verify(members).save(any(CircleMember.class));
    }

    @Test
    void aPrivateCodeIsOnlyShownToMembers() {
        Circle c = circle("private");
        assertThat(CircleResponse.of(c, 2, true, MEMBER).joinCode()).isEqualTo("K7M2QX9P");
        assertThat(CircleResponse.of(c, 2, false, STRANGER).joinCode()).isNull();
    }

    @Test
    void browseHidesPrivateCirclesYouAreNotIn() {
        Circle c = circle("private");
        when(circles.findAll()).thenReturn(List.of(c));
        when(members.findByUserId(STRANGER)).thenReturn(List.of());
        assertThat(service.listAll(STRANGER)).isEmpty();
    }

    @Test
    void theLeaderboardLeavesOutMembersWhoDoNotShareProgress() {
        circle("public");
        LocalDate today = LocalDate.of(2026, 10, 10);
        when(clock.today(OWNER)).thenReturn(today);
        UUID shy = UUID.randomUUID();
        when(members.findByCircleId(CIRCLE)).thenReturn(List.of(
                member(OWNER, CircleMember.Role.owner), member(MEMBER, CircleMember.Role.member),
                member(shy, CircleMember.Role.member)));
        User owner = named(OWNER, "Owner", null);
        User open = named(MEMBER, "Open", null);
        User closed = named(shy, "Shy", false);
        when(users.findAllById(any())).thenReturn(List.of(owner, open, closed));
        when(habits.countDoneBetween(any(List.class), any(), any())).thenReturn(Map.of(MEMBER, 3L, shy, 9L));
        CircleChallenge ch = new CircleChallenge();
        ch.setId(UUID.randomUUID());
        ch.setCircleId(CIRCLE);
        ch.setTitle("Sprint");
        ch.setStartDate(today.minusDays(2));
        ch.setEndDate(today.plusDays(4));
        when(challenges.findByCircleIdOrderByStartDateDesc(CIRCLE)).thenReturn(List.of(ch));

        ChallengeResponse r = service.listChallenges(OWNER, CIRCLE).get(0);
        assertThat(r.leaderboard()).extracting(LeaderboardEntry::name).containsExactly("Open", "Owner");
        assertThat(r.hiddenCount()).isEqualTo(1);
        verify(habits).countDoneBetween(eq(List.of(OWNER, MEMBER)), any(), any());
    }

    @Test
    void aChallengeStartsOnTheCreatorsLocalDay() {
        circle("public");
        LocalDate theirToday = LocalDate.of(2026, 10, 11);
        when(clock.today(MEMBER)).thenReturn(theirToday);
        when(members.findByCircleId(CIRCLE)).thenReturn(List.of());
        when(challenges.save(any())).thenAnswer(inv -> inv.getArgument(0));
        ChallengeResponse r = service.createChallenge(MEMBER, CIRCLE, new CreateChallengeRequest("Sprint", 7));
        assertThat(r.startDate()).isEqualTo(theirToday);
        assertThat(r.endDate()).isEqualTo(theirToday.plusDays(6));
        assertThat(r.active()).isTrue();
    }

    @Test
    void runningChallengesAreCapped() {
        circle("public");
        LocalDate today = LocalDate.of(2026, 10, 10);
        when(clock.today(MEMBER)).thenReturn(today);
        when(challenges.countByCircleIdAndEndDateGreaterThanEqual(CIRCLE, today))
                .thenReturn((long) CircleService.MAX_ACTIVE_CHALLENGES);
        assertThatThrownBy(() -> service.createChallenge(MEMBER, CIRCLE, new CreateChallengeRequest("x", 7)))
                .hasMessageContaining("running");
        verify(challenges, never()).save(any());
    }

    /** Scheduled for deletion = gone to everyone else: off the board and out of the hidden count. */
    @Test
    void theLeaderboardLeavesOutAnAccountScheduledForDeletion() {
        circle("public");
        LocalDate today = LocalDate.of(2026, 10, 10);
        when(clock.today(OWNER)).thenReturn(today);
        when(members.findByCircleId(CIRCLE)).thenReturn(List.of(
                member(OWNER, CircleMember.Role.owner), member(MEMBER, CircleMember.Role.member)));
        User leaving = named(MEMBER, "Leaving", null);
        leaving.setDeletionRequestedAt(java.time.Instant.now());
        when(users.findAllById(any())).thenReturn(List.of(named(OWNER, "Owner", null), leaving));
        when(habits.countDoneBetween(any(List.class), any(), any())).thenReturn(Map.of(MEMBER, 9L));
        CircleChallenge ch = new CircleChallenge();
        ch.setId(UUID.randomUUID());
        ch.setCircleId(CIRCLE);
        ch.setTitle("Sprint");
        ch.setStartDate(today.minusDays(2));
        ch.setEndDate(today.plusDays(4));
        when(challenges.findByCircleIdOrderByStartDateDesc(CIRCLE)).thenReturn(List.of(ch));

        ChallengeResponse r = service.listChallenges(OWNER, CIRCLE).get(0);
        assertThat(r.leaderboard()).extracting(LeaderboardEntry::name).containsExactly("Owner");
        assertThat(r.hiddenCount()).isZero();
        verify(habits).countDoneBetween(eq(List.of(OWNER)), any(), any());
    }

    @Test
    void theMemberListLeavesOutAnAccountScheduledForDeletion() {
        circle("public");
        when(members.findByCircleIdOrderByJoinedAtAsc(CIRCLE)).thenReturn(List.of(
                member(OWNER, CircleMember.Role.owner), member(MEMBER, CircleMember.Role.member)));
        User leaving = named(MEMBER, "Leaving", null);
        leaving.setDeletionRequestedAt(java.time.Instant.now());
        when(users.findAllById(any())).thenReturn(List.of(named(OWNER, "Owner", null), leaving));

        assertThat(service.members(OWNER, CIRCLE)).extracting(MemberResponse::name).containsExactly("Owner");
    }

    private static User named(UUID id, String name, Boolean shareProgress) {
        User u = new User();
        u.setId(id);
        u.setDisplayName(name);
        if (shareProgress != null) {
            u.setUiPrefs(Map.<String, Object>of("shareProgress", shareProgress));
        }
        return u;
    }
}
