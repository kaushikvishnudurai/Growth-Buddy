package com.growthbuddy.user;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Hard-deletes accounts whose deletion was requested more than
 * {@link AuthService#DELETION_GRACE_DAYS} days ago, through the same purge
 * {@code deleteAccount} used to run immediately ({@code AuthService.purgeAccount}).
 *
 * <p>One transaction per account, so one failing purge doesn't hold back the
 * rest; each re-checks the schedule, so a cancel that lands between the list
 * and the delete wins. Safe on two instances at once: the second finds nothing.
 */
@Component
public class AccountDeletionJob {

    private static final Logger log = LoggerFactory.getLogger(AccountDeletionJob.class);

    private final UserRepository users;
    private final AuthService auth;

    public AccountDeletionJob(UserRepository users, AuthService auth) {
        this.users = users;
        this.auth = auth;
    }

    /** Hourly, so the purge lands within the hour of the date the email promised. */
    @Scheduled(cron = "0 15 * * * *")
    public void purgeDueAccounts() {
        Instant cutoff = Instant.now().minus(AuthService.DELETION_GRACE_DAYS, ChronoUnit.DAYS);
        int done = 0;
        for (UUID id : users.findIdsDueForDeletion(cutoff)) {
            try {
                if (auth.purgeScheduledAccount(id, cutoff)) {
                    done++;
                }
            } catch (RuntimeException ex) {
                log.error("Scheduled deletion of account {} failed; will retry next run", id, ex);
            }
        }
        if (done > 0) {
            log.info("Deleted {} account(s) whose deletion grace period ended", done);
        }
    }
}
