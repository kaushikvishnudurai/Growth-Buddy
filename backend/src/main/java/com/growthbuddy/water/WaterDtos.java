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

    /**
     * [logDate, drinkType, sum(amountMl)] per day and drink that has entries; days
     * with none are absent. Raw millilitres: WaterService applies the hydration
     * factor per drink, so the factors live in one place (DrinkType).
     */
    @Query("select e.logDate, e.drinkType, sum(e.amountMl) from WaterEntry e where e.userId = :userId"
            + " and e.logDate between :from and :to group by e.logDate, e.drinkType")
    List<Object[]> totalsByDay(@Param("userId") UUID userId,
                               @Param("from") LocalDate from, @Param("to") LocalDate to);
}

interface WaterGoalRepository extends JpaRepository<WaterGoal, UUID> {
}

record AddWaterEntryRequest(
        @Min(1) @Max(5000) Integer amountMl,
        String note,
        Instant loggedAt,
        /** Absent: water. */
        DrinkType drinkType) {

    AddWaterEntryRequest(Integer amountMl, String note, Instant loggedAt) {
        this(amountMl, note, loggedAt, null);
    }
}

/**
 * What a glass was, and how much of it counts towards the day's water. Tea and
 * coffee carry some caffeine's mild diuretic pull, juice and milk some solids;
 * the factors are a nudge, not physiology. Mirrored by HYDRATION in
 * scripts/nutrition.js for the card's optimistic total.
 */
enum DrinkType {
    water(1.0),
    tea(0.9),
    coffee(0.8),
    juice(0.9),
    milk(0.9),
    other(1.0);

    final double factor;

    DrinkType(double factor) {
        this.factor = factor;
    }

    /** Millilitres that count towards the goal; null is water. */
    static int effectiveMl(DrinkType type, int amountMl) {
        return (int) Math.round(amountMl * (type == null ? 1.0 : type.factor));
    }
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
        LocalDate logDate,
        /** water when the row has none. */
        DrinkType drinkType,
        /** amountMl times the drink's hydration factor: what counts towards the goal. */
        int effectiveMl) {

    static WaterEntryResponse from(WaterEntry e) {
        DrinkType t = e.getDrinkType() != null ? e.getDrinkType() : DrinkType.water;
        return new WaterEntryResponse(e.getId(), e.getAmountMl(), e.getNote(), e.getLoggedAt(), e.getLogDate(),
                t, DrinkType.effectiveMl(t, e.getAmountMl()));
    }
}

record WaterWeekResponse(int goalMl, List<WaterWeekDay> days) {
}

record WaterWeekDay(String date, int ml) {
}

/**
 * consumedMl is the EFFECTIVE total (each drink times its hydration factor), the
 * figure the goal is judged by; drankMl is the raw sum of what was poured.
 */
record WaterSummaryResponse(
        LocalDate date,
        int goalMl,
        int consumedMl,
        int remainingMl,
        List<WaterEntryResponse> entries,
        int drankMl) {
}
