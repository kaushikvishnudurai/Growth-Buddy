package com.growthbuddy.digest;

import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.mail.MailService;
import com.growthbuddy.score.ScoreService;
import com.growthbuddy.user.User;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.time.LocalDate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * Builds and delivers a user's progress digest — a short "here's your day/week"
 * summary — over email (via {@link MailService}) plus an in-app notification.
 *
 * <p>It reports the last day that actually <em>finished</em>, never the live score.
 * A digest fires at the user's chosen hour, which for most people is the morning —
 * and by then {@code TaskMidnightSweep} has cleared yesterday's ticked tasks and the
 * habit check-ins have rolled to a new log date, so a live reading is a truthful 0
 * about a day nobody has lived yet.
 */
@Service
public class DigestService {

    private static final Logger log = LoggerFactory.getLogger(DigestService.class);

    private final ScoreService scores;
    private final MailService mail;
    private final NotificationService notifications;
    private final com.growthbuddy.push.PushService push;

    public DigestService(ScoreService scores, MailService mail, NotificationService notifications,
                         com.growthbuddy.push.PushService push) {
        this.scores = scores;
        this.mail = mail;
        this.notifications = notifications;
        this.push = push;
    }

    /**
     * Send the digest to a single user. {@code weekly} picks the wording/cadence;
     * {@code today} is the user's own current date, so the recap covers the days
     * before it.
     */
    public void sendDigest(User user, boolean weekly, LocalDate today) {
        LocalDate through = today.minusDays(1);
        ScoreService.ScoreResponse s = weekly
                ? scores.between(user.getId(), through.minusDays(6), through)
                : scores.on(user.getId(), through);
        String subject = weekly ? "Your weekly Growth Buddy digest" : "Your Growth Buddy daily digest";

        try {
            mail.sendPlain(user.getEmail(), subject, buildBody(user, s, weekly));
        } catch (Exception ex) {
            log.warn("Digest email failed for user {}: {}", user.getId(), ex.getMessage());
        }

        String title = weekly ? "Your week in review" : "Yesterday in review";
        String note = "Score " + s.score() + "% · tasks " + s.tasksDone() + "/" + s.tasksTotal()
                + " · habits " + s.habitsDone() + "/" + s.habitsTotal();
        try {
            notifications.publish(user.getId(), NotificationKind.system, title, note, null);
        } catch (Exception ex) {
            log.warn("Digest notification failed for user {}: {}", user.getId(), ex.getMessage());
        }
        try {
            push.sendToUser(user.getId(), title, note, "/#report");
        } catch (Exception ex) {
            log.warn("Digest push failed for user {}: {}", user.getId(), ex.getMessage());
        }
    }

    private static String buildBody(User user, ScoreService.ScoreResponse s, boolean weekly) {
        String name = StringUtils.hasText(user.getDisplayName()) ? user.getDisplayName() : "Buddy";
        String period = weekly ? "the past 7 days" : "yesterday";
        return "Hi " + name + ",\n\n"
                + "Here's your Growth Buddy snapshot for " + period + ":\n\n"
                + "  • Growth score: " + s.score() + "%\n"
                + "  • Tasks done:   " + s.tasksDone() + " / " + s.tasksTotal() + "\n"
                + "  • Habits done:  " + s.habitsDone() + " / " + s.habitsTotal() + "\n\n"
                + encouragement(s.score()) + "\n\n"
                + "Open Growth Buddy to keep the momentum going.\n\n"
                + "— Growth Buddy\n\n"
                + "(You can change or turn off these digests in Settings.)";
    }

    private static String encouragement(int score) {
        if (score >= 80) {
            return "Outstanding work — you're crushing it. Keep that streak alive!";
        }
        if (score >= 50) {
            return "Solid progress. Pick one more small win and you'll be flying.";
        }
        if (score > 0) {
            return "Every step counts. One small action today builds tomorrow's momentum.";
        }
        return "A fresh start is waiting — pick one tiny thing and begin. You've got this.";
    }
}
