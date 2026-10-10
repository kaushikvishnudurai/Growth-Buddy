package com.growthbuddy.reminder;

import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import com.growthbuddy.common.DeliveryCache;
import com.growthbuddy.common.UserZone;
import com.growthbuddy.common.WorkWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
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
import org.springframework.dao.DataIntegrityViolationException;
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
            NotificationService notifications,
            SnoozeLinks snoozeLinks,
            ReminderDoneRepository doneRepo) {
        this.doneRepo = doneRepo;
        this.reminders = reminders;
        this.dispatchLog = dispatchLog;
        this.reminderService = reminderService;
        this.users = users;
        this.whatsapp = whatsapp;
        this.push = push;
        this.notifications = notifications;
        this.snoozeLinks = snoozeLinks;
    }

    private final SnoozeLinks snoozeLinks;

    /** Occurrences checked off in the app: never delivered. */
    private final ReminderDoneRepository doneRepo;

    private final NotificationService notifications;

    private final com.growthbuddy.push.PushService push;

    // Candidate list from the last load; see DeliveryCache. Only the scheduler
    // thread touches these, and Spring never overlaps two runs of one cron task.
    private List<CalendarReminder> snapshot = List.of();
    private Map<UUID, User> snapshotUsers = Map.of();
    private long snapshotVersion;
    private Instant snapshotAt;

    // Not @Transactional: this loop makes a blocking WhatsApp HTTP call per due
    // reminder; a loop-wide transaction would pin one DB connection for the whole
    // run. Each dispatchLog.save() is its own short transaction.
    @Scheduled(cron = "0 * * * * *")
    public void dispatchTimedWhatsAppReminders() {
        // One wall-clock reading for the whole run. Read per-reminder, it drifts forward
        // as the blocking sends below take time, so late entries in a long run would miss
        // their own delivery window and never fire that day.
        Instant tick = Instant.now();

        // No early exit on WhatsApp/push any more: the bell is a channel too, and
        // it needs no configuration at all. A reminder set on a phone with
        // notifications refused still turns up in the app.
        if (DeliveryCache.stale(snapshotVersion, snapshotAt, tick)) {
            long version = DeliveryCache.version();
            snapshot = reminders.findDeliverable(true, whatsapp.isConfigured(), push.isConfigured());
            snapshotUsers = usersById(snapshot);
            snapshotVersion = version;
            snapshotAt = tick;
        }

        // Most ticks end here without touching the database: nothing is due.
        List<UUID> dueIds = new ArrayList<>();
        for (CalendarReminder rem : snapshot) {
            User u = snapshotUsers.get(rem.getUserId());
            if (dueDay(rem, u, tick) != null || secondDueDay(rem, u, tick) != null || snoozeDue(rem, tick)) {
                dueIds.add(rem.getId());
            }
        }
        if (dueIds.isEmpty()) {
            return;
        }

        // The due few are read fresh, so a send always uses the current text,
        // number and settings, and one deleted by bulk SQL is simply gone.
        List<CalendarReminder> candidates = reminders.findAllById(dueIds).stream()
                .filter(r -> r.getTime() != null).toList();
        if (candidates.isEmpty()) {
            return;
        }

        // Two batch reads replace a per-reminder lookup each, so the due set
        // costs three queries whatever the user count.
        Map<UUID, User> userCache = usersById(candidates);

        // A tick can straddle two calendar dates because users sit in different
        // zones, and a lead can ring tomorrow's occurrence today, so ask for the
        // occurrence days actually in play rather than just "today".
        Map<UUID, LocalDate> dueDays = new HashMap<>();
        Map<UUID, LocalDate> secondDays = new HashMap<>();
        for (CalendarReminder rem : candidates) {
            User u = userCache.get(rem.getUserId());
            LocalDate d = dueDay(rem, u, tick);
            if (d != null) {
                dueDays.put(rem.getId(), d);
            }
            LocalDate d2 = secondDueDay(rem, u, tick);
            if (d2 != null) {
                secondDays.put(rem.getId(), d2);
            }
        }
        Set<LocalDate> days = new HashSet<>(dueDays.values());
        days.addAll(secondDays.values());
        Set<String> alreadySent = new HashSet<>();
        Set<String> checkedOff = new HashSet<>();
        if (!days.isEmpty()) {
            List<UUID> ids = candidates.stream().map(CalendarReminder::getId).toList();
            // The second alert de-dupes under its own name-derived id (secondAlertId),
            // so it needs no column of its own in the log.
            List<UUID> logIds = new ArrayList<>(ids);
            for (UUID id : secondDays.keySet()) {
                logIds.add(secondAlertId(id));
            }
            for (Object[] row : dispatchLog.findDelivered(logIds, days)) {
                alreadySent.add(sentKey((UUID) row[0], (LocalDate) row[1]));
            }
            for (Object[] row : doneRepo.findDone(ids, days)) {
                checkedOff.add(sentKey((UUID) row[0], (LocalDate) row[1]));
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

            boolean wa = waEligible;
            if (snoozeDue(rem, tick)) {
                Instant at = rem.getSnoozedUntil();
                sends.add(() -> {
                    try {
                        deliverSnooze(user, rem, at, wa, tick);
                    } catch (Exception ex) {
                        log.warn("Snoozed reminder {} for {} failed: {}",
                                rem.getId(), user.getId(), ex.getMessage());
                    }
                    return null;
                });
            }

            // The first alert and the second, each its own occurrence in the log.
            for (int alert = 1; alert <= 2; alert++) {
                LocalDate day = (alert == 1 ? dueDays : secondDays).get(rem.getId());
                if (day == null) {
                    continue;
                }
                // Checked off in the app: it has been dealt with, so nothing rings.
                if (checkedOff.contains(sentKey(rem.getId(), day))) {
                    continue;
                }
                UUID logId = alert == 1 ? rem.getId() : secondAlertId(rem.getId());
                // Only a delivered occurrence blocks a resend; a failed one is retried on a
                // later tick while the window is open. Read from the batch above.
                if (alreadySent.contains(sentKey(logId, day))) {
                    continue;
                }

                sends.add(() -> {
                    try {
                        deliver(user, rem, day, wa, tick, logId);
                    } catch (Exception ex) {
                        // invokeAll() parks a Callable's exception in a Future nobody reads,
                        // so without this a failing dispatch-log write was completely silent.
                        log.warn("Reminder dispatch {} for {} failed: {}",
                                rem.getId(), user.getId(), ex.getMessage());
                    }
                    return null;
                });
            }
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

    private Map<UUID, User> usersById(List<CalendarReminder> rems) {
        Map<UUID, User> out = new HashMap<>();
        for (User u : users.findAllById(
                rems.stream().map(CalendarReminder::getUserId).distinct().toList())) {
            // Left out, an account scheduled for deletion reads as "no user": its
            // reminders are never due, on any channel (bell, WhatsApp, push).
            if (!u.isPendingDeletion()) {
                out.put(u.getId(), u);
            }
        }
        return out;
    }

    /**
     * The occurrence day this reminder is ringing for at {@code tick}, or null.
     * It rings {@code lead} minutes ahead of its time (its own notifyBefore, else
     * the user's default), which can be the evening before; and the catch-up
     * window can carry a 23:58 one past midnight. So yesterday, today and
     * tomorrow are each tried — the window first, as it is the cheap test.
     *
     * <p>When the early ring's window has gone, it rings on time instead, as
     * scripts/push.js does on the device: a reminder made, or edited, inside its
     * own lead still rings once. Both rings share the (reminder, day) log key, so
     * one already sent early blocks the on-time one.
     */
    private LocalDate dueDay(CalendarReminder rem, User user, Instant tick) {
        if (user == null || rem.getTime() == null) {
            return null;
        }
        ZoneId zone = UserZone.of(user.getTimezone());
        Duration lead = Duration.ofMinutes(ReminderPrefs.leadFor(rem, user.getUiPrefs()));
        LocalDate today = LocalDateTime.ofInstant(tick, zone).toLocalDate();
        for (int offset = -1; offset <= 1; offset++) {
            LocalDate day = today.plusDays(offset);
            if (!inWindow(ringAt(day, rem.getTime(), zone, lead), tick)
                    && (lead.isZero() || !inWindow(ringAt(day, rem.getTime(), zone, Duration.ZERO), tick))) {
                continue;
            }
            // The user object is already in hand from the batch read, so the
            // working week costs nothing extra here.
            if (reminderService.occursOn(rem, day, WorkWeek.fromPrefs(user.getUiPrefs()))) {
                return day;
            }
        }
        return null;
    }

    /**
     * The occurrence day the SECOND alert ({@code notify_before2}) rings for at
     * {@code tick}, or null. No catch-up to on-time like the first: if it had
     * already gone when the reminder was made, the first alert covers it; and it
     * is dropped when it would ring at the same moment the first one does.
     */
    private LocalDate secondDueDay(CalendarReminder rem, User user, Instant tick) {
        if (user == null || rem.getTime() == null || rem.getNotifyBefore2() == null) {
            return null;
        }
        int lead1 = ReminderPrefs.leadFor(rem, user.getUiPrefs());
        Integer lead2 = ReminderPrefs.secondLeadFor(rem, lead1);
        if (lead2 == null) {
            return null;
        }
        ZoneId zone = UserZone.of(user.getTimezone());
        LocalDate today = LocalDateTime.ofInstant(tick, zone).toLocalDate();
        for (int offset = -1; offset <= 1; offset++) {
            LocalDate day = today.plusDays(offset);
            Instant at = ringAt(day, rem.getTime(), zone, Duration.ofMinutes(lead2));
            if (!inWindow(at, tick)) {
                continue;
            }
            Instant created = rem.getCreatedAt();
            if (created != null && created.isAfter(at)) {
                continue;
            }
            Instant first = ringAt(day, rem.getTime(), zone, Duration.ofMinutes(lead1));
            if (lead1 > 0 && created != null && created.isAfter(first)) {
                first = ringAt(day, rem.getTime(), zone, Duration.ZERO);
            }
            if (first.equals(at)) {
                continue;
            }
            if (reminderService.occursOn(rem, day, WorkWeek.fromPrefs(user.getUiPrefs()))) {
                return day;
            }
        }
        return null;
    }

    /** The dispatch-log key of a reminder's second alert: name-derived, so stable across runs. */
    static UUID secondAlertId(UUID reminderId) {
        return UUID.nameUUIDFromBytes(("reminder-alert2:" + reminderId).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    /**
     * When an occurrence rings: its local time on that day, less the lead.
     * Zone-aware, not a bare LocalDateTime. On the morning clocks spring
     * forward an hour simply does not happen locally: a 02:30 reminder's
     * window (02:30 → 02:35 local) never arrives, and it was skipped
     * without a word. ZonedDateTime.of resolves a time inside the gap to
     * the first instant that does exist — 02:30 becomes 03:30 — so it
     * fires late rather than never. On the autumn morning the hour
     * repeats it picks the earlier offset and the dispatch log, keyed on
     * the day, stops the second pass resending.
     */
    static Instant ringAt(LocalDate day, java.time.LocalTime time, ZoneId zone, Duration lead) {
        return ZonedDateTime.of(day, time, zone).toInstant().minus(lead);
    }

    static boolean inWindow(Instant at, Instant tick) {
        return !tick.isBefore(at) && !tick.isAfter(at.plus(CATCH_UP));
    }

    /** Is a snooze on this reminder due at {@code tick}? Same grace as the reminder itself. */
    static boolean snoozeDue(CalendarReminder rem, Instant tick) {
        return rem.getSnoozedUntil() != null && inWindow(rem.getSnoozedUntil(), tick);
    }

    /** Matches the dispatch-log row for one reminder on one occurrence date. */
    private static String sentKey(UUID reminderId, LocalDate day) {
        return reminderId + "|" + day;
    }

    /** {@code logId}: the reminder's id for its first alert, {@link #secondAlertId} for the second. */
    private void deliver(User user, CalendarReminder rem, LocalDate day, boolean waEligible, Instant tick,
                         UUID logId) {
        // Write-ahead: claim the occurrence BEFORE sending. Logging after the send
        // left two ways to repeat it on every tick of the catch-up window: a crash
        // between send and save, and — worse — a retry after a 'failed' row, whose
        // fresh insert hit ux_rem_dispatch_unique every time and so never recorded
        // that it had sent. A retry now reuses the failed row. A crash mid-send
        // leaves 'sending', which counts as delivered: at most once, never five.
        ReminderDispatchLog row = dispatchLog
                .findByReminderIdAndOccurrenceDate(logId, day)
                .orElseGet(ReminderDispatchLog::new);
        if (row.getStatus() != null) {
            // A retry claims the failed row with one conditional UPDATE: of two
            // instances that both read 'failed', only one moves it, and only it sends.
            if (!"failed".equals(row.getStatus()) || dispatchLog.claimFailed(row.getId()) != 1) {
                return;
            }
            row.setStatus("sending");
            row.setErrorMessage(null);
        } else {
            row.setReminderId(logId);
            row.setOccurrenceDate(day);
            row.setChannel("none");
            row.setStatus("sending");
            try {
                dispatchLog.saveAndFlush(row);
            } catch (DataIntegrityViolationException ex) {
                return; // another run claimed it first
            }
        }
        // What is actually left, not the lead: a reminder made inside its own lead
        // rings on time, and a catch-up tick can ring a minute or two late.
        String time = String.valueOf(rem.getTime());
        long secondsLeft = Duration.between(tick,
                ZonedDateTime.of(day, rem.getTime(), UserZone.of(user.getTimezone())).toInstant()).getSeconds();
        int left = (int) Math.max(0, (secondsLeft + 59) / 60);
        String in = ReminderPrefs.human(left);
        Outcome out = send(user, rem, day, waEligible, tick,
                left > 0 ? "At " + time + " · in " + in : "Reminder for " + time,
                left > 0 ? rem.getText() + " (at " + time + ", in " + in + ")" : rem.getText(),
                "Reminder");
        if (out.error() != null) {
            row.setErrorMessage(truncate(out.error(), 250));
        }
        row.setChannel(out.channels());
        row.setStatus(out.sent() ? "sent" : "failed");
        dispatchLog.save(row);
    }

    /**
     * How long a claimed snooze may sit 'pending' before the sweeper takes its send
     * for dead and rings it again. Well past the longest send can take (WhatsApp's
     * 8 s connect + 10 s request), so a slow send is not mistaken for a lost one.
     */
    static final Duration SNOOZE_STUCK = Duration.ofMinutes(2);

    /** Resends the sweeper makes of one snooze before it marks it 'failed': three tries in all. */
    static final int SNOOZE_RESENDS = 2;

    /** Absent only in unit tests, which then claim without one (nothing to roll back in a mock). */
    private org.springframework.transaction.support.TransactionTemplate tx;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void setTransactionManager(org.springframework.transaction.PlatformTransactionManager tm) {
        this.tx = new org.springframework.transaction.support.TransactionTemplate(tm);
    }

    /** The dispatch-log key of one snooze: name-derived from (reminder, snoozed_until), like secondAlertId. */
    static UUID snoozeLogId(UUID reminderId, Instant at) {
        return UUID.nameUUIDFromBytes(("reminder-snooze:" + reminderId + "@" + at)
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    /**
     * Ring a snooze: at least once, and not five times. One transaction writes
     * the snooze's 'pending' dispatch-log row and clears snoozed_until — only if
     * it still holds the value this run read, so a snooze moved or cancelled
     * meanwhile sends nothing. The row's key is (snoozeLogId, day), so
     * ux_rem_dispatch_unique lets exactly one instance take a given snooze; the
     * loser's insert fails and it sends nothing. Then the send, then 'sent'. A
     * crash between claim and send leaves 'pending', which {@link #resendStuckSnoozes}
     * rings again after SNOOZE_STUCK, up to SNOOZE_RESENDS times. ponytail: the
     * window is at-least-once — a crash after the send but before 'sent' rings it
     * twice; a second ring of a snooze beats a silently lost one.
     */
    private void deliverSnooze(User user, CalendarReminder rem, Instant at, boolean waEligible, Instant tick) {
        ReminderDispatchLog row = new ReminderDispatchLog();
        row.setReminderId(snoozeLogId(rem.getId(), at));
        row.setOccurrenceDate(LocalDate.ofInstant(at, java.time.ZoneOffset.UTC));
        row.setSnoozeOf(rem.getId());
        row.setChannel("none");
        row.setStatus("pending");
        row.setAttempts(1);
        if (!claimSnooze(row, rem.getId(), at)) {
            return;
        }
        DeliveryCache.changed();
        settleSnooze(row.getId(), 1, sendSnooze(user, rem, waEligible, tick));
    }

    /** Thrown inside the claim to roll its row back: the snooze moved or was cancelled. */
    private static final class SnoozeMoved extends RuntimeException {
        SnoozeMoved() {
            super(null, null, false, false);
        }
    }

    private boolean claimSnooze(ReminderDispatchLog row, UUID reminderId, Instant at) {
        java.util.function.Supplier<Boolean> claim = () -> {
            dispatchLog.saveAndFlush(row);
            if (reminders.claimSnooze(reminderId, at) != 1) {
                throw new SnoozeMoved();
            }
            return Boolean.TRUE;
        };
        try {
            return tx != null ? Boolean.TRUE.equals(tx.execute(s -> claim.get())) : claim.get();
        } catch (SnoozeMoved ex) {
            if (tx == null) {
                dispatchLog.delete(row); // no transaction rolled it back
            }
            return false;
        } catch (DataIntegrityViolationException ex) {
            return false; // another instance holds this snooze's row: it sends, not us
        } catch (RuntimeException ex) {
            // Rolled back, so snoozed_until still stands and the next tick tries again.
            log.warn("Claiming snooze of reminder {} failed: {}", reminderId, ex.getMessage());
            return false;
        }
    }

    private Outcome sendSnooze(User user, CalendarReminder rem, boolean waEligible, Instant tick) {
        String time = String.valueOf(rem.getTime());
        // A snooze rings the day it rings: its ticket is good for that local day.
        LocalDate day = LocalDate.ofInstant(tick, UserZone.of(user.getTimezone()));
        return send(user, rem, day, waEligible, tick, "Snoozed · was due at " + time,
                rem.getText() + " (snoozed, was " + time + ")", "Snoozed reminder");
    }

    /** {@code attempts}: sends tried so far, this one included. A miss under the cap stays 'pending' for the sweeper. */
    private void settleSnooze(UUID rowId, int attempts, Outcome out) {
        String status = out.sent() ? "sent" : attempts > SNOOZE_RESENDS ? "failed" : "pending";
        dispatchLog.settleSnooze(rowId, status, out.channels(), truncate(out.error(), 250));
    }

    /**
     * The other half of deliverSnooze's at-least-once: a snooze claimed but never
     * marked — its instance died mid-send, or nothing got through — is rung again
     * once it has been 'pending' SNOOZE_STUCK per try so far, and given up as
     * 'failed' after SNOOZE_RESENDS resends. claimResend makes each resend one
     * instance's: of two sweepers on the same row, only one sends.
     */
    @Scheduled(cron = "30 * * * * *")
    public void resendStuckSnoozes() {
        resendStuckSnoozes(Instant.now());
    }

    void resendStuckSnoozes(Instant now) {
        for (ReminderDispatchLog row : dispatchLog.findStuckSnoozes(now.minus(SNOOZE_STUCK))) {
            int tried = row.getAttempts();
            if (!"pending".equals(row.getStatus()) || row.getSnoozeOf() == null) {
                continue;
            }
            // Each try gets its own SNOOZE_STUCK before the next: claimed at T, resent at T+2, T+4.
            if (row.getCreatedAt() != null
                    && row.getCreatedAt().isAfter(now.minus(SNOOZE_STUCK.multipliedBy(Math.max(1, tried))))) {
                continue;
            }
            if (tried > SNOOZE_RESENDS) {
                dispatchLog.settleSnooze(row.getId(), "failed", row.getChannel(),
                        truncate("gave up after " + tried + " tries", 250));
                continue;
            }
            if (dispatchLog.claimResend(row.getId(), tried) != 1) {
                continue; // another instance took this resend
            }
            CalendarReminder rem = reminders.findById(row.getSnoozeOf()).orElse(null);
            // Scheduled for deletion counts as gone: its snooze is not rung again either.
            User user = rem == null ? null : users.findById(rem.getUserId())
                    .filter(u -> !u.isPendingDeletion()).orElse(null);
            if (rem == null || user == null || rem.getTime() == null) {
                dispatchLog.settleSnooze(row.getId(), "failed", row.getChannel(), "reminder gone");
                continue;
            }
            boolean wa = whatsapp.isConfigured() && user.isWhatsappEnabled()
                    && StringUtils.hasText(user.getWhatsappNumber());
            try {
                settleSnooze(row.getId(), tried + 1, sendSnooze(user, rem, wa, now));
            } catch (RuntimeException ex) {
                log.warn("Resending snooze of reminder {} failed: {}", rem.getId(), ex.getMessage());
            }
        }
    }

    record Outcome(String channels, boolean sent, String error) {
    }

    /** The three channels, each on its own: one failing never stops the next. */
    /** {@code day}: the occurrence this rings for, which the push's snooze ticket is tied to. */
    private Outcome send(User user, CalendarReminder rem, LocalDate day, boolean waEligible, Instant tick,
                         String bellBody, String waText, String pushTitle) {
        StringBuilder channels = new StringBuilder();
        boolean sent = false;
        String error = null;
        int snooze = ReminderPrefs.snoozeOf(user.getUiPrefs());

        // The bell first, and unconditionally: it is the only channel that works
        // for every user, and publish() also pushes the card down the websocket,
        // so an open app shows the reminder the minute it is due.
        try {
            notifications.publish(user.getId(), NotificationKind.reminder,
                    rem.getText(), bellBody, rem.getId());
            channels.append("app");
            sent = true;
        } catch (Exception ex) {
            log.warn("In-app reminder {} for {} failed: {}", rem.getId(), user.getId(), ex.getMessage());
        }

        if (waEligible) {
            try {
                whatsapp.sendSnoozableReminder(user.getWhatsappNumber(), waText, rem.getId(), snooze);
                channels.append(channels.length() > 0 ? "+whatsapp" : "whatsapp");
                sent = true;
            } catch (Exception ex) {
                error = ex.getMessage();
                log.warn("WhatsApp reminder {} for {} failed: {}", rem.getId(), user.getId(), ex.getMessage());
            }
        }
        if (push.isConfigured()) {
            try {
                // tag: a snooze replaces the card it came from rather than stacking
                // a second one. snooze: the signed ticket the service worker's
                // Snooze button sends, since it holds no session.
                int n = push.sendToUser(user.getId(), pushTitle, rem.getText(), "/#calendar", Map.of(
                        "tag", "rem-" + rem.getId(),
                        "snooze", snoozeLinks.sign(user.getId(), rem.getId(), day, tick),
                        "snoozeLabel", "Snooze " + ReminderPrefs.human(snooze)));
                if (n > 0) {
                    channels.append(channels.length() > 0 ? "+push" : "push");
                    sent = true;
                }
            } catch (Exception ex) {
                log.warn("Push reminder {} for {} failed: {}", rem.getId(), user.getId(), ex.getMessage());
            }
        }
        return new Outcome(channels.length() > 0 ? channels.toString() : "none", sent, error);
    }

    private static String truncate(String input, int max) {
        if (input == null || input.length() <= max) {
            return input;
        }
        return input.substring(0, max);
    }
}
