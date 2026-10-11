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

    /** Paused tasks are left out of both score counts: a paused task scores as no task. */
    long countByUserIdAndPausedFalseAndDeletedAtIsNull(UUID userId);

    List<Task> findByUserIdAndDoneAtAfter(UUID userId, Instant after);

    long countByUserIdAndDoneTrueAndPausedFalseAndDeletedAtIsNull(UUID userId);

    /**
     * {@code [userId, oldest doneAt]} for everyone holding a ticked-off task. Drives
     * the midnight sweep; the oldest tick says whether any of it predates their today.
     */
    @Query("select t.userId, min(t.doneAt) from Task t where t.done = true and t.deletedAt is null "
            + "group by t.userId")
    List<Object[]> findOldestCompletedByUser();

    /**
     * Soft-delete every task this user ticked off before {@code before} (their
     * local midnight; a legacy row with no doneAt counts as old). History rows are
     * left alone on purpose — they are what the report and the completion count
     * are built from, and {@code TaskService.delete} wiping them is a different
     * intent (the user removing a task) from this one (the day ending).
     */
    @Modifying(clearAutomatically = true)
    @Query("update Task t set t.deletedAt = :now, t.updatedAt = :now "
            + "where t.userId = :userId and t.done = true and t.deletedAt is null "
            + "and (t.doneAt is null or t.doneAt < :before)")
    int clearCompletedFor(@Param("userId") UUID userId, @Param("before") Instant before,
                          @Param("now") Instant now);

    /**
     * How many distinct tasks were ticked off inside a window. Once the midnight
     * sweep has cleared a day, the completion history is the only thing left that
     * remembers it — the task rows themselves are soft-deleted.
     */
    @Query("select count(distinct h.taskId) from TaskHistory h "
            + "where h.userId = :userId and h.changedAt >= :from and h.changedAt < :to")
    long countCompletedBetween(@Param("userId") UUID userId,
                               @Param("from") Instant from, @Param("to") Instant to);

    /** Take every task off a goal that is being deleted. */
    @Modifying(clearAutomatically = true)
    @Query("update Task t set t.goalId = null where t.userId = :userId and t.goalId = :goalId")
    int clearGoal(@Param("userId") UUID userId, @Param("goalId") UUID goalId);

    /**
     * Finished tasks per goal that the midnight sweep has already cleared:
     * {@code [goalId, count]} rows. They are gone from {@code GET /api/tasks}, so
     * the Goals card adds these to the live ones it can see. A task the user
     * deleted has its goal cleared, so it is not among them.
     */
    @Query("select t.goalId, count(t) from Task t where t.userId = :userId and t.goalId in :ids "
            + "and t.done = true and t.deletedAt is not null group by t.goalId")
    List<Object[]> countClearedByGoalIds(@Param("userId") UUID userId,
                                         @Param("ids") java.util.Collection<UUID> ids);
}

interface TaskHistoryRepository extends JpaRepository<TaskHistory, UUID> {

    List<TaskHistory> findByUserIdAndTaskIdOrderByChangedAtDesc(UUID userId, UUID taskId);

    long countByUserIdAndTaskId(UUID userId, UUID taskId);

    @Modifying
    @Query("delete from TaskHistory h where h.userId = :userId and h.taskId = :taskId")
    void deleteByUserIdAndTaskId(@Param("userId") UUID userId, @Param("taskId") UUID taskId);
}
