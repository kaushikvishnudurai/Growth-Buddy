package com.growthbuddy.mentor;

import com.growthbuddy.common.DeliveryCache;
import com.growthbuddy.common.UserZone;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationRepository;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.push.PushService;
import com.growthbuddy.reminder.ReminderDispatchLog;
import com.growthbuddy.reminder.ReminderDispatchLogRepository;
import com.growthbuddy.reminder.ReminderPrefs;
import com.growthbuddy.user.User;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Buddy's optional evening reflection: at the time in {@code ui_prefs.buddyReflection}
 * ("HH:MM", the user's LOCAL time; absent or blank = off, the default) the user
 * gets a bell card plus a Web Push that open Buddy with a starter question.
 *
 * <p>No model call: the prompt is fixed text, so it costs nothing against the AI
 * budget. The user's answer, if they give one, is an ordinary Buddy message.
 *
 * <p>Once per local day. The slot is built with {@code ZonedDateTime.of(day,
 * time, zone)} like reminders (on a spring-forward morning a bare local time
 * may not exist). Held for quiet hours the way habit reminders are: a reflection
 * set inside the window is skipped, not shifted.
 */
@Component
public class ReflectionScheduler {

    private static final Logger log = LoggerFactory.getLogger(ReflectionScheduler.class);

    static final String PREF = "buddyReflection";
    static final String TITLE = "Evening reflection";
    /** Also the question the Buddy screen prefills when opened from this card (mentor.js). */
    static final String STARTER = "How did today go? One thing that went well, and one thing you'd do differently.";
    /** The tick runs every 5 minutes; twice that tolerates one slow or skipped tick. */
    static final Duration WINDOW = Duration.ofMinutes(10);

    private static final Pattern HHMM = Pattern.compile("([01]?\\d|2[0-3]):([0-5]\\d)");

    private final ReflectionUsers users;
    private final NotificationService notifications;
    private final NotificationRepository notificationRows;
    private final PushService push;
    private final ReminderDispatchLogRepository dispatchLog;

    /** Who got today's already, by local day: saves the DB check on the second tick in the window. */
    private final Map<UUID, LocalDate> sentOn = new ConcurrentHashMap<>();

    public ReflectionScheduler(ReflectionUsers users, NotificationService notifications,
                               NotificationRepository notificationRows, PushService push,
                               ReminderDispatchLogRepository dispatchLog) {
        this.dispatchLog = dispatchLog;
        this.users = users;
        this.notifications = notifications;
        this.notificationRows = notificationRows;
        this.push = push;
    }

    @Scheduled(cron = "0 */5 * * * *")
    public void tick() {
        run(Instant.now());
    }

    /**
     * Who has a reflection time, kept in memory: a full read scanned and decoded
     * every user's ui_prefs every 5 minutes. A JPA write to a user, or a
     * buddyReflection change in updateUiPrefs, re-reads just that user.
     */
    private final DeliveryCache.Snapshot<User, User> candidates = new DeliveryCache.Snapshot<>(User::getId);

    /** One pass at {@code now}; returns how many were sent. */
    int run(Instant now) {
        candidates.refresh(now, users::findWithReflectionPref,
                ids -> users.findWithReflectionPrefIn(ids.stream().map(UUID::toString).toList()),
                list -> Map.of());
        int sent = 0;
        for (User cached : candidates.items()) {
            if (!isDue(timeOf(cached.getUiPrefs()), now.atZone(UserZone.of(cached.getTimezone())),
                    sentOn.get(cached.getId()))) {
                continue;
            }
            // The due few are read fresh: quiet hours, a break or a deletion request are current.
            User u = users.findById(cached.getId()).orElse(null);
            if (u == null) continue;
            try {
                if (deliverIfDue(u, now)) sent++;
            } catch (RuntimeException ex) {
                log.warn("Evening reflection for {} failed: {}", u.getId(), ex.getMessage());
            }
        }
        return sent;
    }

    private boolean deliverIfDue(User u, Instant now) {
        if (u.getDeletionRequestedAt() != null || !u.isEmailVerified()) return false;
        LocalTime at = timeOf(u.getUiPrefs());
        ZoneId zone = UserZone.of(u.getTimezone());
        ZonedDateTime local = now.atZone(zone);
        if (!isDue(at, local, sentOn.get(u.getId()))) return false;
        if (ReminderPrefs.isQuiet(u.getUiPrefs(), at)) return false;
        if (com.growthbuddy.habit.OnBreak.on(u.getUiPrefs(), local.toLocalDate())) return false; // I-08
        LocalDate day = local.toLocalDate();
        Instant midnight = day.atStartOfDay(zone).toInstant();
        if (notificationRows.findFirstByUserIdAndKindAndCreatedAtAfterOrderByCreatedAtDesc(
                u.getId(), NotificationKind.buddy_checkin, midnight).isPresent()) {
            sentOn.put(u.getId(), day);
            return false;
        }
        sentOn.put(u.getId(), day);
        if (!claim(u.getId(), day)) return false;
        notifications.publish(u.getId(), NotificationKind.buddy_checkin, TITLE, STARTER, null);
        try {
            push.sendToUser(u.getId(), TITLE, STARTER, "/#mentor");
        } catch (RuntimeException ex) {
            log.warn("Evening reflection push for {} failed: {}", u.getId(), ex.getMessage());
        }
        return true;
    }

    /**
     * The cross-instance once-a-day guard (CRB-10). The map and the bell-row
     * check above are both read-then-act, so two instances in one window could
     * both send; ux_rem_dispatch_unique admits one row per (key, day), so exactly
     * one insert wins. Keyed like SubscriptionDueScheduler's: a stable UUID per user.
     */
    private boolean claim(UUID userId, LocalDate day) {
        ReminderDispatchLog row = new ReminderDispatchLog();
        row.setReminderId(UUID.nameUUIDFromBytes(
                ("reflection:" + userId).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        row.setOccurrenceDate(day);
        row.setChannel("bell");
        row.setStatus("sent");
        try {
            dispatchLog.saveAndFlush(row);
            return true;
        } catch (org.springframework.dao.DataIntegrityViolationException taken) {
            return false;
        }
    }

    /** The user's reflection time, or null when it is off or unreadable. */
    static LocalTime timeOf(Map<String, Object> uiPrefs) {
        Object v = uiPrefs == null ? null : uiPrefs.get(PREF);
        if (!(v instanceof String s)) return null;
        Matcher m = HHMM.matcher(s.trim());
        if (!m.matches()) return null;
        return LocalTime.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)));
    }

    /**
     * Pure selection: is {@code local} (the user's now, in their zone) inside
     * [{@code at}, {@code at} + {@link #WINDOW}) on a day not already sent?
     */
    static boolean isDue(LocalTime at, ZonedDateTime local, LocalDate lastSentOn) {
        if (at == null || local == null) return false;
        LocalDate day = local.toLocalDate();
        if (day.equals(lastSentOn)) return false;
        ZonedDateTime slot = ZonedDateTime.of(day, at, local.getZone());
        Duration since = Duration.between(slot, local);
        return !since.isNegative() && since.compareTo(WINDOW) < 0;
    }
}

/**
 * Candidates: anyone whose ui_prefs names the key at all. A prefilter only —
 * {@link ReflectionScheduler#timeOf} decides (a null or "" value is off). Native because JPQL
 * can't read a JSON column; CAST works on MySQL and TiDB alike.
 */
interface ReflectionUsers extends JpaRepository<User, UUID> {
    @Query(value = "SELECT * FROM users WHERE CAST(ui_prefs AS CHAR) LIKE '%buddyReflection%'",
            nativeQuery = true)
    List<User> findWithReflectionPref();

    @Query(value = "SELECT * FROM users WHERE id IN (:ids) AND CAST(ui_prefs AS CHAR) LIKE '%buddyReflection%'",
            nativeQuery = true)
    List<User> findWithReflectionPrefIn(@org.springframework.data.repository.query.Param("ids") List<String> ids);
}
