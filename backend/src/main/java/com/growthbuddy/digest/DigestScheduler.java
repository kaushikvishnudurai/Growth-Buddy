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
 * Sends progress digests near each user's preferred local hour. Runs hourly and
 * dispatches at most one digest per user per local day (weekly digests fire on
 * Mondays). Honours the user's timezone like {@code ReminderDeliveryScheduler}.
 */
@Component
public class DigestScheduler {

    private static final Logger log = LoggerFactory.getLogger(DigestScheduler.class);

    private final UserRepository users;
    private final DigestService digest;

    public DigestScheduler(UserRepository users, DigestService digest) {
        this.users = users;
        this.digest = digest;
    }

    // Not @Transactional: this loop sends a blocking SMTP email per due user; a
    // loop-wide transaction would pin one DB connection for the whole run. Each
    // users.save() is its own short transaction.
    @Scheduled(cron = "0 0 * * * *")
    public void dispatchDigests() {
        List<User> candidates = users.findByDigestFrequencyNot("off");
        for (User user : candidates) {
            String freq = user.getDigestFrequency();
            if (!StringUtils.hasText(user.getEmail()) || !StringUtils.hasText(freq)) {
                continue;
            }
            ZoneId zone = UserZone.of(user.getTimezone());
            LocalDateTime now = LocalDateTime.now(zone);
            if (now.getHour() != user.getDigestHour()) {
                continue;
            }
            LocalDate today = now.toLocalDate();
            if (today.equals(user.getLastDigestOn())) {
                continue; // already sent today
            }
            boolean weekly = "weekly".equalsIgnoreCase(freq);
            if (weekly && now.getDayOfWeek() != DayOfWeek.MONDAY) {
                continue;
            }
            try {
                digest.sendDigest(user, weekly, today);
            } catch (Exception ex) {
                // Don't stamp lastDigestOn on a failure: that records a digest as
                // delivered when it never left the building, and the `already sent
                // today` check above then skips the retry for good. Leaving the
                // stamp alone lets the next tick inside the user's digest hour try
                // again, and cannot spam — the send is gated on the hour matching.
                log.warn("Failed to send digest for user {}: {}", user.getId(), ex.getMessage());
                continue;
            }
            user.setLastDigestOn(today);
            users.save(user);
        }
    }

}
