package com.growthbuddy.mentorship;

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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
            Instant createdAt, Instant respondedAt, Instant checkedAt,
            String agreement) {

        static RequestDto from(MentorshipRequest r, String fromName, String toName) {
            return new RequestDto(r.getId(), r.getFromUserId(), fromName,
                    r.getToUserId(), toName, r.getDirection(), r.getStatus(),
                    r.getNote(), r.getCreatedAt(), r.getRespondedAt(), r.getCheckedAt(),
                    r.getAgreement());
        }
    }

    @Transactional
    public RequestDto create(UUID currentUserId, UUID otherUserId, Direction direction, String note) {
        if (currentUserId.equals(otherUserId)) {
            throw ApiException.badRequest("You can't send a mentorship request to yourself.");
        }
        // Scheduled for deletion reads as not found, as it does in search.
        User other = users.findById(otherUserId)
                .filter(u -> !u.isPendingDeletion())
                .orElseThrow(() -> ApiException.notFound("User"));

        checkCanInvite(requests.findAllBetween(currentUserId, otherUserId),
                currentUserId, direction, Instant.now());

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

    /** How long a declined invite blocks the sender from asking again, same side. */
    static final Duration REJECT_COOLDOWN = Duration.ofDays(7);
    /** Declined / cancelled rows drop out of the lists after this long. */
    static final Duration CLOSED_VISIBLE_FOR = Duration.ofDays(7);

    /**
     * Would an invite from {@code from} in {@code direction} be a duplicate, or
     * pester someone who just said no?
     *
     * <p>Judged by SIDE, not by row: what matters is who would end up the mentor
     * ({@link #makesMentor}). An "offer" I send and a "request" they send me both
     * make me their mentor, so either one already pending means the invite I'm
     * about to send is the mirror of one that exists — and accepting both would
     * have made two accepted rows for one link. The old check only looked for a
     * pending row from me, in my direction, so it allowed both of those, and an
     * invite on top of an already-accepted link too.
     */
    static void checkCanInvite(List<MentorshipRequest> between, UUID from, Direction direction, Instant now) {
        boolean wouldMentor = direction == Direction.offer;
        for (MentorshipRequest r : between) {
            if (makesMentor(r, from) != wouldMentor) {
                continue;
            }
            switch (r.getStatus()) {
                case accepted -> throw ApiException.badRequest(wouldMentor
                        ? "You already mentor this person."
                        : "This person already mentors you.");
                case pending -> throw ApiException.badRequest(r.getFromUserId().equals(from)
                        ? "You already have a pending invite to this person."
                        : "They've already sent you this invite — answer it under Requests for you.");
                case rejected -> {
                    boolean mine = r.getFromUserId().equals(from);
                    Instant at = r.getRespondedAt() != null ? r.getRespondedAt() : r.getCreatedAt();
                    if (mine && at != null && at.plus(REJECT_COOLDOWN).isAfter(now)) {
                        throw ApiException.badRequest(
                                "They declined your invite recently. You can ask again in a few days.");
                    }
                }
                default -> { /* cancelled never blocks */ }
            }
        }
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
                ? responderName + " accepted your mentorship invite"
                : responderName + " declined your invite";
        notifications.publish(originator.getId(), kind, title, null, r.getId());

        return RequestDto.from(r, originator.getDisplayName(), responderName);
    }

    @Transactional(readOnly = true)
    public List<RequestDto> incoming(UUID currentUserId) {
        return toDtos(visible(requests.findByToUserIdOrderByCreatedAtDesc(currentUserId), Instant.now()),
                "Someone", "You");
    }

    @Transactional(readOnly = true)
    public List<RequestDto> outgoing(UUID currentUserId) {
        return toDtos(visible(requests.findByFromUserIdOrderByCreatedAtDesc(currentUserId), Instant.now()),
                "You", "Someone");
    }

    /**
     * Declined and cancelled rows are history, not state: they stay in the table
     * (the audit trail, and the cooldown reads them) but leave the lists a week
     * after they closed. Before, a declined invite sat under "Your invites" forever.
     */
    static List<MentorshipRequest> visible(List<MentorshipRequest> rows, Instant now) {
        Instant cutoff = now.minus(CLOSED_VISIBLE_FOR);
        return rows.stream().filter(r -> {
            if (r.getStatus() != Status.rejected && r.getStatus() != Status.cancelled) {
                return true;
            }
            Instant at = r.getRespondedAt() != null ? r.getRespondedAt() : r.getCreatedAt();
            return at != null && at.isAfter(cutoff);
        }).toList();
    }

    /** One user lookup for the whole list — it used to be two findById per row. */
    private List<RequestDto> toDtos(List<MentorshipRequest> rows, String fromFallback, String toFallback) {
        Set<UUID> ids = new HashSet<>();
        rows.forEach(r -> {
            ids.add(r.getFromUserId());
            ids.add(r.getToUserId());
        });
        Map<UUID, String> names = new HashMap<>();
        if (!ids.isEmpty()) {
            users.findAllById(ids).forEach(u -> names.put(u.getId(), u.getDisplayName()));
        }
        return rows.stream()
                .map(r -> RequestDto.from(r,
                        names.getOrDefault(r.getFromUserId(), fromFallback),
                        names.getOrDefault(r.getToUserId(), toFallback)))
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

    /**
     * Stamp "the mentor looked" on the accepted link where {@code mentorId}
     * mentors {@code menteeId}. Called when the progress sheet loads, so the
     * tick means what it says — they opened it — rather than being a button you
     * can tap without reading anything.
     *
     * <p>Silent no-op if the pair has no such link: the caller has already
     * checked the relationship, and a bookkeeping stamp must never be the thing
     * that fails someone's page load.
     */
    @Transactional
    public void markChecked(UUID mentorId, UUID menteeId) {
        Instant now = Instant.now();
        for (MentorshipRequest r : requests.findAllBetween(mentorId, menteeId)) {
            if (r.getStatus() == Status.accepted && makesMentor(r, mentorId)) {
                r.setCheckedAt(now);
                requests.save(r);
            }
        }
    }

    /** Would {@code userId} be the MENTOR if this request were accepted? */
    static boolean makesMentor(MentorshipRequest r, UUID userId) {
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
        boolean endedLink = false;
        MentorshipRequest lastCancelled = null;
        for (MentorshipRequest r : requests.findAllBetween(currentUserId, partnerId)) {
            if (r.getStatus() != Status.pending && r.getStatus() != Status.accepted) continue;
            if (makesMentor(r, currentUserId) != revokingMentorSide) continue;
            endedLink |= r.getStatus() == Status.accepted;
            r.setStatus(Status.cancelled);
            r.setRespondedAt(now);
            requests.save(r);
            notifications.deleteByRelated(r.getId());
            lastCancelled = r;
        }
        // respond() tells the other side; revoke() used to end a connection
        // silently, so the partner found out only when the card vanished. A
        // withdrawn PENDING invite needs no message — its bell card is simply
        // gone (deleteByRelated above), which is the whole of what changed for them.
        if (endedLink && lastCancelled != null) {
            String name = users.findById(currentUserId).map(User::getDisplayName).orElse("Someone");
            notifications.publish(partnerId, NotificationKind.system, NotifyCategory.people,
                    name + " ended your mentorship connection", null, lastCancelled.getId());
        }
    }
}
