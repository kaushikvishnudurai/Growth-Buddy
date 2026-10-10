package com.growthbuddy.reminder;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationRepository;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * "Remind me again in 10 minutes", from wherever the reminder reached the user:
 * the app (bell card, toast), a push notification's button (a signed ticket,
 * {@link SnoozeLinks}), or WhatsApp (the button, or a reply of SNOOZE).
 *
 * <p>A snooze is one {@code snoozed_until} on the reminder, and
 * {@link ReminderDeliveryScheduler} rings it then over the same channels as the
 * reminder itself. Snoozing again moves it; there is never more than one.
 */
@Service
public class ReminderSnoozeService {

    /** How far back a WhatsApp "SNOOZE" reply looks for the reminder it means. */
    static final Duration REPLY_WINDOW = Duration.ofHours(12);

    private final CalendarReminderRepository reminders;
    private final UserRepository users;
    private final NotificationRepository notifications;
    private final SnoozeLinks links;
    private final Clock clock;

    @Autowired
    public ReminderSnoozeService(CalendarReminderRepository reminders, UserRepository users,
                                 NotificationRepository notifications, SnoozeLinks links) {
        this(reminders, users, notifications, links, Clock.systemUTC());
    }

    ReminderSnoozeService(CalendarReminderRepository reminders, UserRepository users,
                          NotificationRepository notifications, SnoozeLinks links, Clock clock) {
        this.reminders = reminders;
        this.users = users;
        this.notifications = notifications;
        this.links = links;
        this.clock = clock;
    }

    /** From the app. {@code minutes} null means the user's default length. */
    @Transactional
    public ReminderResponse snooze(UUID userId, UUID reminderId, Integer minutes) {
        CalendarReminder r = reminders.findByIdAndUserId(reminderId, userId)
                .orElseThrow(() -> ApiException.notFound("Reminder"));
        if (r.getTime() == null) {
            // Nothing rang, so there is nothing to ring again — and the scheduler
            // only reads timed reminders, so it never would.
            throw ApiException.badRequest("Only a reminder with a time can be snoozed.");
        }
        int length = minutes != null ? minutes : defaultLength(userId);
        if (length < 1 || length > ReminderPrefs.MAX_SNOOZE) {
            throw ApiException.badRequest("Snooze for 1 to " + ReminderPrefs.MAX_SNOOZE + " minutes.");
        }
        r.setSnoozedUntil(until(length));
        return ReminderResponse.from(reminders.save(r));
    }

    @Transactional
    public ReminderResponse cancel(UUID userId, UUID reminderId) {
        CalendarReminder r = reminders.findByIdAndUserId(reminderId, userId)
                .orElseThrow(() -> ApiException.notFound("Reminder"));
        r.setSnoozedUntil(null);
        return ReminderResponse.from(reminders.save(r));
    }

    /** The push button's ticket. Empty when it is no good or the reminder is gone. */
    @Transactional
    public Optional<Instant> snoozeByLink(String token) {
        return links.verify(token, clock.instant())
                .flatMap(t -> trySnooze(t.userId(), t.reminderId(), null));
    }

    /** WhatsApp's button: the payload names the reminder, the sender's number names the user. */
    @Transactional
    public Optional<Instant> snoozeFromWhatsApp(User user, UUID reminderId, Integer minutes) {
        return trySnooze(user.getId(), reminderId, minutes);
    }

    /** A typed "snooze": the reminder that reached them most recently. */
    @Transactional
    public Optional<Instant> snoozeLatestFromWhatsApp(User user, Integer minutes) {
        return notifications.findFirstByUserIdAndKindAndCreatedAtAfterOrderByCreatedAtDesc(
                        user.getId(), NotificationKind.reminder, clock.instant().minus(REPLY_WINDOW))
                .flatMap(n -> n.getRelatedId() == null ? Optional.empty()
                        : trySnooze(user.getId(), n.getRelatedId(), minutes));
    }

    private Optional<Instant> trySnooze(UUID userId, UUID reminderId, Integer minutes) {
        try {
            return Optional.ofNullable(snooze(userId, reminderId, minutes).snoozedUntil());
        } catch (ApiException ex) {
            return Optional.empty();
        }
    }

    private int defaultLength(UUID userId) {
        return users.findById(userId).map(u -> ReminderPrefs.snoozeOf(u.getUiPrefs()))
                .orElse(ReminderPrefs.DEFAULT_SNOOZE);
    }

    /** On the minute, because the scheduler ticks on the minute. */
    private Instant until(int minutes) {
        return clock.instant().plus(Duration.ofMinutes(minutes)).truncatedTo(ChronoUnit.MINUTES);
    }
}
