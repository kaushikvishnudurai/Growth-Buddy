package com.growthbuddy.reminder;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReminderDispatchLogRepository extends JpaRepository<ReminderDispatchLog, UUID> {

    boolean existsByReminderIdAndOccurrenceDate(UUID reminderId, LocalDate occurrenceDate);

    /** The one row (reminder, day) can have — ux_rem_dispatch_unique. */
    Optional<ReminderDispatchLog> findByReminderIdAndOccurrenceDate(UUID reminderId, LocalDate occurrenceDate);

    /**
     * The delivered set for a whole tick in one round trip. Asked per reminder it
     * was a query each, every minute; the occurrence dates span at most a few
     * calendar days because users sit in different time zones.
     *
     * <p>Returns the (reminder, date) pairs rather than bare ids: a reminder is
     * only redelivery-blocked for the specific occurrence already sent, and
     * collapsing that to "this reminder appears somewhere in the window" would
     * suppress today's send because yesterday's succeeded.
     *
     * <p>Anything but 'failed' blocks: a 'sending' row is a claim taken before the
     * send, and one left behind by a crash means the send may well have gone out.
     */
    @Query("""
            select l.reminderId, l.occurrenceDate from ReminderDispatchLog l
            where l.status <> 'failed'
              and l.occurrenceDate in :days
              and l.reminderId in :reminderIds
            """)
    List<Object[]> findDelivered(@Param("reminderIds") Collection<UUID> reminderIds,
                                 @Param("days") Collection<LocalDate> days);
}
