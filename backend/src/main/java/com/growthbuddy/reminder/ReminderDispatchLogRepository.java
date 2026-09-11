package com.growthbuddy.reminder;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReminderDispatchLogRepository extends JpaRepository<ReminderDispatchLog, UUID> {

    boolean existsByReminderIdAndOccurrenceDate(UUID reminderId, LocalDate occurrenceDate);

    /**
     * Only a delivered occurrence blocks redelivery — a failed attempt must stay
     * retryable inside the catch-up window, or one network blip drops the reminder
     * for the whole day.
     */
    boolean existsByReminderIdAndOccurrenceDateAndStatus(
            UUID reminderId, LocalDate occurrenceDate, String status);

    /**
     * The delivered set for a whole tick in one round trip. Asked per reminder it
     * was a query each, every minute; the occurrence dates span at most a few
     * calendar days because users sit in different time zones.
     *
     * <p>Returns the (reminder, date) pairs rather than bare ids: a reminder is
     * only redelivery-blocked for the specific occurrence already sent, and
     * collapsing that to "this reminder appears somewhere in the window" would
     * suppress today's send because yesterday's succeeded.
     */
    @Query("""
            select l.reminderId, l.occurrenceDate from ReminderDispatchLog l
            where l.status = 'sent'
              and l.occurrenceDate in :days
              and l.reminderId in :reminderIds
            """)
    List<Object[]> findDelivered(@Param("reminderIds") Collection<UUID> reminderIds,
                                 @Param("days") Collection<LocalDate> days);
}
