package com.growthbuddy.habit;

import com.growthbuddy.common.UserZone;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.push.PushService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Polls habits with a daily reminder time and delivers one near it in each
 * user's timezone: the in-app bell always, plus Web Push for users set up
 * for it. Mirrors {@link com.growthbuddy.reminder.ReminderDeliveryScheduler}
 * without the WhatsApp branch — habits have no such integration — and adds
 * one rule reminders don't have: a habit already checked in today doesn't
 * page anyone about it.
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

    public HabitReminderDeliveryScheduler(
            HabitRepository habits,
            HabitCheckinRepository checkins,
            HabitReminderDispatchLogRepository dispatchLog,
            UserRepository users,
            PushService push,
            NotificationService notifications) {
        this.habits = habits;
        this.checkins = checkins;
        this.dispatchLog = dispatchLog;
        this.users = users;
        this.push = push;
        this.notifications = notifications;
    }

    // Deliberately one query per candidate rather than the batched
    // dispatch-log read ReminderDeliveryScheduler uses: that batching earns
    // its complexity at "~1000 due reminders" scale (its own Javadoc). The
    // set of habits with a reminder time, across every user, is nowhere
    // near that yet — revisit if this tick ever shows up slow.
    @Scheduled(cron = "0 * * * * *")
    public void dispatchHabitReminders() {
        List<Habit> candidates = habits.findDeliverable(true, push.isConfigured());
        if (candidates.isEmpty()) {
            return;
        }

        Map<UUID, User> userCache = new HashMap<>();
        for (User u : users.findAllById(
                candidates.stream().map(Habit::getUserId).distinct().toList())) {
            userCache.put(u.getId(), u);
        }

        Instant tick = Instant.now();

        for (Habit habit : candidates) {
            User user = userCache.get(habit.getUserId());
            if (user == null) {
                continue;
            }
            ZoneId zone = UserZone.of(user.getTimezone());
            LocalDateTime now = LocalDateTime.ofInstant(tick, zone);
            LocalDate day = now.toLocalDate();

            // Zone-aware, not a bare LocalDateTime — see DstWindowTest for why.
            Instant scheduledAt = ZonedDateTime.of(day, habit.getReminderTime(), zone).toInstant();
            if (tick.isBefore(scheduledAt) || tick.isAfter(scheduledAt.plus(CATCH_UP))) {
                continue;
            }

            if (checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), day)) {
                continue;
            }

            if (dispatchLog.existsByHabitIdAndOccurrenceDateAndStatus(habit.getId(), day, "sent")) {
                continue;
            }

            deliver(user, habit, day);
        }
    }

    private void deliver(User user, Habit habit, LocalDate day) {
        HabitReminderDispatchLog row = new HabitReminderDispatchLog();
        row.setHabitId(habit.getId());
        row.setOccurrenceDate(day);
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

        if (push.isConfigured()) {
            try {
                int n = push.sendToUser(user.getId(), "Habit reminder", habit.getName(), "/#habits");
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
