package com.growthbuddy.reminder;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CalendarReminderRepository extends JpaRepository<CalendarReminder, UUID> {

    List<CalendarReminder> findByUserId(UUID userId);

    List<CalendarReminder> findByTimeIsNotNull();

    java.util.Optional<CalendarReminder> findByIdAndUserId(UUID id, UUID userId);
}
