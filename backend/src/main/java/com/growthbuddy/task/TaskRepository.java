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

    /**
     * The score's "due" open tasks: not done, not paused, due before {@code end}
     * (the end of the day being scored), overdue included. An undated task is not
     * due on any day, so it is left out until it is ticked off.
     */
    @Query("select count(t) from Task t where t.userId = :userId and t.deletedAt is null and t.paused = false "
            + "and t.done = false and t.dueAt is not null and t.dueAt < :end")
    long countOpenDueBefore(@Param("userId") UUID userId, @Param("end") Instant end);

    /** Live tasks ticked off in {@code [from, to)}, whatever their due date: anything done today counts. */
    @Query("select count(t) from Task t where t.userId = :userId and t.deletedAt is null and t.paused = false "
            + "and t.done = true and t.doneAt >= :from and t.doneAt < :to")
    long countDoneBetween(@Param("userId") UUID userId, @Param("from") Instant from, @Param("to") Instant to);

    List<Task> findByUserIdAndDoneAtAfter(UUID userId, Instant after);


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

    /** {@code [taskId, changedAt]} completions in a window: the score range buckets them by local day. */
    @Query("select h.taskId, h.changedAt from TaskHistory h "
            + "where h.userId = :userId and h.changedAt >= :from and h.changedAt < :to")
    List<Object[]> completionsBetween(@Param("userId") UUID userId,
                                      @Param("from") Instant from, @Param("to") Instant to);

    /** The due instants behind {@link #countOpenDueBefore}, so a range counts every day from one read. */
    @Query("select t.dueAt from Task t where t.userId = :userId and t.deletedAt is null and t.paused = false "
            + "and t.done = false and t.dueAt is not null and t.dueAt < :end")
    List<Instant> openDueBefore(@Param("userId") UUID userId, @Param("end") Instant end);

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

    /**
     * {@code [taskId, completionCount, lastCompletedAt]} for each of {@code ids}
     * that has history: one query for the whole task list instead of one per
     * task. Covered by {@code ix_task_hist_user_task_time}.
     */
    @Query("select h.taskId, count(h), max(h.changedAt) from TaskHistory h "
            + "where h.userId = :userId and h.taskId in :ids group by h.taskId")
    List<Object[]> summarize(@Param("userId") UUID userId, @Param("ids") java.util.Collection<UUID> ids);

    @Modifying
    @Query("delete from TaskHistory h where h.userId = :userId and h.taskId = :taskId")
    void deleteByUserIdAndTaskId(@Param("userId") UUID userId, @Param("taskId") UUID taskId);
}
