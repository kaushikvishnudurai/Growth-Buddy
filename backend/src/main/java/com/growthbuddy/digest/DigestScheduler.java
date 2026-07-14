package com.growthbuddy.digest;

import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
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
            ZoneId zone = parseZone(user.getTimezone());
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
                digest.sendDigest(user, weekly);
            } catch (Exception ex) {
                log.warn("Failed to send digest for user {}: {}", user.getId(), ex.getMessage());
            }
            user.setLastDigestOn(today);
            users.save(user);
        }
    }

    private static ZoneId parseZone(String id) {
        try {
            return ZoneId.of(id);
        } catch (Exception ex) {
            return ZoneId.of("UTC");
        }
    }
}
