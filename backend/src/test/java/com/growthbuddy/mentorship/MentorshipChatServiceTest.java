package com.growthbuddy.mentorship;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.mentorship.MentorshipRequest.Direction;
import com.growthbuddy.mentorship.MentorshipRequest.Status;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotifyCategory;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.push.PushService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * Inside a link: only its two people, and only while it is accepted, may
 * nudge, message, read the thread or set the agreement. Nudges are capped per
 * sender per day. The weekly card is the mentor's alone and honours the
 * mentee's progress-sharing switch.
 */
class MentorshipChatServiceTest {

    private static final UUID MENTOR = UUID.randomUUID();
    private static final UUID MENTEE = UUID.randomUUID();
    private static final UUID STRANGER = UUID.randomUUID();
    private static final UUID LINK = UUID.randomUUID();

    private final MentorshipRequestRepository requests = mock(MentorshipRequestRepository.class);
    private final MentorshipMessageRepository messages = mock(MentorshipMessageRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final PushService push = mock(PushService.class);
    private final MentorshipEvents events = mock(MentorshipEvents.class);
    private final HabitService habits = mock(HabitService.class);
    private final UserClock clock = mock(UserClock.class);
    private final MentorshipChatService service = new MentorshipChatService(
            requests, messages, users, notifications, push, events, habits, clock);

    /** MENTOR offered to mentor MENTEE; {@code status} decides whether it's live. */
    private MentorshipRequest link(Status status) {
        MentorshipRequest r = new MentorshipRequest();
        r.setId(LINK);
        r.setFromUserId(MENTOR);
        r.setToUserId(MENTEE);
        r.setDirection(Direction.offer);
        r.setStatus(status);
        when(requests.findById(LINK)).thenReturn(Optional.of(r));
        when(users.findById(MENTOR)).thenReturn(Optional.of(user(MENTOR, "Asha", null)));
        when(users.findById(MENTEE)).thenReturn(Optional.of(user(MENTEE, "Ravi", null)));
        when(clock.zoneOf(any())).thenReturn(ZoneId.of("UTC"));
        when(messages.save(any())).thenAnswer(inv -> {
            MentorshipMessage m = inv.getArgument(0);
            // Re-stubbing (link() called twice) invokes this with a null matcher arg.
            if (m == null) return null;
            m.setId(UUID.randomUUID());
            m.setCreatedAt(Instant.now());
            return m;
        });
        return r;
    }

    private static User user(UUID id, String name, Boolean shareProgress) {
        User u = new User();
        u.setId(id);
        u.setDisplayName(name);
        if (shareProgress != null) {
            u.setUiPrefs(Map.<String, Object>of("shareProgress", shareProgress));
        }
        return u;
    }

    private static void assertStatus(Runnable call, HttpStatus status) {
        assertThatThrownBy(call::run).isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(status);
    }

    /* ---- Nudges ---- */

    @Test
    void eitherPartnerCanCheerTheOtherAndItRingsTheirBell() {
        link(Status.accepted);
        MentorshipChatService.MessageDto d = service.nudge(MENTOR, LINK, "cheer", " Great week! ");
        assertThat(d.kind()).isEqualTo("cheer");
        assertThat(d.body()).isEqualTo("Great week!");
        verify(notifications).publish(eq(MENTEE), eq(NotificationKind.system), eq(NotifyCategory.people),
                eq("Asha is cheering you on"), eq("Great week!"), eq(LINK));
        verify(events).message(eq(MENTEE), any());

        service.nudge(MENTEE, LINK, "nudge", null);
        verify(notifications).publish(eq(MENTOR), eq(NotificationKind.system), eq(NotifyCategory.people),
                eq("Ravi nudged you"), eq(null), eq(LINK));
    }

    @Test
    void theFourthNudgeOfTheDayIsRefused() {
        link(Status.accepted);
        when(messages.countByLinkIdAndSenderIdAndKindInAndCreatedAtGreaterThanEqual(
                eq(LINK), eq(MENTOR), any(), any())).thenReturn((long) MentorshipChatService.DAILY_NUDGES);
        assertStatus(() -> service.nudge(MENTOR, LINK, "nudge", null), HttpStatus.TOO_MANY_REQUESTS);
        verify(messages, never()).save(any());
        verify(notifications, never()).publish(any(), any(), any(), anyString(), any(), any());
    }

    @Test
    void theCapIsPerSender() {
        link(Status.accepted);
        when(messages.countByLinkIdAndSenderIdAndKindInAndCreatedAtGreaterThanEqual(
                eq(LINK), eq(MENTOR), any(), any())).thenReturn(3L);
        when(messages.countByLinkIdAndSenderIdAndKindInAndCreatedAtGreaterThanEqual(
                eq(LINK), eq(MENTEE), any(), any())).thenReturn(0L);
        assertThat(service.nudge(MENTEE, LINK, "cheer", null).senderId()).isEqualTo(MENTEE);
    }

    @Test
    void nudgesAreOnlyBetweenAcceptedPartners() {
        link(Status.accepted);
        assertStatus(() -> service.nudge(STRANGER, LINK, "cheer", null), HttpStatus.NOT_FOUND);
        link(Status.pending);
        assertStatus(() -> service.nudge(MENTOR, LINK, "cheer", null), HttpStatus.FORBIDDEN);
        link(Status.cancelled);
        assertStatus(() -> service.nudge(MENTEE, LINK, "cheer", null), HttpStatus.FORBIDDEN);
        verify(messages, never()).save(any());
    }

    @Test
    void aNudgeIsCheerOrNudgeAndShort() {
        link(Status.accepted);
        assertStatus(() -> service.nudge(MENTOR, LINK, "poke", null), HttpStatus.BAD_REQUEST);
        assertStatus(() -> service.nudge(MENTOR, LINK, "cheer", "x".repeat(141)), HttpStatus.BAD_REQUEST);
    }

    /* ---- Messages ---- */

    @Test
    void onlyThePairReadsOrWritesTheThread() {
        link(Status.accepted);
        assertStatus(() -> service.thread(STRANGER, LINK, null), HttpStatus.NOT_FOUND);
        assertStatus(() -> service.send(STRANGER, LINK, "hi"), HttpStatus.NOT_FOUND);
        link(Status.rejected);
        assertStatus(() -> service.thread(MENTEE, LINK, null), HttpStatus.FORBIDDEN);
        assertStatus(() -> service.send(MENTOR, LINK, "hi"), HttpStatus.FORBIDDEN);
        verify(messages, never()).save(any());
    }

    @Test
    void aMessageReachesThePartnerLiveAndOnTheBell() {
        link(Status.accepted);
        MentorshipChatService.MessageDto d = service.send(MENTEE, LINK, "  Stuck on recursion  ");
        assertThat(d.body()).isEqualTo("Stuck on recursion");
        assertThat(d.senderName()).isEqualTo("Ravi");
        verify(events).message(MENTOR, d);
        verify(notifications).publish(eq(MENTOR), eq(NotificationKind.system), eq(NotifyCategory.people),
                eq("Ravi sent you a message"), eq("Stuck on recursion"), eq(LINK));
    }

    @Test
    void anEmptyOrOverlongMessageIsRefused() {
        link(Status.accepted);
        assertStatus(() -> service.send(MENTOR, LINK, "   "), HttpStatus.BAD_REQUEST);
        assertStatus(() -> service.send(MENTOR, LINK, "x".repeat(2001)), HttpStatus.BAD_REQUEST);
    }

    @Test
    void theThreadComesBackOldestFirst() {
        link(Status.accepted);
        MentorshipMessage newer = msg(MENTEE, "second", "2026-10-10T10:00:00Z");
        MentorshipMessage older = msg(MENTOR, "first", "2026-10-10T09:00:00Z");
        when(messages.findByLinkIdOrderByCreatedAtDesc(eq(LINK), any())).thenReturn(List.of(newer, older));
        List<MentorshipChatService.MessageDto> t = service.thread(MENTOR, LINK, null);
        assertThat(t).extracting(MentorshipChatService.MessageDto::body).containsExactly("first", "second");
        assertThat(t).extracting(MentorshipChatService.MessageDto::senderName).containsExactly("Asha", "Ravi");
    }

    private static MentorshipMessage msg(UUID sender, String body, String at) {
        MentorshipMessage m = new MentorshipMessage();
        m.setId(UUID.randomUUID());
        m.setLinkId(LINK);
        m.setSenderId(sender);
        m.setBody(body);
        m.setCreatedAt(Instant.parse(at));
        return m;
    }

    /* ---- Agreement + weekly card ---- */

    @Test
    void eitherPartnerSetsTheAgreementAndBlankClearsIt() {
        MentorshipRequest r = link(Status.accepted);
        assertThat(service.setAgreement(MENTEE, LINK, " 30 min DSA, 5 days a week ").agreement())
                .isEqualTo("30 min DSA, 5 days a week");
        assertThat(r.getAgreement()).isEqualTo("30 min DSA, 5 days a week");
        service.setAgreement(MENTOR, LINK, "  ");
        assertThat(r.getAgreement()).isNull();
        assertStatus(() -> service.setAgreement(STRANGER, LINK, "x"), HttpStatus.NOT_FOUND);
    }

    @Test
    void theWeeklyCardIsTheMentorsOnly() {
        link(Status.accepted);
        assertStatus(() -> service.week(MENTEE, LINK), HttpStatus.FORBIDDEN);
    }

    @Test
    void theWeeklyCardShowsTheMenteesWeek() {
        MentorshipRequest r = link(Status.accepted);
        r.setAgreement("Ship the portfolio");
        when(habits.countDoneBetween(eq(MENTEE), any(), any())).thenReturn(9L, 6L);
        when(habits.streakLines(MENTEE)).thenReturn(List.of(new HabitService.StreakLine("Read", 4, 10, true)));
        MentorshipChatService.WeekDto w = service.week(MENTOR, LINK);
        assertThat(w.shared()).isTrue();
        assertThat(w.checkins()).isEqualTo(9);
        assertThat(w.lastWeekCheckins()).isEqualTo(6);
        assertThat(w.streaks()).hasSize(1);
        assertThat(w.agreement()).isEqualTo("Ship the portfolio");
        assertThat(w.weekStart().getDayOfWeek()).isEqualTo(java.time.DayOfWeek.MONDAY);
    }

    @Test
    void theWeeklyCardHonoursProgressSharing() {
        link(Status.accepted);
        when(users.findById(MENTEE)).thenReturn(Optional.of(user(MENTEE, "Ravi", false)));
        MentorshipChatService.WeekDto w = service.week(MENTOR, LINK);
        assertThat(w.shared()).isFalse();
        assertThat(w.checkins()).isZero();
        assertThat(w.streaks()).isEmpty();
        verify(habits, never()).streakLines(any());
        verify(habits, never()).countDoneBetween(any(UUID.class), any(), any());
    }
}
