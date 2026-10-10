package com.growthbuddy.habit;

import com.growthbuddy.common.DeliveryCache;
import com.growthbuddy.common.UserZone;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotifyCategory;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.push.PushService;
import com.growthbuddy.reminder.WhatsAppService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Polls habits with a daily reminder time and delivers one near it in each
 * user's timezone: the in-app bell always, plus WhatsApp and Web Push for
 * users set up for them. Mirrors {@link com.growthbuddy.reminder.ReminderDeliveryScheduler}
 * (it once left WhatsApp out, so a user who turned WhatsApp on got calendar
 * reminders there and habit reminders only in the app) and adds one rule
 * reminders don't have: a habit already checked in today doesn't page anyone
 * about it.
 */
@Component
public class HabitReminderDeliveryScheduler {

    private static final Logger log = LoggerFactory.getLogger(HabitReminderDeliveryScheduler.class);

    /** Same grace period as calendar reminders: a slow run must not skip a
     *  habit entirely. */
    private static final Duration CATCH_UP = Duration.ofMinutes(5);

    private final HabitRepository habits;
    private final HabitCheckinRepository checkins;
    private final HabitReminderDispatchLogRepository dispatchLog;
    private final UserRepository users;
    private final PushService push;
    private final NotificationService notifications;
    private final WhatsAppService whatsapp;

    public HabitReminderDeliveryScheduler(
            HabitRepository habits,
            HabitCheckinRepository checkins,
            HabitReminderDispatchLogRepository dispatchLog,
            UserRepository users,
            PushService push,
            NotificationService notifications,
            WhatsAppService whatsapp) {
        this.habits = habits;
        this.checkins = checkins;
        this.dispatchLog = dispatchLog;
        this.users = users;
        this.push = push;
        this.notifications = notifications;
        this.whatsapp = whatsapp;
    }

    // Candidate list from the last load; see DeliveryCache. Only the scheduler
    // thread touches these, and Spring never overlaps two runs of one cron task.
    private List<Habit> snapshot = List.of();
    private Map<UUID, User> snapshotUsers = Map.of();
    private long snapshotVersion;
    private Instant snapshotAt;

    // Deliberately one query per candidate rather than the batched
    // dispatch-log read ReminderDeliveryScheduler uses: that batching earns
    // its complexity at "~1000 due reminders" scale (its own Javadoc). The
    // set of habits with a reminder time, across every user, is nowhere
    // near that yet — revisit if this tick ever shows up slow.
    @Scheduled(cron = "0 * * * * *")
    public void dispatchHabitReminders() {
        Instant tick = Instant.now();

        if (DeliveryCache.stale(snapshotVersion, snapshotAt, tick)) {
            long version = DeliveryCache.version();
            snapshot = habits.findDeliverable(true, push.isConfigured());
            snapshotUsers = usersById(snapshot);
            snapshotVersion = version;
            snapshotAt = tick;
        }

        // Most ticks end here without touching the database: nothing is due.
        List<UUID> dueIds = new ArrayList<>();
        for (Habit habit : snapshot) {
            if (dueDay(habit, snapshotUsers.get(habit.getUserId()), tick) != null) {
                dueIds.add(habit.getId());
            }
        }
        if (dueIds.isEmpty()) {
            return;
        }

        // The due few are read fresh and re-checked against the same rules
        // findDeliverable applies, so a send always uses current data.
        List<Habit> candidates = habits.findAllById(dueIds).stream()
                .filter(h -> h.getReminderTime() != null && h.getDeletedAt() == null && h.isActive())
                .toList();
        if (candidates.isEmpty()) {
            return;
        }
        Map<UUID, User> userCache = usersById(candidates);

        for (Habit habit : candidates) {
            User user = userCache.get(habit.getUserId());
            if (user == null) {
                continue;
            }
            LocalDate day = dueDay(habit, user, tick);
            if (day == null) {
                continue;
            }

            if (checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), day)) {
                continue;
            }

            try {
                deliver(user, habit, day);
            } catch (Exception ex) {
                // deliver() already swallows per-channel failures; this guards the
                // dispatch-log writes themselves, so one bad row can't abort every
                // other candidate left in this tick.
                log.warn("Habit reminder dispatch {} for {} failed: {}", habit.getId(), user.getId(), ex.getMessage());
            }
        }
    }

    private Map<UUID, User> usersById(List<Habit> list) {
        Map<UUID, User> out = new HashMap<>();
        for (User u : users.findAllById(list.stream().map(Habit::getUserId).distinct().toList())) {
            // Scheduled for deletion = "no user": none of its habits is ever due.
            if (!u.isPendingDeletion()) {
                out.put(u.getId(), u);
            }
        }
        return out;
    }

    /** The user's local day if this habit is inside its reminder window at
     *  {@code tick}, else null. */
    private static LocalDate dueDay(Habit habit, User user, Instant tick) {
        if (user == null) {
            return null;
        }
        // Quiet hours hold back the nudges the app sends on its own; a habit
        // reminder is one. (A timed calendar reminder is not — see ReminderPrefs.)
        if (com.growthbuddy.reminder.ReminderPrefs.isQuiet(user.getUiPrefs(), habit.getReminderTime())) {
            return null;
        }
        ZoneId zone = UserZone.of(user.getTimezone());
        LocalDate day = LocalDateTime.ofInstant(tick, zone).toLocalDate();
        // Zone-aware, not a bare LocalDateTime — see DstWindowTest for why.
        Instant scheduledAt = ZonedDateTime.of(day, habit.getReminderTime(), zone).toInstant();
        if (tick.isBefore(scheduledAt) || tick.isAfter(scheduledAt.plus(CATCH_UP))) {
            return null;
        }
        return day;
    }

    private void deliver(User user, Habit habit, LocalDate day) {
        // Write-ahead, as in ReminderDeliveryScheduler.deliver: claim the day before
        // sending, reuse a 'failed' row on retry, and let a 'sending' row a crash
        // left behind count as delivered.
        HabitReminderDispatchLog row = dispatchLog
                .findByHabitIdAndOccurrenceDate(habit.getId(), day)
                .orElseGet(HabitReminderDispatchLog::new);
        if (row.getStatus() != null && !"failed".equals(row.getStatus())) {
            return;
        }
        row.setHabitId(habit.getId());
        row.setOccurrenceDate(day);
        row.setChannel("none");
        row.setStatus("sending");
        row.setErrorMessage(null);
        try {
            dispatchLog.saveAndFlush(row);
        } catch (DataIntegrityViolationException ex) {
            return; // another run claimed it first
        }
        StringBuilder channels = new StringBuilder();
        boolean sent = false;

        try {
            notifications.publish(user.getId(), NotificationKind.habit_reminder,
                    habit.getName(), "Reminder to " + habit.getName(), habit.getId());
            channels.append("app");
            sent = true;
        } catch (Exception ex) {
            log.warn("In-app habit reminder {} for {} failed: {}", habit.getId(), user.getId(), ex.getMessage());
        }

        if (whatsapp.isConfigured() && user.isWhatsappEnabled()
                && StringUtils.hasText(user.getWhatsappNumber())) {
            try {
                whatsapp.sendReminder(user.getWhatsappNumber(), "Time for your habit: " + habit.getName());
                channels.append(channels.length() > 0 ? "+whatsapp" : "whatsapp");
                sent = true;
            } catch (Exception ex) {
                row.setErrorMessage(truncate(ex.getMessage(), 250));
                log.warn("WhatsApp habit reminder {} for {} failed: {}", habit.getId(), user.getId(), ex.getMessage());
            }
        }

        if (push.isConfigured()) {
            try {
                int n = push.sendToUser(user.getId(), NotifyCategory.habits, "Habit reminder", habit.getName(), "/#habits");
                if (n > 0) {
                    channels.append(channels.length() > 0 ? "+push" : "push");
                    sent = true;
                }
            } catch (Exception ex) {
                row.setErrorMessage(truncate(ex.getMessage(), 250));
                log.warn("Push habit reminder {} for {} failed: {}", habit.getId(), user.getId(), ex.getMessage());
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
