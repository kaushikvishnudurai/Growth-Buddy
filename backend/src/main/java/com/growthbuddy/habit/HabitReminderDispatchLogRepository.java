package com.growthbuddy.habit;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HabitReminderDispatchLogRepository
        extends JpaRepository<HabitReminderDispatchLog, UUID> {

    /** The one row (habit, day) can have — ux_habit_dispatch_unique. */
    Optional<HabitReminderDispatchLog> findByHabitIdAndOccurrenceDate(UUID habitId, LocalDate occurrenceDate);
}
