package com.growthbuddy.mentorship;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.growthbuddy.mentorship.MentorshipRequest.Direction;
import com.growthbuddy.mentorship.MentorshipRequest.Status;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.user.UserRepository;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * The two mentorship directions are independent: A can mentor B while B mentors
 * A. relationship() has to report each side on its own, which is what lets the
 * Circle UI offer the still-open direction instead of one status pill.
 */
@ExtendWith(MockitoExtension.class)
class MentorshipRelationshipTest {

    private static final UUID ME = UUID.randomUUID();
    private static final UUID THEM = UUID.randomUUID();

    @Mock MentorshipRequestRepository requests;
    @Mock UserRepository users;
    @Mock NotificationService notifications;

    private MentorshipService service() {
        return new MentorshipService(requests, users, notifications);
    }

    private MentorshipRequest req(UUID from, UUID to, Direction direction, Status status) {
        MentorshipRequest r = new MentorshipRequest();
        r.setId(UUID.randomUUID());
        r.setFromUserId(from);
        r.setToUserId(to);
        r.setDirection(direction);
        r.setStatus(status);
        return r;
    }

    private MentorshipService.Relationship resolve(MentorshipRequest... between) {
        when(requests.findAllBetween(ME, THEM)).thenReturn(List.of(between));
        return service().relationship(ME, THEM);
    }

    @Test
    void noRowsMeansBothDirectionsOpen() {
        var rel = resolve();
        assertThat(rel.state()).isEqualTo("none");
        assertThat(rel.mentorLink()).isEqualTo("none");
        assertThat(rel.menteeLink()).isEqualTo("none");
    }

    /** I offered to mentor them and they accepted — only that side is taken. */
    @Test
    void acceptedOfferFillsOnlyTheMentorSide() {
        var rel = resolve(req(ME, THEM, Direction.offer, Status.accepted));
        assertThat(rel.mentorLink()).isEqualTo("active");
        assertThat(rel.menteeLink()).isEqualTo("none");
        assertThat(rel.state()).isEqualTo("mentoring");
    }

    /** The reverse tie, built from the other person's accepted offer. */
    @Test
    void theirAcceptedOfferFillsOnlyTheMenteeSide() {
        var rel = resolve(req(THEM, ME, Direction.offer, Status.accepted));
        assertThat(rel.mentorLink()).isEqualTo("none");
        assertThat(rel.menteeLink()).isEqualTo("active");
        assertThat(rel.state()).isEqualTo("mentee");
    }

    /** The case the old single-state model could not express at all. */
    @Test
    void bothDirectionsCanBeActiveAtOnce() {
        var rel = resolve(
                req(ME, THEM, Direction.offer, Status.accepted),
                req(ME, THEM, Direction.request, Status.accepted));
        assertThat(rel.mentorLink()).isEqualTo("active");
        assertThat(rel.menteeLink()).isEqualTo("active");
    }

    /** Mentoring them must leave "ask them to mentor me" still offerable. */
    @Test
    void activeOneWayLeavesTheOtherWayOpen() {
        var rel = resolve(req(ME, THEM, Direction.offer, Status.accepted));
        assertThat(rel.menteeLink()).isEqualTo("none");
    }

    @Test
    void pendingIsTrackedPerDirection() {
        var rel = resolve(
                req(ME, THEM, Direction.offer, Status.accepted),
                req(ME, THEM, Direction.request, Status.pending));
        assertThat(rel.mentorLink()).isEqualTo("active");
        assertThat(rel.menteeLink()).isEqualTo("pending");
    }

    /** Rejected and cancelled rows must not block a fresh invite. */
    @Test
    void closedRowsDoNotConstrainReInvites() {
        var rel = resolve(
                req(ME, THEM, Direction.offer, Status.rejected),
                req(THEM, ME, Direction.request, Status.cancelled));
        assertThat(rel.mentorLink()).isEqualTo("none");
        assertThat(rel.menteeLink()).isEqualTo("none");
        assertThat(rel.state()).isEqualTo("none");
    }

    /** You are never a candidate for your own circle. */
    @Test
    void selfIsItsOwnState() {
        var rel = service().relationship(ME, ME);
        assertThat(rel.state()).isEqualTo("self");
        assertThat(rel.mentorLink()).isEqualTo("none");
        assertThat(rel.menteeLink()).isEqualTo("none");
    }
}
