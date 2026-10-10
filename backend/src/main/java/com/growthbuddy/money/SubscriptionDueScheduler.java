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
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
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
    private final Retries retries = new Retries();

    public SubscriptionDueScheduler(UserRepository users, MoneyRepository money,
                                    ReminderDispatchLogRepository dispatchLog, WhatsAppService whatsapp) {
        this.users = users;
        this.money = money;
        this.dispatchLog = dispatchLog;
        this.whatsapp = whatsapp;
    }

    // The database picks the users first, on money_state.sub_due_days: only someone
    // with a subscription due around today has their document read at all. It used
    // to parse every WhatsApp user's document on every tick.
    @Scheduled(cron = "0 */15 * * * *")
    public void dispatch() {
        if (!whatsapp.isConfigured()) {
            return;
        }
        List<UUID> ids = money.findWhatsappUserIdsDueOn(dueMaskAround(LocalDate.now(ZoneOffset.UTC)))
                .stream().map(UUID::fromString).toList();
        if (ids.isEmpty()) {
            return;
        }
        for (User user : users.findAllById(ids)) {
            if (user.isPendingDeletion()) {
                continue; // scheduled for deletion: no bill-due WhatsApp in the grace period
            }
            // One user's failure (a blank legacy number, a DB error) must not skip every
            // user after them: the list comes back in the same order every tick, so it
            // would block the same people all day.
            try {
                ZonedDateTime now = ZonedDateTime.now(UserZone.of(user.getTimezone()));
                if (now.getHour() < SEND_HOUR) {
                    continue;
                }
                LocalDate day = now.toLocalDate();
                MoneyState state = money.findById(user.getId()).orElse(null);
                JsonNode data = state == null ? null : state.getData();
                if (state != null && state.getSubDueDays() == null) {
                    money.fillDueDays(user.getId(), dueDayMask(data));
                }
                for (JsonNode sub : dueToday(data, day)) {
                    String subId = sub.path("id").asText();
                    // The dispatch log wants a UUID; a stable one per (user, subscription)
                    // reuses its de-dupe without a table of our own.
                    UUID key = UUID.nameUUIDFromBytes(
                            ("sub:" + user.getId() + ":" + subId).getBytes(StandardCharsets.UTF_8));
                    if (dispatchLog.existsByReminderIdAndOccurrenceDate(key, day)
                            || !retries.due(key, day, System.currentTimeMillis())) {
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
                        String why = String.valueOf(ex.getMessage());
                        if (!ex.permanent()) {
                            // No row: a network blip or a 5xx is tried again on a later tick,
                            // backing off, at most MAX_ATTEMPTS a day. The last one writes the
                            // failed row below, so the cap holds across instances and restarts.
                            if (!retries.recordFailure(key, day, System.currentTimeMillis())) {
                                continue;
                            }
                            why = "gave up after " + Retries.MAX_ATTEMPTS + " attempts: " + why;
                        }
                        // A 4xx fails the same way every time, so it is recorded once and left:
                        // the unique (id, day) index allows one row, and resending is pointless.
                        row.setStatus("failed");
                        row.setErrorMessage(why.substring(0, Math.min(250, why.length())));
                    }
                    dispatchLog.save(row);
                }
            } catch (RuntimeException ex) {
                log.warn("Subscription reminders for {} skipped this tick: {}", user.getId(), ex.getMessage());
            }
        }
    }

    /**
     * Transient-failure budget per (subscription, day): {@link #MAX_ATTEMPTS} tries,
     * each retry waiting twice as long as the last (the next tick, then two ticks), so a Meta
     * outage costs three calls per subscription instead of one every tick all day.
     *
     * <p>ponytail: the backoff clock is in memory, per instance. A restart or a
     * second instance can retry sooner than the backoff says — never more than
     * {@link #MAX_ATTEMPTS} per instance, and the give-up row is in the shared
     * dispatch log, so the first instance to exhaust its budget stops every other.
     * Persist the attempt count if that ever matters.
     */
    static final class Retries {
        static final int MAX_ATTEMPTS = 3;
        /** Just under one 15-minute tick, so a tick that runs a little early still qualifies. */
        static final long FIRST_BACKOFF_MS = 14 * 60_000L;

        private record State(LocalDate day, int failures, long nextTryMs) { }

        private final Map<UUID, State> byKey = new ConcurrentHashMap<>();

        /** Whether this subscription may be tried now — false while backing off. */
        boolean due(UUID key, LocalDate day, long nowMs) {
            State st = byKey.get(key);
            return st == null || !st.day().equals(day) || nowMs >= st.nextTryMs();
        }

        /** Count a transient failure; {@code true} once the day's budget is spent. */
        boolean recordFailure(UUID key, LocalDate day, long nowMs) {
            // Yesterday's entries are dead weight; a key re-seen today replaces its own.
            byKey.values().removeIf(st -> !st.day().equals(day));
            State prev = byKey.get(key);
            int failures = (prev == null ? 0 : prev.failures()) + 1;
            if (failures >= MAX_ATTEMPTS) {
                byKey.remove(key);
                return true;
            }
            byKey.put(key, new State(day, failures, nowMs + (FIRST_BACKOFF_MS << (failures - 1))));
            return false;
        }
    }

    /** Bit (d - 1) per subscription due on day d, clamped to 1..31 as {@link #dueToday} clamps. */
    static int dueDayMask(JsonNode data) {
        int mask = 0;
        if (data == null || !data.path("subscriptions").isArray()) {
            return mask;
        }
        for (JsonNode sub : data.get("subscriptions")) {
            if (!sub.path("id").asText().isEmpty()) {
                mask |= 1 << (Math.min(Math.max(sub.path("dueDay").asInt(1), 1), 31) - 1);
            }
        }
        return mask;
    }

    /**
     * Every due day that can be "today" somewhere while it is {@code utcToday} in UTC:
     * zones run from UTC-12 to UTC+14, so yesterday, today and tomorrow. On a month's
     * last day the days past its end count too — dueToday treats a 31st as the 30th.
     * Wider than any one user needs; dueToday makes the exact call.
     */
    static int dueMaskAround(LocalDate utcToday) {
        int mask = 0;
        for (int i = -1; i <= 1; i++) {
            LocalDate d = utcToday.plusDays(i);
            mask |= 1 << (d.getDayOfMonth() - 1);
            if (d.getDayOfMonth() == d.lengthOfMonth()) {
                for (int day = d.getDayOfMonth() + 1; day <= 31; day++) {
                    mask |= 1 << (day - 1);
                }
            }
        }
        return mask;
    }

    /**
     * Mirrors {@code upcomingSubs} in money.js: a day past the month's end means its last day.
     * Paid is forward-only, as in {@link MoneyService#applyPaid}: a bill paid ahead (paidFor
     * a later month) is not due, and one with no amount is skipped, since its "Mark as paid"
     * button could book nothing.
     */
    static List<JsonNode> dueToday(JsonNode data, LocalDate day) {
        List<JsonNode> out = new ArrayList<>();
        if (data == null || !data.path("subscriptions").isArray()) {
            return out;
        }
        String month = YearMonth.from(day).toString();
        for (JsonNode sub : data.get("subscriptions")) {
            int due = Math.min(Math.max(sub.path("dueDay").asInt(1), 1), day.lengthOfMonth());
            // "YYYY-MM" strings order the same as the months they name.
            boolean paid = month.compareTo(sub.path("paidFor").asText("")) <= 0;
            if (due == day.getDayOfMonth() && !paid && sub.path("amount").asDouble(0) > 0
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
