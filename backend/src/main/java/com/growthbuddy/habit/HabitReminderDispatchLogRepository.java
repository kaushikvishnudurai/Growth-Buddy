package com.growthbuddy.habit;

import java.time.LocalDate;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HabitReminderDispatchLogRepository
        extends JpaRepository<HabitReminderDispatchLog, UUID> {

    /** Only a delivered occurrence blocks redelivery — a failed attempt stays
     *  retryable inside the scheduler's catch-up window. */
    boolean existsByHabitIdAndOccurrenceDateAndStatus(UUID habitId, LocalDate occurrenceDate, String status);
}
