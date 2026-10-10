package com.growthbuddy.water;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class WaterService {

    private static final int DEFAULT_GOAL_ML = 2000;

    /** How far ahead of the server a client's "now" may be (a phone clock running fast). */
    static final java.time.Duration FUTURE_SLACK = java.time.Duration.ofMinutes(10);

    private final WaterEntryRepository entries;
    private final WaterGoalRepository goals;
    private final UserClock clock;
    private final UserRepository users;

    public WaterService(WaterEntryRepository entries, WaterGoalRepository goals, UserClock clock,
            UserRepository users) {
        this.entries = entries;
        this.goals = goals;
        this.clock = clock;
        this.users = users;
    }

    @Transactional(readOnly = true)
    public WaterSummaryResponse summary(UUID userId, LocalDate date) {
        LocalDate day = date != null ? date : clock.today(userId);
        int goalMl = goal(userId);
        List<WaterEntryResponse> row = entries.findByUserIdAndLogDateOrderByLoggedAtAsc(userId, day)
                .stream()
                .map(WaterEntryResponse::from)
                .toList();
        // From the rows already read: the effective total needs each drink's factor.
        int consumed = row.stream().mapToInt(WaterEntryResponse::effectiveMl).sum();
        int drank = row.stream().mapToInt(WaterEntryResponse::amountMl).sum();
        int remaining = Math.max(goalMl - consumed, 0);
        return new WaterSummaryResponse(day, goalMl, consumed, remaining, row, drank);
    }

    @Transactional
    public WaterSummaryResponse addEntry(UUID userId, AddWaterEntryRequest req) {
        if (req == null || req.amountMl() == null) {
            throw ApiException.badRequest("amountMl is required");
        }
        WaterEntry e = new WaterEntry();
        e.setUserId(userId);
        e.setAmountMl(req.amountMl());
        // Water stays null, as every row before drink types: one meaning, not two.
        e.setDrinkType(req.drinkType() == DrinkType.water ? null : req.drinkType());
        e.setNote(StringUtils.hasText(req.note()) ? req.note().trim() : null);
        // Always bucket the entry by the drinker's own calendar day. The entity's
        // @PrePersist fallback can only guess a zone, and guessing wrong filed
        // early-morning glasses under yesterday for anyone east of UTC.
        Instant ts = req.loggedAt() != null ? req.loggedAt() : Instant.now();
        LocalDate day = ts.atZone(clock.zoneOf(userId)).toLocalDate();
        // Backdating is what loggedAt is for (a glass queued offline, or a past day
        // from the custom dialog); a future one is not. FUTURE_SLACK lets a phone
        // clock running a few minutes fast still log "now".
        if (day.isAfter(clock.today(userId)) || ts.isAfter(Instant.now().plus(FUTURE_SLACK))) {
            throw ApiException.badRequest("You can't log water for a time that hasn't happened yet.");
        }
        e.setLoggedAt(ts);
        e.setLogDate(day);
        WaterEntry saved = entries.save(e);
        return summary(userId, saved.getLogDate());
    }

    @Transactional
    public WaterSummaryResponse deleteEntry(UUID userId, UUID entryId) {
        WaterEntry e = entries.findByIdAndUserId(entryId, userId)
                .orElseThrow(() -> ApiException.notFound("Water entry"));
        LocalDate day = e.getLogDate();
        entries.delete(e);
        return summary(userId, day);
    }

    // One goal, on users.daily_water_goal_ml: the column Settings -> Profile edits.
    // It used to live only in water_goals, so a goal saved in Settings never
    // reached the tracker. An account that set one on the tracker before the move
    // keeps seeing it (the old row is read first) until the goal is edited on
    // either screen, which drops the row. Nobody's goal changes on its own.
    @Transactional
    public WaterSummaryResponse updateGoal(UUID userId, UpdateWaterGoalRequest req) {
        if (req == null || req.goalMl() == null) {
            throw ApiException.badRequest("goalMl is required");
        }
        var user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User"));
        user.setDailyWaterGoalMl(req.goalMl());
        users.save(user);
        dropLegacyGoal(userId);
        return summary(userId, clock.today(userId));
    }

    @Transactional(readOnly = true)
    public List<Instant> times(UUID userId, int days) {
        return entries.loggedTimesSince(userId, clock.today(userId).minusDays(Math.max(1, Math.min(days, 60))));
    }

    /**
     * The Food summary's water row: 7 days, oldest first, against today's goal.
     * One GROUP BY; a day with no entries is absent from it and reads as 0.
     */
    @Transactional(readOnly = true)
    public WaterWeekResponse week(UUID userId) {
        LocalDate today = clock.today(userId);
        java.util.Map<LocalDate, Integer> totals = totalsByDay(userId, today.minusDays(6), today);
        List<WaterWeekDay> days = new java.util.ArrayList<>();
        for (int i = 6; i >= 0; i--) {
            LocalDate d = today.minusDays(i);
            days.add(new WaterWeekDay(d.toString(), totals.getOrDefault(d, 0)));
        }
        return new WaterWeekResponse(goal(userId), days);
    }

    /**
     * Effective millilitres per day in [from, to] (each drink times its hydration
     * factor); a day with no entries is absent. For FoodWeek's diet check, the
     * Food summary and Progress.
     */
    @Transactional(readOnly = true)
    public java.util.Map<LocalDate, Integer> totalsByDay(UUID userId, LocalDate from, LocalDate to) {
        java.util.Map<LocalDate, Integer> totals = new java.util.HashMap<>();
        for (Object[] r : entries.totalsByDay(userId, from, to)) {
            int ml = DrinkType.effectiveMl((DrinkType) r[1], ((Number) r[2]).intValue());
            totals.merge((LocalDate) r[0], ml, Integer::sum);
        }
        return totals;
    }

    @Transactional(readOnly = true)
    public int goalMl(UUID userId) {
        return goal(userId);
    }

    /** Called by a profile save that changes the goal, and by updateGoal. */
    @Transactional
    public void dropLegacyGoal(UUID userId) {
        goals.deleteById(userId);
    }

    private int goal(UUID userId) {
        return goals.findById(userId)
                .map(WaterGoal::getGoalMl)
                .or(() -> users.findById(userId).map(u -> u.getDailyWaterGoalMl()))
                .orElse(DEFAULT_GOAL_ML);
    }
}
