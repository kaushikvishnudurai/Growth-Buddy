package com.growthbuddy.habit;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface HabitRepository extends JpaRepository<Habit, UUID> {
    List<Habit> findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(UUID userId);

    /** The Habits screen's order: the user's own, then oldest first for ties (and for every
     *  habit that predates the column, all 0). */
    List<Habit> findByUserIdAndDeletedAtIsNullOrderBySortOrderAscCreatedAtAsc(UUID userId);

    Optional<Habit> findByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);

    /**
     * Active habits with a daily reminder time, for a user reachable on at
     * least one of the given channels. Mirrors
     * {@code CalendarReminderRepository.findDeliverable}. No WhatsApp branch
     * needed here: the scheduler always passes inAppOn = true (the bell reaches
     * everyone), and it checks WhatsApp per user when it delivers.
     */
    @Query("""
            select h from Habit h
            where h.reminderTime is not null
              and h.deletedAt is null
              and h.active = true
              and exists (
                select 1 from User u where u.id = h.userId and (
                     (:inAppOn = true)
                  or (:pushOn = true and exists (
                        select 1 from PushSubscription p where p.userId = u.id))
                ))
            """)
    List<Habit> findDeliverable(@Param("inAppOn") boolean inAppOn, @Param("pushOn") boolean pushOn);
}

interface HabitCheckinRepository extends JpaRepository<HabitCheckin, HabitCheckin.Key> {
    List<HabitCheckin> findByHabitIdOrderByLogDateDesc(UUID habitId);

    /** One habit's check-ins from {@code from} on — the bounded read behind a single-habit response. */
    List<HabitCheckin> findByHabitIdAndLogDateGreaterThanEqualOrderByLogDateDesc(UUID habitId,
                                                                               LocalDate from);

    /** A user's check-ins from {@code from} on, so the habit list never loads years of history. */
    List<HabitCheckin> findByUserIdAndLogDateGreaterThanEqualOrderByLogDateDesc(UUID userId,
                                                                              LocalDate from);

    /** A user's completed check-ins in [start, end] — the week a weekly habit's "due today" reads. */
    List<HabitCheckin> findByUserIdAndDoneTrueAndLogDateBetween(UUID userId, LocalDate start,
                                                                LocalDate end);

    /** Every check-in row in [start, end], done or not — countsOn needs a quit habit's slips too. */
    List<HabitCheckin> findByUserIdAndLogDateBetween(UUID userId, LocalDate start, LocalDate end);

    /** All of a user's check-ins in one query, so the habit list avoids N per-habit reads. */
    List<HabitCheckin> findByUserIdOrderByLogDateDesc(UUID userId);

    /** A user's completed check-ins for a single day (for today's done-count). */
    List<HabitCheckin> findByUserIdAndLogDateAndDoneTrue(UUID userId, LocalDate logDate);

    Optional<HabitCheckin> findByHabitIdAndLogDate(UUID habitId, LocalDate logDate);

    boolean existsByHabitIdAndLogDateAndDoneTrue(UUID habitId, LocalDate logDate);

    long countByUserIdAndDoneTrueAndLogDateBetween(UUID userId, LocalDate start, LocalDate end);

    /** Done check-in counts for many users at once — {@code [userId, count]} rows. */
    @Query("select c.userId, count(c) from HabitCheckin c "
            + "where c.userId in :ids and c.done = true and c.logDate between :start and :end "
            + "group by c.userId")
    List<Object[]> countDoneByUsersBetween(@Param("ids") List<UUID> ids,
                                           @Param("start") LocalDate start,
                                           @Param("end") LocalDate end);
}

interface HabitStreakRepository extends JpaRepository<HabitStreak, UUID> {
}

interface StreakFreezeWalletRepository extends JpaRepository<StreakFreezeWallet, UUID> {
}
