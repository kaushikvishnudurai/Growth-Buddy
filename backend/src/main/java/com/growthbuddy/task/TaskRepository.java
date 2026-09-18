package com.growthbuddy.task;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.Optional;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TaskRepository extends JpaRepository<Task, UUID> {

    List<Task> findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(UUID userId);

    Optional<Task> findByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);

    long countByUserIdAndDeletedAtIsNull(UUID userId);

    long countByUserIdAndDoneTrueAndDeletedAtIsNull(UUID userId);

    /** Ids of everyone currently holding a ticked-off task. Drives the midnight sweep. */
    @Query("select distinct t.userId from Task t where t.done = true and t.deletedAt is null")
    List<UUID> findUserIdsWithCompletedTasks();

    /**
     * Soft-delete every task this user has already ticked off. History rows are
     * left alone on purpose — they are what the report and the completion count
     * are built from, and {@code TaskService.delete} wiping them is a different
     * intent (the user removing a task) from this one (the day ending).
     */
    @Modifying(clearAutomatically = true)
    @Query("update Task t set t.deletedAt = :now, t.updatedAt = :now "
            + "where t.userId = :userId and t.done = true and t.deletedAt is null")
    int clearCompletedFor(@Param("userId") UUID userId, @Param("now") Instant now);

    /**
     * How many distinct tasks were ticked off inside a window. Once the midnight
     * sweep has cleared a day, the completion history is the only thing left that
     * remembers it — the task rows themselves are soft-deleted.
     */
    @Query("select count(distinct h.taskId) from TaskHistory h "
            + "where h.userId = :userId and h.changedAt >= :from and h.changedAt < :to")
    long countCompletedBetween(@Param("userId") UUID userId,
                               @Param("from") Instant from, @Param("to") Instant to);
}

interface TaskHistoryRepository extends JpaRepository<TaskHistory, UUID> {

    List<TaskHistory> findByUserIdAndTaskIdOrderByChangedAtDesc(UUID userId, UUID taskId);

    long countByUserIdAndTaskId(UUID userId, UUID taskId);

    @Modifying
    @Query("delete from TaskHistory h where h.userId = :userId and h.taskId = :taskId")
    void deleteByUserIdAndTaskId(@Param("userId") UUID userId, @Param("taskId") UUID taskId);
}
