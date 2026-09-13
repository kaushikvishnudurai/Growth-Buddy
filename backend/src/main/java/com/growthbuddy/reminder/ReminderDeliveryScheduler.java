package com.growthbuddy.reminder;

import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import com.growthbuddy.common.UserZone;
import com.growthbuddy.common.WorkWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Polls timed reminders and delivers them near their local due-time in each
 * user's timezone: the in-app bell always, plus WhatsApp and Web Push for the
 * users set up for those.
 */
@Component
public class ReminderDeliveryScheduler {

    private static final Logger log = LoggerFactory.getLogger(ReminderDeliveryScheduler.class);

    /**
     * How late a reminder may still be delivered. The minute-wide window it replaces
     * dropped anything a slow run, a restart, or a paused container stepped over.
     * ponytail: a fixed grace period, safe because the dispatch log de-dupes on
     * (reminder, day); widen it only if missed deliveries show up in the log.
     */
    private static final Duration CATCH_UP = Duration.ofMinutes(5);

    /**
     * Sends run concurrently: one blocking Cloud API call each, serialised, meant a
     * batch of ~1000 due reminders overran its own minute — and once a run overruns
     * by more than CATCH_UP, reminders due in the minutes it skipped are never sent.
     * ponytail: fixed 16, well under Meta's 80 msg/s default and tolerable against the
     * 8-connection DB pool the log writes share. Raise both together if a run overruns.
     */
    private final ExecutorService senders = Executors.newFixedThreadPool(16);

    private final CalendarReminderRepository reminders;
    private final ReminderDispatchLogRepository dispatchLog;
    private final ReminderService reminderService;
    private final UserRepository users;
    private final WhatsAppService whatsapp;

    public ReminderDeliveryScheduler(
            CalendarReminderRepository reminders,
            ReminderDispatchLogRepository dispatchLog,
            ReminderService reminderService,
            UserRepository users,
            WhatsAppService whatsapp,
            com.growthbuddy.push.PushService push,
            NotificationService notifications) {
        this.reminders = reminders;
        this.dispatchLog = dispatchLog;
        this.reminderService = reminderService;
        this.users = users;
        this.whatsapp = whatsapp;
        this.push = push;
        this.notifications = notifications;
    }

    private final NotificationService notifications;

    private final com.growthbuddy.push.PushService push;

    // Not @Transactional: this loop makes a blocking WhatsApp HTTP call per due
    // reminder; a loop-wide transaction would pin one DB connection for the whole
    // run. Each dispatchLog.save() is its own short transaction.
    @Scheduled(cron = "0 * * * * *")
    public void dispatchTimedWhatsAppReminders() {
        // No early exit on WhatsApp/push any more: the bell is a channel too, and
        // it needs no configuration at all. A reminder set on a phone with
        // notifications refused still turns up in the app.
        List<CalendarReminder> candidates =
                reminders.findDeliverable(true, whatsapp.isConfigured(), push.isConfigured());
        if (candidates.isEmpty()) {
            return;
        }

        // Two batch reads replace a per-reminder lookup each. Everything below is
        // then in-memory, so a tick costs three queries whatever the user count.
        Map<UUID, User> userCache = new HashMap<>();
        for (User u : users.findAllById(
                candidates.stream().map(CalendarReminder::getUserId).distinct().toList())) {
            userCache.put(u.getId(), u);
        }

        // One wall-clock reading for the whole run. Read per-reminder, it drifts forward
        // as the blocking sends below take time, so late entries in a long run would miss
        // their own delivery window and never fire that day.
        Instant tick = Instant.now();

        // A tick can straddle two calendar dates because users sit in different
        // zones, so ask for the days actually in play rather than just "today".
        Set<LocalDate> days = new HashSet<>();
        for (CalendarReminder rem : candidates) {
            User u = userCache.get(rem.getUserId());
            if (u != null) {
                days.add(LocalDateTime.ofInstant(tick, UserZone.of(u.getTimezone())).toLocalDate());
            }
        }
        Set<String> alreadySent = new HashSet<>();
        if (!days.isEmpty()) {
            for (Object[] row : dispatchLog.findDelivered(
                    candidates.stream().map(CalendarReminder::getId).toList(), days)) {
                alreadySent.add(sentKey((UUID) row[0], (LocalDate) row[1]));
            }
        }

        List<Callable<Void>> sends = new ArrayList<>();
        for (CalendarReminder rem : candidates) {
            User user = userCache.get(rem.getUserId());
            if (user == null) {
                continue;
            }
            boolean waEligible = whatsapp.isConfigured() && user.isWhatsappEnabled()
                    && StringUtils.hasText(user.getWhatsappNumber());

            ZoneId zone = UserZone.of(user.getTimezone());
            LocalDateTime now = LocalDateTime.ofInstant(tick, zone);
            LocalDate day = now.toLocalDate();
            // The user object is already in hand from the batch read above, so the
            // working week costs nothing extra here.
            if (!reminderService.occursOn(rem, day, WorkWeek.fromPrefs(user.getUiPrefs()))) {
                continue;
            }

            LocalDateTime scheduledAt = LocalDateTime.of(day, rem.getTime());
            if (now.isBefore(scheduledAt) || now.isAfter(scheduledAt.plus(CATCH_UP))) {
                continue;
            }

            // Only a delivered occurrence blocks a resend; a failed one is retried on a
            // later tick while the window is open. Read from the batch above.
            if (alreadySent.contains(sentKey(rem.getId(), day))) {
                continue;
            }

            boolean wa = waEligible;
            sends.add(() -> {
                deliver(user, rem, day, wa);
                return null;
            });
        }

        if (sends.isEmpty()) {
            return;
        }
        try {
            // Blocks until the batch drains, so every dispatch-log row for this tick is
            // written before the next one reads it back for de-duplication.
            senders.invokeAll(sends);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
    }

    /** Matches the dispatch-log row for one reminder on one occurrence date. */
    private static String sentKey(UUID reminderId, LocalDate day) {
        return reminderId + "|" + day;
    }

    private void deliver(User user, CalendarReminder rem, LocalDate day, boolean waEligible) {
        ReminderDispatchLog row = new ReminderDispatchLog();
        row.setReminderId(rem.getId());
        row.setOccurrenceDate(day);
        StringBuilder channels = new StringBuilder();
        boolean sent = false;

        // The bell first, and unconditionally: it is the only channel that works
        // for every user, and publish() also pushes the card down the websocket,
        // so an open app shows the reminder the minute it is due.
        try {
            notifications.publish(user.getId(), NotificationKind.reminder,
                    rem.getText(), "Reminder for " + rem.getTime(), rem.getId());
            channels.append("app");
            sent = true;
        } catch (Exception ex) {
            log.warn("In-app reminder {} for {} failed: {}", rem.getId(), user.getId(), ex.getMessage());
        }

        if (waEligible) {
            try {
                whatsapp.sendReminder(user.getWhatsappNumber(), rem.getText());
                channels.append(channels.length() > 0 ? "+whatsapp" : "whatsapp");
                sent = true;
            } catch (Exception ex) {
                row.setErrorMessage(truncate(ex.getMessage(), 250));
                log.warn("WhatsApp reminder {} for {} failed: {}", rem.getId(), user.getId(), ex.getMessage());
            }
        }
        if (push.isConfigured()) {
            try {
                int n = push.sendToUser(user.getId(), "Reminder",
                        rem.getText(), "/#calendar");
                if (n > 0) {
                    channels.append(channels.length() > 0 ? "+push" : "push");
                    sent = true;
                }
            } catch (Exception ex) {
                log.warn("Push reminder {} for {} failed: {}", rem.getId(), user.getId(), ex.getMessage());
            }
        }

        row.setChannel(channels.length() > 0 ? channels.toString() : "none");
        row.setStatus(sent ? "sent" : "failed");
        dispatchLog.save(row);
    }


    private static String truncate(String input, int max) {
        if (input == null || input.length() <= max) {
            return input;
        }
        return input.substring(0, max);
    }
}
