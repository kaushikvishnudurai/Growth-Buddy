package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.growthbuddy.common.UserZone;
import com.growthbuddy.reminder.ReminderDispatchLog;
import com.growthbuddy.reminder.ReminderDispatchLogRepository;
import com.growthbuddy.reminder.WhatsAppService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * On a subscription's due day, WhatsApps the user a "due today" message with a
 * "Mark as paid" button ({@link WhatsAppWebhookController} handles the tap).
 */
@Component
public class SubscriptionDueScheduler {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionDueScheduler.class);

    /** Local hour the message goes out; later ticks the same day catch up after a sleep. */
    static final int SEND_HOUR = 9;

    private final UserRepository users;
    private final MoneyRepository money;
    private final ReminderDispatchLogRepository dispatchLog;
    private final WhatsAppService whatsapp;

    public SubscriptionDueScheduler(UserRepository users, MoneyRepository money,
                                    ReminderDispatchLogRepository dispatchLog, WhatsAppService whatsapp) {
        this.users = users;
        this.money = money;
        this.dispatchLog = dispatchLog;
        this.whatsapp = whatsapp;
    }

    // ponytail: scans every WhatsApp user's money blob each tick — fine for hundreds;
    // index due days in a column if that ever becomes thousands.
    @Scheduled(cron = "0 */15 * * * *")
    public void dispatch() {
        if (!whatsapp.isConfigured()) {
            return;
        }
        for (User user : users.findByWhatsappEnabledTrueAndWhatsappVerifiedTrueAndWhatsappNumberIsNotNull()) {
            // One user's failure (a blank legacy number, a DB error) must not skip every
            // user after them: the list comes back in the same order every tick, so it
            // would block the same people all day.
            try {
                ZonedDateTime now = ZonedDateTime.now(UserZone.of(user.getTimezone()));
                if (now.getHour() < SEND_HOUR) {
                    continue;
                }
                LocalDate day = now.toLocalDate();
                JsonNode data = money.findById(user.getId()).map(MoneyState::getData).orElse(null);
                for (JsonNode sub : dueToday(data, day)) {
                    String subId = sub.path("id").asText();
                    // The dispatch log wants a UUID; a stable one per (user, subscription)
                    // reuses its de-dupe without a table of our own.
                    UUID key = UUID.nameUUIDFromBytes(
                            ("sub:" + user.getId() + ":" + subId).getBytes(StandardCharsets.UTF_8));
                    if (dispatchLog.existsByReminderIdAndOccurrenceDate(key, day)) {
                        continue;
                    }
                    ReminderDispatchLog row = new ReminderDispatchLog();
                    row.setReminderId(key);
                    row.setOccurrenceDate(day);
                    row.setChannel("whatsapp");
                    try {
                        whatsapp.sendBillDue(user.getWhatsappNumber(),
                                message(sub, data.path("settings").path("currency").asText("₹")),
                                payload(subId, YearMonth.from(day)));
                        row.setStatus("sent");
                    } catch (WhatsAppService.SendFailed ex) {
                        log.warn("Subscription reminder {} for {} failed: {}", subId, user.getId(), ex.getMessage());
                        if (!ex.permanent()) {
                            // No row: a network blip or a 5xx is tried again next tick.
                            // ponytail: unbounded within the day (≤ ~60 tries if Meta is down
                            // all day); count attempts if that ever matters.
                            continue;
                        }
                        // A 4xx fails the same way every time, so it is recorded once and left:
                        // the unique (id, day) index allows one row, and resending is pointless.
                        row.setStatus("failed");
                        row.setErrorMessage(ex.getMessage().substring(0, Math.min(250, ex.getMessage().length())));
                    }
                    dispatchLog.save(row);
                }
            } catch (RuntimeException ex) {
                log.warn("Subscription reminders for {} skipped this tick: {}", user.getId(), ex.getMessage());
            }
        }
    }

    /** Mirrors {@code upcomingSubs} in money.js: a day past the month's end means its last day. */
    static List<JsonNode> dueToday(JsonNode data, LocalDate day) {
        List<JsonNode> out = new ArrayList<>();
        if (data == null || !data.path("subscriptions").isArray()) {
            return out;
        }
        String month = YearMonth.from(day).toString();
        for (JsonNode sub : data.get("subscriptions")) {
            int due = Math.min(Math.max(sub.path("dueDay").asInt(1), 1), day.lengthOfMonth());
            if (due == day.getDayOfMonth() && !month.equals(sub.path("paidFor").asText())
                    && !sub.path("id").asText().isEmpty()) {
                out.add(sub);
            }
        }
        return out;
    }

    static String message(JsonNode sub, String currency) {
        return sub.path("name").asText() + " is due today (" + currency + amount(sub.path("amount"))
                + "). Tap Mark as paid once it's done.";
    }

    /** Same grouping as money.js's {@code fmt}: rounded, en-IN (9,000 · 1,00,000). */
    static String amount(JsonNode n) {
        // By hand: java.text's DecimalFormat has one fixed grouping size and prints
        // 100,000 where the app (toLocaleString('en-IN')) shows 1,00,000.
        long v = Math.round(n.asDouble());
        String d = Long.toString(Math.abs(v));
        StringBuilder out = new StringBuilder(d.substring(Math.max(0, d.length() - 3)));
        for (int end = d.length() - 3; end > 0; end -= 2) {
            out.insert(0, d.substring(Math.max(0, end - 2), end) + ",");
        }
        return (v < 0 ? "-" : "") + out;
    }

    static String payload(String subId, YearMonth month) {
        return "paid:" + subId + ":" + month;
    }
}
