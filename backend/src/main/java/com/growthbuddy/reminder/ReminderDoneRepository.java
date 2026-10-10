package com.growthbuddy.reminder;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface ReminderDoneRepository extends JpaRepository<ReminderDone, UUID> {

    Optional<ReminderDone> findByReminderIdAndOccurrenceDate(UUID reminderId, LocalDate occurrenceDate);

    /** What the list DTO carries: a user's ticks from {@code from} on. */
    List<ReminderDone> findByUserIdAndOccurrenceDateGreaterThanEqual(UUID userId, LocalDate from);

    /** The scheduler's batch: (reminder, day) pairs checked off, for one tick's candidates. */
    @Query("""
            select d.reminderId, d.occurrenceDate from ReminderDone d
            where d.occurrenceDate in :days and d.reminderId in :reminderIds
            """)
    List<Object[]> findDone(@Param("reminderIds") Collection<UUID> reminderIds,
                            @Param("days") Collection<LocalDate> days);

    @Modifying
    @Transactional
    @Query("delete from ReminderDone d where d.reminderId = :reminderId")
    int deleteByReminder(@Param("reminderId") UUID reminderId);

    /** A split hands the ticks on/after {@code from} to the reminder that now owns those days. */
    @Modifying
    @Transactional
    @Query("""
            update ReminderDone d set d.reminderId = :to
            where d.reminderId = :from and d.occurrenceDate >= :since
            """)
    int moveFrom(@Param("from") UUID from, @Param("to") UUID to, @Param("since") LocalDate since);

    /** Only the one day: the one-off a scope=this edit leaves in a series' place. */
    @Modifying
    @Transactional
    @Query("""
            update ReminderDone d set d.reminderId = :to
            where d.reminderId = :from and d.occurrenceDate = :day
            """)
    int moveDay(@Param("from") UUID from, @Param("to") UUID to, @Param("day") LocalDate day);
}
