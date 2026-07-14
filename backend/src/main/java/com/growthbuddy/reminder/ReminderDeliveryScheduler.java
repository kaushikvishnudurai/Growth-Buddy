package com.growthbuddy.reminder;

import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Polls timed reminders and dispatches WhatsApp messages near their local
 * due-time in each user's timezone.
 */
@Component
public class ReminderDeliveryScheduler {

    private static final Logger log = LoggerFactory.getLogger(ReminderDeliveryScheduler.class);

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
            com.growthbuddy.push.PushService push) {
        this.reminders = reminders;
        this.dispatchLog = dispatchLog;
        this.reminderService = reminderService;
        this.users = users;
        this.whatsapp = whatsapp;
        this.push = push;
    }

    private final com.growthbuddy.push.PushService push;

    // Not @Transactional: this loop makes a blocking WhatsApp HTTP call per due
    // reminder; a loop-wide transaction would pin one DB connection for the whole
    // run. Each dispatchLog.save() is its own short transaction.
    @Scheduled(cron = "0 * * * * *")
    public void dispatchTimedWhatsAppReminders() {
        // Nothing to deliver over if neither channel is set up.
        if (!whatsapp.isConfigured() && !push.isConfigured()) {
            return;
        }

        List<CalendarReminder> candidates = reminders.findByTimeIsNotNull();
        if (candidates.isEmpty()) {
            return;
        }

        Map<UUID, User> userCache = new HashMap<>();
        for (CalendarReminder rem : candidates) {
            User user = userCache.computeIfAbsent(rem.getUserId(), this::loadUser);
            if (user == null) {
                continue;
            }
            boolean waEligible = whatsapp.isConfigured() && user.isWhatsappEnabled()
                    && StringUtils.hasText(user.getWhatsappNumber());
            boolean pushEligible = push.isConfigured();
            if (!waEligible && !pushEligible) {
                continue;
            }

            ZoneId zone = parseZone(user.getTimezone());
            LocalDateTime now = LocalDateTime.now(zone);
            LocalDate day = now.toLocalDate();
            if (!reminderService.occursOn(rem, day)) {
                continue;
            }

            LocalDateTime scheduledAt = LocalDateTime.of(day, rem.getTime());
            if (now.isBefore(scheduledAt) || now.isAfter(scheduledAt.plusMinutes(1))) {
                continue;
            }

            if (dispatchLog.existsByReminderIdAndOccurrenceDate(rem.getId(), day)) {
                continue;
            }

            ReminderDispatchLog row = new ReminderDispatchLog();
            row.setReminderId(rem.getId());
            row.setOccurrenceDate(day);
            StringBuilder channels = new StringBuilder();
            boolean sent = false;

            if (waEligible) {
                try {
                    whatsapp.sendReminder(user.getWhatsappNumber(), buildMessage(user, rem, day));
                    channels.append("whatsapp");
                    sent = true;
                } catch (Exception ex) {
                    row.setErrorMessage(truncate(ex.getMessage(), 250));
                    log.warn("WhatsApp reminder {} for {} failed: {}", rem.getId(), user.getId(), ex.getMessage());
                }
            }
            if (pushEligible) {
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
    }

    private User loadUser(UUID userId) {
        return users.findById(userId).orElse(null);
    }

    private static ZoneId parseZone(String id) {
        try {
            return ZoneId.of(id);
        } catch (Exception ex) {
            return ZoneId.of("UTC");
        }
    }

    private static String buildMessage(User user, CalendarReminder rem, LocalDate day) {
        String name = (user.getDisplayName() == null || user.getDisplayName().isBlank()) ? "Buddy" : user.getDisplayName();
        return "Hi " + name + ", reminder for " + day + ": " + rem.getText();
    }

    private static String truncate(String input, int max) {
        if (input == null || input.length() <= max) {
            return input;
        }
        return input.substring(0, max);
    }
}
