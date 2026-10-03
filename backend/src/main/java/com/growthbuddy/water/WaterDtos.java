package com.growthbuddy.water;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface WaterEntryRepository extends JpaRepository<WaterEntry, UUID> {
    List<WaterEntry> findByUserIdAndLogDateOrderByLoggedAtAsc(UUID userId, LocalDate logDate);

    Optional<WaterEntry> findByIdAndUserId(UUID id, UUID userId);

    @Query("select e.loggedAt from WaterEntry e where e.userId = :userId and e.logDate >= :from")
    List<java.time.Instant> loggedTimesSince(@Param("userId") UUID userId, @Param("from") LocalDate from);

    @Query("select coalesce(sum(e.amountMl), 0) from WaterEntry e where e.userId = :userId and e.logDate = :logDate")
    int totalForDay(@Param("userId") UUID userId, @Param("logDate") LocalDate logDate);

    /** [logDate, sum(amountMl)] per day that has entries; days with none are absent. */
    @Query("select e.logDate, sum(e.amountMl) from WaterEntry e where e.userId = :userId"
            + " and e.logDate between :from and :to group by e.logDate")
    List<Object[]> totalsByDay(@Param("userId") UUID userId,
                               @Param("from") LocalDate from, @Param("to") LocalDate to);
}

interface WaterGoalRepository extends JpaRepository<WaterGoal, UUID> {
}

record AddWaterEntryRequest(
        @Min(1) @Max(5000) Integer amountMl,
        String note,
        Instant loggedAt) {
}

record UpdateWaterGoalRequest(
        // Same bounds as the profile's dailyWaterGoalMl: it is the same value now.
        @Min(1000) @Max(7000) Integer goalMl) {
}

record WaterEntryResponse(
        UUID id,
        int amountMl,
        String note,
        Instant loggedAt,
        LocalDate logDate) {

    static WaterEntryResponse from(WaterEntry e) {
        return new WaterEntryResponse(e.getId(), e.getAmountMl(), e.getNote(), e.getLoggedAt(), e.getLogDate());
    }
}

record WaterWeekResponse(int goalMl, List<WaterWeekDay> days) {
}

record WaterWeekDay(String date, int ml) {
}

record WaterSummaryResponse(
        LocalDate date,
        int goalMl,
        int consumedMl,
        int remainingMl,
        List<WaterEntryResponse> entries) {
}
