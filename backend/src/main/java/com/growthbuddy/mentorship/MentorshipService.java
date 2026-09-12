package com.growthbuddy.mentorship;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.mentorship.MentorshipRequest.Direction;
import com.growthbuddy.mentorship.MentorshipRequest.Status;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MentorshipService {

    private final MentorshipRequestRepository requests;
    private final UserRepository users;
    private final NotificationService notifications;

    public MentorshipService(MentorshipRequestRepository requests,
                             UserRepository users,
                             NotificationService notifications) {
        this.requests = requests;
        this.users = users;
        this.notifications = notifications;
    }

    public record RequestDto(
            UUID id, UUID fromUserId, String fromName,
            UUID toUserId, String toName,
            Direction direction, Status status, String note,
            Instant createdAt, Instant respondedAt) {

        static RequestDto from(MentorshipRequest r, String fromName, String toName) {
            return new RequestDto(r.getId(), r.getFromUserId(), fromName,
                    r.getToUserId(), toName, r.getDirection(), r.getStatus(),
                    r.getNote(), r.getCreatedAt(), r.getRespondedAt());
        }
    }

    @Transactional
    public RequestDto create(UUID currentUserId, UUID otherUserId, Direction direction, String note) {
        if (currentUserId.equals(otherUserId)) {
            throw ApiException.badRequest("You can't send a mentorship request to yourself.");
        }
        User other = users.findById(otherUserId)
                .orElseThrow(() -> ApiException.notFound("User"));

        // Prevent duplicate pending invites in the same direction.
        requests.findFirstByFromUserIdAndToUserIdAndDirectionAndStatus(
                currentUserId, otherUserId, direction, Status.pending).ifPresent(existing -> {
            throw ApiException.badRequest("You already have a pending invite to this person.");
        });

        MentorshipRequest r = new MentorshipRequest();
        r.setFromUserId(currentUserId);
        r.setToUserId(otherUserId);
        r.setDirection(direction);
        r.setNote(note);
        r = requests.save(r);

        User from = users.findById(currentUserId).orElseThrow();
        String fromName = from.getDisplayName();
        String title = direction == Direction.offer
                ? fromName + " offered to mentor you"
                : fromName + " wants you to mentor them";
        String body = note != null && !note.isBlank() ? "“" + note + "”" : null;
        notifications.publish(otherUserId, NotificationKind.mentorship_request, title, body, r.getId());

        return RequestDto.from(r, fromName, other.getDisplayName());
    }

    @Transactional
    public RequestDto respond(UUID currentUserId, UUID requestId, boolean accept) {
        MentorshipRequest r = requests.findById(requestId)
                .orElseThrow(() -> ApiException.notFound("Request"));
        if (!r.getToUserId().equals(currentUserId)) {
            throw ApiException.notFound("Request");
        }
        if (r.getStatus() != Status.pending) {
            throw ApiException.badRequest("This request has already been " + r.getStatus() + ".");
        }
        r.setStatus(accept ? Status.accepted : Status.rejected);
        r.setRespondedAt(Instant.now());
        requests.save(r);

        // Resolved → drop the recipient's "pending invite" bell card entirely
        // so the inbox doesn't keep stale items the user already acted on.
        notifications.deleteByRelated(r.getId());

        User responder = users.findById(currentUserId).orElseThrow();
        User originator = users.findById(r.getFromUserId()).orElseThrow();
        String responderName = responder.getDisplayName();
        NotificationKind kind = accept ? NotificationKind.mentorship_accepted : NotificationKind.mentorship_rejected;
        String title = accept
                ? responderName + " accepted your mentorship invite 🎉"
                : responderName + " declined your invite";
        notifications.publish(originator.getId(), kind, title, null, r.getId());

        return RequestDto.from(r, originator.getDisplayName(), responderName);
    }

    @Transactional(readOnly = true)
    public List<RequestDto> incoming(UUID currentUserId) {
        return requests.findByToUserIdOrderByCreatedAtDesc(currentUserId).stream()
                .map(r -> RequestDto.from(r,
                        users.findById(r.getFromUserId()).map(User::getDisplayName).orElse("Someone"),
                        users.findById(r.getToUserId()).map(User::getDisplayName).orElse("You")))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<RequestDto> outgoing(UUID currentUserId) {
        return requests.findByFromUserIdOrderByCreatedAtDesc(currentUserId).stream()
                .map(r -> RequestDto.from(r,
                        users.findById(r.getFromUserId()).map(User::getDisplayName).orElse("You"),
                        users.findById(r.getToUserId()).map(User::getDisplayName).orElse("Someone")))
                .toList();
    }

    /**
     * What is {@code currentUser}'s relationship with {@code other}?
     *
     * <p>The two directions are INDEPENDENT: A can mentor B while B mentors A.
     * {@code mentorLink} is the caller's standing as the other's mentor;
     * {@code menteeLink} is their standing as the other's mentee. Each is
     * {@code none} / {@code pending} / {@code active}.
     *
     * <p>{@code state} is the legacy single-value summary kept for callers that
     * only need "are we connected at all" — accepted wins, then pending.
     */
    @Transactional(readOnly = true)
    public Relationship relationship(UUID currentUserId, UUID otherUserId) {
        if (currentUserId.equals(otherUserId)) {
            return new Relationship("self", null, "none", null, "none", null);
        }
        UUID mentorActive = null, menteeActive = null, mentorPending = null, menteePending = null;
        for (MentorshipRequest r : requests.findAllBetween(currentUserId, otherUserId)) {
            boolean curIsMentor = makesMentor(r, currentUserId);
            switch (r.getStatus()) {
                case accepted -> {
                    if (curIsMentor) mentorActive = r.getId();
                    else menteeActive = r.getId();
                }
                case pending -> {
                    if (curIsMentor) {
                        if (mentorPending == null) mentorPending = r.getId();
                    } else if (menteePending == null) {
                        menteePending = r.getId();
                    }
                }
                default -> { /* rejected/cancelled don't constrain re-invites */ }
            }
        }
        String mentorLink = mentorActive != null ? "active" : mentorPending != null ? "pending" : "none";
        String menteeLink = menteeActive != null ? "active" : menteePending != null ? "pending" : "none";
        UUID mentorId = mentorActive != null ? mentorActive : mentorPending;
        UUID menteeId = menteeActive != null ? menteeActive : menteePending;

        String state;
        UUID reqId;
        if (mentorActive != null) {
            state = "mentoring";
            reqId = mentorActive;
        } else if (menteeActive != null) {
            state = "mentee";
            reqId = menteeActive;
        } else if (mentorPending != null || menteePending != null) {
            state = "pending";
            reqId = mentorPending != null ? mentorPending : menteePending;
        } else {
            state = "none";
            reqId = null;
        }
        return new Relationship(state, reqId, mentorLink, mentorId, menteeLink, menteeId);
    }

    /** Would {@code userId} be the MENTOR if this request were accepted? */
    private static boolean makesMentor(MentorshipRequest r, UUID userId) {
        boolean isFrom = r.getFromUserId().equals(userId);
        return (isFrom && r.getDirection() == Direction.offer)
                || (!isFrom && r.getDirection() == Direction.request);
    }

    public record Relationship(String state, UUID requestId,
            String mentorLink, UUID mentorRequestId,
            String menteeLink, UUID menteeRequestId) {}

    /**
     * Revoke (cancel) an existing connection. Either user in the pair may
     * call this — the row's status flips to {@code cancelled} so it stops
     * showing up as an active connection but the audit trail is preserved.
     */
    @Transactional
    public void revoke(UUID currentUserId, UUID requestId) {
        MentorshipRequest seed = requests.findById(requestId)
                .orElseThrow(() -> ApiException.notFound("Request"));
        if (!seed.getFromUserId().equals(currentUserId) && !seed.getToUserId().equals(currentUserId)) {
            throw ApiException.notFound("Request");
        }
        UUID partnerId = seed.getFromUserId().equals(currentUserId)
                ? seed.getToUserId() : seed.getFromUserId();

        // Cancel only the DIRECTION being revoked. The two directions are
        // independent (I mentor you, you mentor me), so dropping "I mentor you"
        // must leave "you mentor me" standing. Duplicate rows on the same side
        // go together, which keeps that side resolving cleanly to none.
        boolean revokingMentorSide = makesMentor(seed, currentUserId);
        Instant now = Instant.now();
        for (MentorshipRequest r : requests.findAllBetween(currentUserId, partnerId)) {
            if (r.getStatus() != Status.pending && r.getStatus() != Status.accepted) continue;
            if (makesMentor(r, currentUserId) != revokingMentorSide) continue;
            r.setStatus(Status.cancelled);
            r.setRespondedAt(now);
            requests.save(r);
            notifications.deleteByRelated(r.getId());
        }
    }
}
