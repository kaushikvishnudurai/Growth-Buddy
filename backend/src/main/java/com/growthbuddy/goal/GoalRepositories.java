package com.growthbuddy.goal;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface GoalRepository extends JpaRepository<Goal, UUID> {
    List<Goal> findByUserIdOrderByCreatedAtDesc(UUID userId);

    Optional<Goal> findByIdAndUserId(UUID id, UUID userId);

    boolean existsByIdAndUserId(UUID id, UUID userId);
}

interface GoalActionRepository extends JpaRepository<GoalAction, UUID> {
    List<GoalAction> findByGoalIdOrderByCreatedAtDesc(UUID goalId);

    List<GoalAction> findTop3ByGoalIdOrderByCreatedAtDesc(UUID goalId);

    Optional<GoalAction> findByIdAndUserId(UUID id, UUID userId);

    long countByGoalId(UUID goalId);

    /**
     * The newest 3 actions of each of many goals in one query, newest first within a goal.
     * Native for the window function; ids go in as strings because the column is CHAR(36).
     * TiDB and MySQL 8 both have ROW_NUMBER.
     */
    @Query(value = "select id, goal_id, user_id, note, action_date, created_at from ("
            + "select a.*, row_number() over (partition by a.goal_id order by a.created_at desc) rn"
            + " from goal_actions a where a.goal_id in (:ids)) ranked"
            + " where rn <= 3 order by goal_id, created_at desc", nativeQuery = true)
    List<GoalAction> findTop3PerGoal(@Param("ids") Collection<String> ids);

    /** Action counts for many goals in one query: {@code [goalId, count]} rows. */
    @Query("select a.goalId, count(a) from GoalAction a where a.goalId in :ids group by a.goalId")
    List<Object[]> countByGoalIds(@Param("ids") Collection<UUID> ids);
}