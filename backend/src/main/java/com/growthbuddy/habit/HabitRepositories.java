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

    Optional<Habit> findByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);
}

interface HabitCheckinRepository extends JpaRepository<HabitCheckin, HabitCheckin.Key> {
    List<HabitCheckin> findByHabitIdOrderByLogDateDesc(UUID habitId);

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
