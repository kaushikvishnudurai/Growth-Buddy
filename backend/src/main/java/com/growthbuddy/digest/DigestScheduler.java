package com.growthbuddy.digest;

import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import com.growthbuddy.common.UserZone;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Sends progress digests from each user's preferred local hour on. Runs hourly and
 * dispatches at most one digest per user per local day (weekly digests fire on
 * Mondays). Honours the user's timezone like {@code ReminderDeliveryScheduler}.
 */
@Component
public class DigestScheduler {

    private static final Logger log = LoggerFactory.getLogger(DigestScheduler.class);

    private final UserRepository users;
    private final DigestService digest;

    /**
     * User to the day whose digest email is still owed (its bell and push went).
     * ponytail: in memory, so a restart between a failed email and its retry
     * sends that day's bell and push once more; a column if that ever matters.
     */
    private final java.util.Map<java.util.UUID, LocalDate> emailOwed =
            new java.util.concurrent.ConcurrentHashMap<>();

    public DigestScheduler(UserRepository users, DigestService digest) {
        this.users = users;
        this.digest = digest;
    }

    // Not @Transactional: this loop sends a blocking SMTP email per due user; a
    // loop-wide transaction would pin one DB connection for the whole run. Each
    // claim / release is its own short transaction.
    @Scheduled(cron = "0 0 * * * *")
    public void dispatchDigests() {
        List<User> candidates = users.findByDigestFrequencyNot("off");
        for (User user : candidates) {
            String freq = user.getDigestFrequency();
            // Scheduled for deletion: no digest email, bell or push during the grace period.
            if (user.isPendingDeletion()
                    || !StringUtils.hasText(user.getEmail()) || !StringUtils.hasText(freq)) {
                continue;
            }
            ZoneId zone = UserZone.of(user.getTimezone());
            LocalDateTime now = LocalDateTime.now(zone);
            if (!due(now, user.getDigestHour(), user.getUiPrefs())) {
                continue;
            }
            LocalDate today = now.toLocalDate();
            if (today.equals(user.getLastDigestOn())) {
                continue; // already sent today
            }
            if (com.growthbuddy.habit.OnBreak.on(user.getUiPrefs(), today)) {
                continue; // on a break (I-08): no digest; nothing claimed, so it resumes after
            }
            boolean weekly = "weekly".equalsIgnoreCase(freq);
            if (weekly && now.getDayOfWeek() != DayOfWeek.MONDAY) {
                continue;
            }
            // Claim before the send: the conditional UPDATE lets one run win.
            LocalDate previous = user.getLastDigestOn();
            if (users.claimDigest(user.getId(), today) != 1) {
                continue; // another instance or run already has today's
            }
            boolean emailRetry = today.equals(emailOwed.get(user.getId()));
            try {
                digest.sendDigest(user, weekly, today, !emailRetry);
                emailOwed.remove(user.getId());
            } catch (DigestService.EmailFailed ex) {
                // The bell and push went; only the email is owed. Released, the
                // next tick retries the email alone.
                emailOwed.put(user.getId(), today);
                users.releaseDigest(user.getId(), today, previous);
                log.warn("Digest email failed for user {}: {}", user.getId(), ex.getMessage());
            } catch (Exception ex) {
                // Hand the claim back: a stamp on a failure records a digest as
                // delivered when it never left the building. Released, the next
                // hourly tick that day tries again.
                users.releaseDigest(user.getId(), today, previous);
                log.warn("Failed to send digest for user {}: {}", user.getId(), ex.getMessage());
            }
        }
    }

    /**
     * Any tick at or after the digest hour, outside quiet hours, until the day's
     * digest is stamped. Not just the one matching hour: a failed send or a host
     * asleep through that hour (Render idles) would otherwise lose the whole day.
     */
    static boolean due(LocalDateTime now, int hour, java.util.Map<String, Object> uiPrefs) {
        return now.getHour() >= digestHourFor(hour, uiPrefs)
                && !com.growthbuddy.reminder.ReminderPrefs.isQuiet(uiPrefs, now.toLocalTime());
    }

    /**
     * The hour the digest actually goes at: the user's own, unless it falls in
     * their quiet hours ({@code ReminderPrefs.isQuiet}), in which case it waits
     * for the first whole hour after the window ends. Held back, not dropped —
     * skipping it would lose the digest every day the two settings overlap.
     */
    static int digestHourFor(int hour, java.util.Map<String, Object> uiPrefs) {
        java.time.LocalTime at = java.time.LocalTime.of(Math.floorMod(hour, 24), 0);
        if (!com.growthbuddy.reminder.ReminderPrefs.isQuiet(uiPrefs, at)) {
            return at.getHour();
        }
        java.time.LocalTime end = com.growthbuddy.reminder.ReminderPrefs.quietEndOf(uiPrefs);
        return end.getMinute() == 0 ? end.getHour() : (end.getHour() + 1) % 24;
    }

}
