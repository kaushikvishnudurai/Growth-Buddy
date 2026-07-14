package com.growthbuddy.reminder;

import java.time.LocalDate;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReminderDispatchLogRepository extends JpaRepository<ReminderDispatchLog, UUID> {

    boolean existsByReminderIdAndOccurrenceDate(UUID reminderId, LocalDate occurrenceDate);
}
