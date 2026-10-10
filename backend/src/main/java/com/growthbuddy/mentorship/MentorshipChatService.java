package com.growthbuddy.mentorship;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.mentorship.MentorshipRequest.Status;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotifyCategory;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.push.PushService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Everything that happens INSIDE an accepted mentorship link: cheers and
 * nudges, the message thread, the pair's agreement, and the mentor's weekly
 * check-in card. Invites and their lifecycle stay in {@link MentorshipService}.
 *
 * <p>The trust rule for all of it is {@link #requireLink}: the caller is one of
 * the link's two people AND the link is accepted. A pending, declined or ended
 * link opens nothing, so ending a connection closes its thread too.
 */
@Service
public class MentorshipChatService {

    private static final Logger log = LoggerFactory.getLogger(MentorshipChatService.class);

    /** Cheers + nudges per sender per link per (sender's local) day. */
    static final int DAILY_NUDGES = 3;
    static final int NUDGE_TEXT_MAX = 140;
    static final int MESSAGE_MAX = 2000;
    static final int AGREEMENT_MAX = 500;
    static final int THREAD_PAGE = 50;
    private static final Set<String> NUDGE_KINDS = Set.of("cheer", "nudge");

    private final MentorshipRequestRepository requests;
    private final MentorshipMessageRepository messages;
    private final UserRepository users;
    private final NotificationService notifications;
    private final PushService push;
    private final MentorshipEvents events;
    private final HabitService habits;
    private final UserClock clock;

    public MentorshipChatService(MentorshipRequestRepository requests,
                                 MentorshipMessageRepository messages,
                                 UserRepository users,
                                 NotificationService notifications,
                                 PushService push,
                                 MentorshipEvents events,
                                 HabitService habits,
                                 UserClock clock) {
        this.requests = requests;
        this.messages = messages;
        this.users = users;
        this.notifications = notifications;
        this.push = push;
        this.events = events;
        this.habits = habits;
        this.clock = clock;
    }

    public record MessageDto(UUID id, UUID linkId, UUID senderId, String senderName,
                             String kind, String body, Instant createdAt) {

        static MessageDto from(MentorshipMessage m, String senderName) {
            return new MessageDto(m.getId(), m.getLinkId(), m.getSenderId(), senderName,
                    m.getKind(), m.getBody(), m.getCreatedAt());
        }
    }

    public record AgreementDto(UUID linkId, String agreement) {
    }

    /**
     * The mentor's "This week" card. {@code shared=false} means the mentee has
     * progress sharing off (Settings, Privacy; {@link ProgressSharing}): the
     * numbers are then zero/empty, never the real ones.
     */
    public record WeekDto(UUID linkId, UUID menteeId, String menteeName, boolean shared,
                          String agreement, LocalDate weekStart, long checkins,
                          long lastWeekCheckins, List<HabitService.StreakLine> streaks) {
    }

    /* ---- Cheer / nudge ---- */

    @Transactional
    public MessageDto nudge(UUID me, UUID linkId, String kind, String text) {
        MentorshipRequest link = requireLink(me, linkId);
        String k = kind == null ? "" : kind.trim().toLowerCase(Locale.ROOT);
        if (!NUDGE_KINDS.contains(k)) {
            throw ApiException.badRequest("A nudge is either 'cheer' or 'nudge'.");
        }
        String note = text == null || text.isBlank() ? null : text.trim();
        if (note != null && note.length() > NUDGE_TEXT_MAX) {
            throw ApiException.badRequest("Keep it under " + NUDGE_TEXT_MAX + " characters.");
        }
        ZoneId zone = clock.zoneOf(me);
        Instant dayStart = LocalDate.now(zone).atStartOfDay(zone).toInstant();
        long sent = messages.countByLinkIdAndSenderIdAndKindInAndCreatedAtGreaterThanEqual(
                linkId, me, NUDGE_KINDS, dayStart);
        if (sent >= DAILY_NUDGES) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,
                    "That's " + DAILY_NUDGES + " for today. Save the next one for tomorrow.");
        }
        MentorshipMessage m = new MentorshipMessage();
        m.setLinkId(linkId);
        m.setSenderId(me);
        m.setKind(k);
        m.setBody(note);
        m = messages.save(m);

        String name = nameOf(me);
        String title = "cheer".equals(k) ? name + " is cheering you on" : name + " nudged you";
        MessageDto dto = MessageDto.from(m, name);
        deliver(partnerOf(link, me), title, note, linkId, dto);
        return dto;
    }

    /* ---- Thread ---- */

    /**
     * The newest {@link #THREAD_PAGE} lines, OLDEST FIRST (ready to render top
     * to bottom); {@code before} = the oldest createdAt held, for the page before.
     */
    @Transactional(readOnly = true)
    public List<MessageDto> thread(UUID me, UUID linkId, Instant before) {
        MentorshipRequest link = requireLink(me, linkId);
        PageRequest page = PageRequest.of(0, THREAD_PAGE);
        List<MentorshipMessage> rows = before == null
                ? messages.findByLinkIdOrderByCreatedAtDesc(linkId, page)
                : messages.findByLinkIdAndCreatedAtBeforeOrderByCreatedAtDesc(linkId, before, page);
        String myName = nameOf(me);
        String theirName = nameOf(partnerOf(link, me));
        List<MessageDto> out = new ArrayList<>(rows.size());
        for (MentorshipMessage m : rows) {
            out.add(MessageDto.from(m, me.equals(m.getSenderId()) ? myName : theirName));
        }
        Collections.reverse(out);
        return out;
    }

    /**
     * ponytail: every message rings the partner's bell (and web push). Fine for
     * a two-person thread at chat pace; collapse to one unread card per link if
     * it ever gets noisy.
     */
    @Transactional
    public MessageDto send(UUID me, UUID linkId, String body) {
        MentorshipRequest link = requireLink(me, linkId);
        String text = body == null ? "" : body.trim();
        if (text.isEmpty()) {
            throw ApiException.badRequest("Write something first.");
        }
        if (text.length() > MESSAGE_MAX) {
            throw ApiException.badRequest("Messages are limited to " + MESSAGE_MAX + " characters.");
        }
        MentorshipMessage m = new MentorshipMessage();
        m.setLinkId(linkId);
        m.setSenderId(me);
        m.setKind("message");
        m.setBody(text);
        m = messages.save(m);

        String name = nameOf(me);
        MessageDto dto = MessageDto.from(m, name);
        String excerpt = text.length() > 140 ? text.substring(0, 139) + "…" : text;
        deliver(partnerOf(link, me), name + " sent you a message", excerpt, linkId, dto);
        return dto;
    }

    /* ---- Agreement + weekly check-in ---- */

    /** Either partner may set it; blank clears it. */
    @Transactional
    public AgreementDto setAgreement(UUID me, UUID linkId, String text) {
        MentorshipRequest link = requireLink(me, linkId);
        String t = text == null || text.isBlank() ? null : text.trim();
        if (t != null && t.length() > AGREEMENT_MAX) {
            throw ApiException.badRequest("Keep the agreement under " + AGREEMENT_MAX + " characters.");
        }
        link.setAgreement(t);
        requests.save(link);
        return new AgreementDto(linkId, t);
    }

    /**
     * The mentor's view of the mentee's week (Monday to today, in the MENTEE's
     * zone: it's their week). Mentor only, like the progress sheet; the mentee
     * gets no window back.
     */
    @Transactional(readOnly = true)
    public WeekDto week(UUID me, UUID linkId) {
        MentorshipRequest link = requireLink(me, linkId);
        if (!MentorshipService.makesMentor(link, me)) {
            throw ApiException.forbidden("Only the mentor sees the weekly check-in.");
        }
        UUID mentee = partnerOf(link, me);
        User u = users.findById(mentee).orElseThrow(() -> ApiException.notFound("User"));
        LocalDate today = LocalDate.now(clock.zoneOf(mentee));
        LocalDate weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        if (!ProgressSharing.sharesProgress(u)) {
            return new WeekDto(linkId, mentee, u.getDisplayName(), false, link.getAgreement(),
                    weekStart, 0, 0, List.of());
        }
        long thisWeek = habits.countDoneBetween(mentee, weekStart, today);
        long lastWeek = habits.countDoneBetween(mentee, weekStart.minusDays(7), weekStart.minusDays(1));
        return new WeekDto(linkId, mentee, u.getDisplayName(), true, link.getAgreement(),
                weekStart, thisWeek, lastWeek, habits.streakLines(mentee));
    }

    /* ---- Helpers ---- */

    /**
     * The link, if {@code me} is one of its two people and it is accepted.
     * Not a party: 404 (don't confirm the link exists). A party to a link that
     * isn't active: 403.
     */
    MentorshipRequest requireLink(UUID me, UUID linkId) {
        MentorshipRequest r = requests.findById(linkId)
                .orElseThrow(() -> ApiException.notFound("Connection"));
        if (!me.equals(r.getFromUserId()) && !me.equals(r.getToUserId())) {
            throw ApiException.notFound("Connection");
        }
        if (r.getStatus() != Status.accepted) {
            throw ApiException.forbidden("This connection isn't active.");
        }
        return r;
    }

    private static UUID partnerOf(MentorshipRequest r, UUID me) {
        return me.equals(r.getFromUserId()) ? r.getToUserId() : r.getFromUserId();
    }

    private String nameOf(UUID id) {
        return users.findById(id).map(User::getDisplayName).orElse("Someone");
    }

    /** Bell card + web push + the transient frame an open chat sheet appends from. */
    private void deliver(UUID to, String title, String body, UUID linkId, MessageDto dto) {
        notifications.publish(to, NotificationKind.system, NotifyCategory.people, title, body, linkId);
        try {
            push.sendToUser(to, NotifyCategory.people, title, body, "/#circle");
        } catch (RuntimeException ex) {
            log.debug("mentorship push to {} failed", to, ex);
        }
        events.message(to, dto);
    }
}
