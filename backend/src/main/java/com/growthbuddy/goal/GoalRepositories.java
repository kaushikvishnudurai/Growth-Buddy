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

    /**
     * The goal, locked until the transaction ends (SELECT ... FOR UPDATE), for a
     * progress save: two saves carrying the same If-Match would otherwise both
     * pass the check and one would overwrite the other.
     */
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from Goal g where g.id = :id and g.userId = :userId")
    Optional<Goal> lockByIdAndUserId(@Param("id") UUID id, @Param("userId") UUID userId);
}

interface GoalActionRepository extends JpaRepository<GoalAction, UUID> {
    List<GoalAction> findByGoalIdOrderByCreatedAtDesc(UUID goalId);

    List<GoalAction> findTop3ByGoalIdOrderByCreatedAtDesc(UUID goalId);

    Optional<GoalAction> findByIdAndUserId(UUID id, UUID userId);

    long countByGoalId(UUID goalId);

    /** Action counts for many goals in one query: {@code [goalId, count]} rows. */
    @Query("select a.goalId, count(a) from GoalAction a where a.goalId in :ids group by a.goalId")
    List<Object[]> countByGoalIds(@Param("ids") Collection<UUID> ids);
}