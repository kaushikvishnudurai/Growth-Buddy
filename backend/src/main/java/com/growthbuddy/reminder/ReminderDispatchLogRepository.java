package com.growthbuddy.reminder;

import java.time.LocalDate;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReminderDispatchLogRepository extends JpaRepository<ReminderDispatchLog, UUID> {

    boolean existsByReminderIdAndOccurrenceDate(UUID reminderId, LocalDate occurrenceDate);

    /**
     * Only a delivered occurrence blocks redelivery — a failed attempt must stay
     * retryable inside the catch-up window, or one network blip drops the reminder
     * for the whole day.
     */
    boolean existsByReminderIdAndOccurrenceDateAndStatus(
            UUID reminderId, LocalDate occurrenceDate, String status);
}
