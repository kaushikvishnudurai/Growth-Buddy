package com.growthbuddy.mentorship;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.mentorship.MentorshipRequest.Direction;
import com.growthbuddy.mentorship.MentorshipRequest.Status;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotifyCategory;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Who may invite whom, who may answer, and what ending a link tells the other
 * person. The invite check is judged by SIDE (who would end up the mentor), so
 * a mirror invite — they asked me to mentor them, and I now offer to — is the
 * same link twice and must be refused.
 */
class MentorshipInviteRulesTest {

    private static final UUID ME = UUID.randomUUID();
    private static final UUID THEM = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-10-10T10:00:00Z");

    private static MentorshipRequest req(UUID from, UUID to, Direction d, Status s, Instant respondedAt) {
        MentorshipRequest r = new MentorshipRequest();
        r.setId(UUID.randomUUID());
        r.setFromUserId(from);
        r.setToUserId(to);
        r.setDirection(d);
        r.setStatus(s);
        r.setCreatedAt(NOW.minus(Duration.ofDays(30)));
        r.setRespondedAt(respondedAt);
        return r;
    }

    private static void check(Direction d, MentorshipRequest... between) {
        MentorshipService.checkCanInvite(List.of(between), ME, d, NOW);
    }

    @Test
    void freshPairMayInviteEitherWay() {
        assertThatCode(() -> check(Direction.offer)).doesNotThrowAnyException();
        assertThatCode(() -> check(Direction.request)).doesNotThrowAnyException();
    }

    @Test
    void anAcceptedLinkBlocksAnotherInviteOnTheSameSide() {
        assertThatThrownBy(() -> check(Direction.offer, req(ME, THEM, Direction.offer, Status.accepted, NOW)))
                .isInstanceOf(ApiException.class).hasMessageContaining("already mentor");
    }

    /** Their accepted request made me their mentor — an offer from me is the same link. */
    @Test
    void theMirrorOfAnAcceptedLinkIsBlockedToo() {
        assertThatThrownBy(() -> check(Direction.offer, req(THEM, ME, Direction.request, Status.accepted, NOW)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void myOwnPendingInviteBlocksADuplicate() {
        assertThatThrownBy(() -> check(Direction.offer, req(ME, THEM, Direction.offer, Status.pending, null)))
                .hasMessageContaining("pending invite");
    }

    /** They already asked me to mentor them: offering is answering, not a new invite. */
    @Test
    void aMirrorPendingInviteSendsYouToAnswerIt() {
        assertThatThrownBy(() -> check(Direction.offer, req(THEM, ME, Direction.request, Status.pending, null)))
                .hasMessageContaining("Requests for you");
    }

    /** The directions are independent: mentoring them leaves "mentor me" open. */
    @Test
    void theOtherSideStaysOpen() {
        assertThatCode(() -> check(Direction.request, req(ME, THEM, Direction.offer, Status.accepted, NOW)))
                .doesNotThrowAnyException();
    }

    @Test
    void aRecentDeclineStartsACooldown() {
        assertThatThrownBy(() -> check(Direction.offer,
                req(ME, THEM, Direction.offer, Status.rejected, NOW.minus(Duration.ofDays(2)))))
                .hasMessageContaining("declined");
    }

    @Test
    void theCooldownEndsAfterAWeek() {
        assertThatCode(() -> check(Direction.offer,
                req(ME, THEM, Direction.offer, Status.rejected, NOW.minus(Duration.ofDays(8)))))
                .doesNotThrowAnyException();
    }

    /** I declined THEIR invite — that is no reason to stop me inviting them. */
    @Test
    void myDeclineOfTheirInviteIsNoCooldownForMe() {
        assertThatCode(() -> check(Direction.offer,
                req(THEM, ME, Direction.request, Status.rejected, NOW.minus(Duration.ofDays(1)))))
                .doesNotThrowAnyException();
    }

    @Test
    void cancelledNeverBlocks() {
        assertThatCode(() -> check(Direction.offer, req(ME, THEM, Direction.offer, Status.cancelled, NOW)))
                .doesNotThrowAnyException();
    }

    @Test
    void closedRowsLeaveTheListsAfterAWeek() {
        MentorshipRequest pending = req(ME, THEM, Direction.offer, Status.pending, null);
        MentorshipRequest oldDecline = req(ME, THEM, Direction.offer, Status.rejected, NOW.minus(Duration.ofDays(9)));
        MentorshipRequest newDecline = req(ME, THEM, Direction.request, Status.rejected, NOW.minus(Duration.ofDays(1)));
        MentorshipRequest oldCancel = req(ME, THEM, Direction.offer, Status.cancelled, NOW.minus(Duration.ofDays(20)));
        assertThat(MentorshipService.visible(List.of(pending, oldDecline, newDecline, oldCancel), NOW))
                .containsExactly(pending, newDecline);
    }

    /* ---- respond / revoke through the service, repositories mocked ---- */

    private final MentorshipRequestRepository requests = mock(MentorshipRequestRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final MentorshipService service = new MentorshipService(requests, users, notifications, allowAllLimiter());

    private User user(UUID id, String name) {
        User u = new User();
        u.setId(id);
        u.setDisplayName(name);
        when(users.findById(id)).thenReturn(Optional.of(u));
        return u;
    }

    /** The row as respond / revoke reach it: pair ids first, then the locking read. */
    private void stored(MentorshipRequest r) {
        when(requests.findPairById(r.getId())).thenReturn(Optional.of(new MentorshipRequestRepository.Pair() {
            public UUID getFromUserId() { return r.getFromUserId(); }
            public UUID getToUserId() { return r.getToUserId(); }
        }));
        when(requests.lockAllBetween(r.getFromUserId(), r.getToUserId())).thenReturn(List.of(r));
        when(requests.lockAllBetween(r.getToUserId(), r.getFromUserId())).thenReturn(List.of(r));
    }

    /**
     * Withdraw vs accept, or an offer vs its mirror request, used to both decide
     * on the same old rows. Every path now locks both users (lower id first, so
     * two can't deadlock) and then decides on a locking read, never a plain one.
     */
    @Test
    void respondRevokeAndCreateDecideUnderThePairLock() {
        user(ME, "Me");
        user(THEM, "Them");
        UUID lo = ME.compareTo(THEM) < 0 ? ME : THEM;
        UUID hi = lo.equals(ME) ? THEM : ME;

        MentorshipRequest r = req(THEM, ME, Direction.offer, Status.pending, null);
        stored(r);
        service.respond(ME, r.getId(), true);
        var order = org.mockito.Mockito.inOrder(users, requests);
        order.verify(users).findForUpdate(lo);
        order.verify(users).findForUpdate(hi);
        order.verify(requests).lockAllBetween(THEM, ME);
        verify(requests, never()).findById(any());

        service.revoke(ME, r.getId());
        assertThat(r.getStatus()).isEqualTo(Status.cancelled);

        when(requests.lockAllBetween(ME, THEM)).thenReturn(List.of(req(THEM, ME, Direction.request, Status.pending, null)));
        assertThatThrownBy(() -> service.create(ME, THEM, Direction.offer, null))
                .hasMessageContaining("already sent you this invite");
        verify(requests, never()).findAllBetween(any(), any());
    }

    /** SEC-11: create / revoke / create is capped per sender per day. */
    @Test
    void invitesPastTheDailyCapAreRefused() {
        user(ME, "Me");
        user(THEM, "Them");
        var limiter = org.mockito.Mockito.mock(com.growthbuddy.common.RateLimiter.class);
        var capped = new MentorshipService(requests, users, notifications, limiter);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> capped.create(ME, THEM, Direction.offer, "hi"))
                .isInstanceOf(com.growthbuddy.common.ApiException.class)
                .hasMessageContaining("mentorship invites");
        org.mockito.Mockito.verify(requests, org.mockito.Mockito.never()).save(org.mockito.ArgumentMatchers.any());
        org.mockito.Mockito.verifyNoInteractions(notifications);
    }

    /** Only the person an invite is addressed to may answer it; to anyone else it does not exist. */
    @Test
    void someoneElseCannotAnswerAnInvite() {
        MentorshipRequest r = req(THEM, ME, Direction.offer, Status.pending, null);
        stored(r);
        UUID stranger = UUID.randomUUID();
        assertThatThrownBy(() -> service.respond(stranger, r.getId(), true))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus().value()).isEqualTo(404);
        assertThatThrownBy(() -> service.respond(THEM, r.getId(), true)).isInstanceOf(ApiException.class);
        assertThat(r.getStatus()).isEqualTo(Status.pending);
    }

    @Test
    void theRecipientCanAccept() {
        MentorshipRequest r = req(THEM, ME, Direction.offer, Status.pending, null);
        stored(r);
        user(ME, "Me");
        user(THEM, "Them");
        service.respond(ME, r.getId(), true);
        assertThat(r.getStatus()).isEqualTo(Status.accepted);
        verify(notifications).publish(eq(THEM), eq(NotificationKind.mentorship_accepted), anyString(), any(), eq(r.getId()));
    }

    /** Ending a live connection tells the other person, the way respond() does. */
    @Test
    void endingAConnectionNotifiesThePartner() {
        MentorshipRequest r = req(ME, THEM, Direction.offer, Status.accepted, NOW);
        stored(r);
        user(ME, "Vivek");
        service.revoke(ME, r.getId());
        assertThat(r.getStatus()).isEqualTo(Status.cancelled);
        verify(notifications).publish(eq(THEM), eq(NotificationKind.system), eq(NotifyCategory.people),
                eq("Vivek ended your mentorship connection"), any(), any());
    }

    /** Withdrawing a pending invite only removes their bell card — no second message. */
    @Test
    void withdrawingAPendingInviteSendsNoMessage() {
        MentorshipRequest r = req(ME, THEM, Direction.offer, Status.pending, null);
        stored(r);
        service.revoke(ME, r.getId());
        assertThat(r.getStatus()).isEqualTo(Status.cancelled);
        verify(notifications).deleteByRelated(r.getId());
        verify(notifications, never()).publish(any(), any(), any(), any(), any());
        verify(notifications, never()).publish(any(), any(), any(), any(), any(), any());
    }

    @Test
    void aStrangerCannotRevoke() {
        MentorshipRequest r = req(ME, THEM, Direction.offer, Status.accepted, NOW);
        stored(r);
        assertThatThrownBy(() -> service.revoke(UUID.randomUUID(), r.getId())).isInstanceOf(ApiException.class);
        assertThat(r.getStatus()).isEqualTo(Status.accepted);
    }

    private static com.growthbuddy.common.RateLimiter allowAllLimiter() {
        var l = org.mockito.Mockito.mock(com.growthbuddy.common.RateLimiter.class);
        org.mockito.Mockito.lenient().when(l.allow(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyLong())).thenReturn(true);
        return l;
    }
}
