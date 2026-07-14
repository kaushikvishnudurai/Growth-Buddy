package com.growthbuddy.water;

import com.growthbuddy.common.ApiException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class WaterService {

    private static final int DEFAULT_GOAL_ML = 2000;

    private final WaterEntryRepository entries;
    private final WaterGoalRepository goals;

    public WaterService(WaterEntryRepository entries, WaterGoalRepository goals) {
        this.entries = entries;
        this.goals = goals;
    }

    @Transactional(readOnly = true)
    public WaterSummaryResponse summary(UUID userId, LocalDate date) {
        LocalDate day = date != null ? date : LocalDate.now();
        int goalMl = goal(userId);
        int consumed = entries.totalForDay(userId, day);
        int remaining = Math.max(goalMl - consumed, 0);
        List<WaterEntryResponse> row = entries.findByUserIdAndLogDateOrderByLoggedAtAsc(userId, day)
                .stream()
                .map(WaterEntryResponse::from)
                .toList();
        return new WaterSummaryResponse(day, goalMl, consumed, remaining, row);
    }

    @Transactional
    public WaterSummaryResponse addEntry(UUID userId, AddWaterEntryRequest req) {
        if (req == null || req.amountMl() == null) {
            throw ApiException.badRequest("amountMl is required");
        }
        WaterEntry e = new WaterEntry();
        e.setUserId(userId);
        e.setAmountMl(req.amountMl());
        e.setNote(StringUtils.hasText(req.note()) ? req.note().trim() : null);
        if (req.loggedAt() != null) {
            Instant ts = req.loggedAt();
            e.setLoggedAt(ts);
            e.setLogDate(ts.atZone(ZoneOffset.UTC).toLocalDate());
        }
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

    @Transactional
    public WaterSummaryResponse updateGoal(UUID userId, UpdateWaterGoalRequest req) {
        if (req == null || req.goalMl() == null) {
            throw ApiException.badRequest("goalMl is required");
        }
        WaterGoal g = goals.findById(userId).orElseGet(() -> {
            WaterGoal n = new WaterGoal();
            n.setUserId(userId);
            return n;
        });
        g.setGoalMl(req.goalMl());
        g.setUpdatedAt(Instant.now());
        goals.save(g);
        return summary(userId, LocalDate.now());
    }

    private int goal(UUID userId) {
        return goals.findById(userId)
                .map(WaterGoal::getGoalMl)
                .orElse(DEFAULT_GOAL_ML);
    }
}
