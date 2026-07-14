package com.growthbuddy.goal;

import java.util.List;
import java.util.UUID;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

interface GoalRepository extends JpaRepository<Goal, UUID> {
    List<Goal> findByUserIdOrderByCreatedAtDesc(UUID userId);

    Optional<Goal> findByIdAndUserId(UUID id, UUID userId);
}

interface GoalActionRepository extends JpaRepository<GoalAction, UUID> {
    List<GoalAction> findByGoalIdOrderByCreatedAtDesc(UUID goalId);

    List<GoalAction> findTop3ByGoalIdOrderByCreatedAtDesc(UUID goalId);

    Optional<GoalAction> findByIdAndUserId(UUID id, UUID userId);

    long countByGoalId(UUID goalId);
}