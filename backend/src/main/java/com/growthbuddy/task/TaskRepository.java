package com.growthbuddy.task;

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
}

interface TaskHistoryRepository extends JpaRepository<TaskHistory, UUID> {

    List<TaskHistory> findByUserIdAndTaskIdOrderByChangedAtDesc(UUID userId, UUID taskId);

    long countByUserIdAndTaskId(UUID userId, UUID taskId);

    @Modifying
    @Query("delete from TaskHistory h where h.userId = :userId and h.taskId = :taskId")
    void deleteByUserIdAndTaskId(@Param("userId") UUID userId, @Param("taskId") UUID taskId);
}
