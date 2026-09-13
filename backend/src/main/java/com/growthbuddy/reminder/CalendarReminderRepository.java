package com.growthbuddy.reminder;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CalendarReminderRepository extends JpaRepository<CalendarReminder, UUID> {

    List<CalendarReminder> findByUserId(UUID userId);

    List<CalendarReminder> findByTimeIsNotNull();

    /**
     * Timed reminders belonging to a user who can actually receive one. The
     * dispatcher used to load every timed reminder in the system each minute and
     * discard most of them in Java, so the row count grew with the whole user
     * base rather than with the number of people reachable.
     *
     * <p>Which channels count is a runtime decision, hence the flags: WhatsApp
     * eligibility is per user, push eligibility is a server-wide key pair plus at
     * least one registered device. All false and this returns nothing, which is
     * correct — there would be nowhere to send.
     *
     * <p>{@code inAppOn} matches everyone, because the bell needs no setup: a
     * reminder lands in it whether or not the user ever enabled WhatsApp or
     * allowed browser notifications. ponytail: with in-app on, the filter is
     * effectively "every timed reminder" and the per-tick cost tracks the whole
     * user base again. That's the honest shape while everyone is reachable — if
     * it ever hurts, shard the tick by user zone rather than by channel.
     */
    @Query("""
            select r from CalendarReminder r
            where r.time is not null
              and exists (
                select 1 from User u where u.id = r.userId and (
                     (:inAppOn = true)
                  or (:whatsappOn = true and u.whatsappEnabled = true
                        and u.whatsappNumber is not null and u.whatsappNumber <> '')
                  or (:pushOn = true and exists (
                        select 1 from PushSubscription p where p.userId = u.id))
                ))
            """)
    List<CalendarReminder> findDeliverable(@Param("inAppOn") boolean inAppOn,
                                           @Param("whatsappOn") boolean whatsappOn,
                                           @Param("pushOn") boolean pushOn);

    java.util.Optional<CalendarReminder> findByIdAndUserId(UUID id, UUID userId);
}
