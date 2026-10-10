package com.growthbuddy.focus;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Records completed focus sessions and reports simple stats. Storage is bounded:
 * we keep at most {@link #MAX_PER_USER} sessions per user and prune the oldest
 * on insert, so the table stays flat no matter how long someone uses the app.
 */
@Service
public class FocusService {

    /** Hard cap on stored sessions per user — plenty for stats, never unbounded. */
    private static final int MAX_PER_USER = 500;

    /** How far back a daily-goal streak is looked for. The retention cap reaches
     *  about this far for a daily user anyway. */
    static final int STREAK_LOOKBACK_DAYS = 400;

    /** The daily focus goal's ceiling, in minutes (12 hours). */
    static final int MAX_GOAL_MINUTES = 720;

    private final FocusSessionRepository repo;
    private final UserClock clock;
    private final UserRepository users;
    private final FocusLinks links;

    @PersistenceContext
    private EntityManager em;

    public FocusService(FocusSessionRepository repo, UserClock clock, UserRepository users, FocusLinks links) {
        this.repo = repo;
        this.clock = clock;
        this.users = users;
        this.links = links;
    }

    /**
     * goalMinutes: the user's daily focus goal ({@code ui_prefs.focusGoalMins}),
     * 0 when off. goalStreak: consecutive days, up to today, whose focus met it;
     * today not met yet doesn't break it (the day isn't over), so it counts back
     * from yesterday then. Always 0 with no goal.
     */
    public record FocusStats(int todayMinutes, int todaySessions, int weekMinutes, long totalSessions,
                             int goalMinutes, int goalStreak) {}

    public record DayMinutes(String date, int minutes) {}

    /** Focus minutes this week on one linked task or goal. kind: "task" | "goal". */
    public record LinkTotal(String kind, UUID id, String title, int minutes) {}

    public record FocusHistory(List<DayMinutes> days, List<LinkTotal> week) {}

    @Transactional
    public FocusStats record(UUID userId, String mode, int durationSec) {
        return record(userId, mode, durationSec, null, null);
    }

    /**
     * A finished session, optionally linked to one of the user's tasks or goals.
     * A link that isn't theirs is refused (404, the same answer as a task that
     * doesn't exist, so an id can't be probed). A break is never linked: it
     * wasn't spent on anything.
     */
    @Transactional
    public FocusStats record(UUID userId, String mode, int durationSec, UUID taskId, UUID goalId) {
        String m = normaliseMode(mode);
        if ("break".equals(m)) {
            taskId = null;
            goalId = null;
        }
        if (taskId != null && !links.ownsTask(userId, taskId)) throw ApiException.notFound("that task");
        if (goalId != null && !links.ownsGoal(userId, goalId)) throw ApiException.notFound("that goal");
        FocusSession s = new FocusSession();
        s.setUserId(userId);
        s.setMode(m);
        s.setDurationSec(clampDuration(durationSec));
        s.setTaskId(taskId);
        s.setGoalId(goalId);
        repo.save(s);
        prune(userId);
        return stats(userId);
    }

    /** Keep only the newest MAX_PER_USER rows for the user; delete the rest. */
    private void prune(UUID userId) {
        long n = repo.countByUserId(userId);
        if (n <= MAX_PER_USER) return;
        int excess = (int) (n - MAX_PER_USER);
        em.createNativeQuery(
                "DELETE FROM focus_sessions WHERE user_id = ?1 ORDER BY completed_at ASC LIMIT ?2")
                .setParameter(1, userId)
                .setParameter(2, excess)
                .executeUpdate();
    }

    /** Anything but "break" is a focus session — the only two the table holds. */
    static String normaliseMode(String mode) {
        return "break".equals(mode) ? "break" : "focus";
    }

    /** At most six hours, never negative. */
    static int clampDuration(int durationSec) {
        return Math.max(0, Math.min(durationSec, 6 * 3600));
    }

    /**
     * Where "today" and "this week" begin for this user: midnight and Monday
     * midnight in their own zone. These were the last 24 hours and the last 7
     * days, so an evening session still counted as "today" at breakfast, and
     * the week never started over.
     */
    static Instant[] windows(LocalDate today, ZoneId zone) {
        Instant day = today.atStartOfDay(zone).toInstant();
        Instant week = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .atStartOfDay(zone).toInstant();
        return new Instant[] {day, week};
    }

    @Transactional(readOnly = true)
    public FocusStats stats(UUID userId) {
        ZoneId zone = clock.zoneOf(userId);
        LocalDate today = LocalDate.now(zone);
        Instant[] w = windows(today, zone);
        int goal = goalOf(userId);
        // With a daily goal the streak needs the days before this week too.
        Instant from = goal > 0
                ? today.minusDays(STREAK_LOOKBACK_DAYS).atStartOfDay(zone).toInstant()
                : w[1];
        // Focus-mode sessions only, for every number here: a break is not focus.
        // "After" is exclusive, so step back a nanosecond to keep a session
        // stamped exactly at midnight.
        List<FocusSession> recent = repo.findByUserIdAndModeAndCompletedAtAfter(
                userId, "focus", from.minusNanos(1));
        List<FocusSession> week = goal > 0
                ? recent.stream().filter(s -> !s.getCompletedAt().isBefore(w[1])).toList()
                : recent;
        FocusStats base = summarise(week, w[0], repo.countByUserIdAndMode(userId, "focus"));
        if (goal <= 0) return base;
        return new FocusStats(base.todayMinutes(), base.todaySessions(), base.weekMinutes(),
                base.totalSessions(), goal, goalStreak(secondsByDay(recent, zone), today, goal));
    }

    /** The daily focus goal from the user's ui_prefs; 0 (off) when unset or unusable. */
    private int goalOf(UUID userId) {
        return users.findById(userId).map(User::getUiPrefs).map(FocusService::goalFromPrefs).orElse(0);
    }

    /** {@code focusGoalMins}: a number (or numeric string) of minutes, 0..720; anything else is off. */
    static int goalFromPrefs(Map<String, Object> prefs) {
        Object v = prefs == null ? null : prefs.get("focusGoalMins");
        int mins;
        if (v instanceof Number n) {
            mins = n.intValue();
        } else if (v instanceof String str) {
            try {
                mins = Integer.parseInt(str.trim());
            } catch (NumberFormatException e) {
                return 0;
            }
        } else {
            return 0;
        }
        return Math.max(0, Math.min(mins, MAX_GOAL_MINUTES));
    }

    /** Focus seconds per local day of the user's zone, each session on the day it ended. */
    static Map<LocalDate, Integer> secondsByDay(List<FocusSession> sessions, ZoneId zone) {
        Map<LocalDate, Integer> out = new HashMap<>();
        for (FocusSession s : sessions) {
            out.merge(s.getCompletedAt().atZone(zone).toLocalDate(), s.getDurationSec(), Integer::sum);
        }
        return out;
    }

    /**
     * Days in a row, ending today, whose focus reached the goal. A today still
     * short of it is a day in progress, not a miss: the count starts from
     * yesterday then, so the streak doesn't read 0 every morning.
     */
    static int goalStreak(Map<LocalDate, Integer> secByDay, LocalDate today, int goalMinutes) {
        if (goalMinutes <= 0) return 0;
        int need = goalMinutes * 60;
        LocalDate d = today;
        if (secByDay.getOrDefault(d, 0) < need) d = d.minusDays(1);
        int n = 0;
        while (n <= STREAK_LOOKBACK_DAYS && secByDay.getOrDefault(d, 0) >= need) {
            n++;
            d = d.minusDays(1);
        }
        return n;
    }

    /**
     * The last {@code days} days (1..90, today included) of focus minutes, each
     * session on its local day in the user's zone, oldest first with empty days
     * as 0; plus this week's (since local Monday) minutes per linked task / goal.
     */
    @Transactional(readOnly = true)
    public FocusHistory history(UUID userId, int days) {
        int n = Math.max(1, Math.min(days, 90));
        ZoneId zone = clock.zoneOf(userId);
        LocalDate today = LocalDate.now(zone);
        Instant weekStart = windows(today, zone)[1];
        Instant from = today.minusDays(n - 1L).atStartOfDay(zone).toInstant();
        if (weekStart.isBefore(from)) from = weekStart;
        List<FocusSession> rows = repo.findByUserIdAndModeAndCompletedAtAfter(userId, "focus", from.minusNanos(1));
        return new FocusHistory(buckets(rows, today, zone, n), weekByLink(userId, rows, weekStart));
    }

    static List<DayMinutes> buckets(List<FocusSession> rows, LocalDate today, ZoneId zone, int n) {
        Map<LocalDate, Integer> sec = secondsByDay(rows, zone);
        List<DayMinutes> out = new ArrayList<>(n);
        for (int i = n - 1; i >= 0; i--) {
            LocalDate d = today.minusDays(i);
            out.add(new DayMinutes(d.toString(), sec.getOrDefault(d, 0) / 60));
        }
        return out;
    }

    private List<LinkTotal> weekByLink(UUID userId, List<FocusSession> rows, Instant weekStart) {
        Map<UUID, Integer> taskSec = new LinkedHashMap<>();
        Map<UUID, Integer> goalSec = new LinkedHashMap<>();
        for (FocusSession s : rows) {
            if (s.getCompletedAt().isBefore(weekStart)) continue;
            if (s.getTaskId() != null) taskSec.merge(s.getTaskId(), s.getDurationSec(), Integer::sum);
            if (s.getGoalId() != null) goalSec.merge(s.getGoalId(), s.getDurationSec(), Integer::sum);
        }
        Map<UUID, String> taskTitles = taskSec.isEmpty() ? Map.of() : links.taskTitles(userId, taskSec.keySet());
        Map<UUID, String> goalTitles = goalSec.isEmpty() ? Map.of() : links.goalTitles(userId, goalSec.keySet());
        List<LinkTotal> out = new ArrayList<>();
        taskSec.forEach((id, sec) -> out.add(new LinkTotal("task", id, taskTitles.get(id), sec / 60)));
        goalSec.forEach((id, sec) -> out.add(new LinkTotal("goal", id, goalTitles.get(id), sec / 60)));
        // A title of null is a task or goal since deleted: its minutes still happened.
        out.removeIf(t -> t.minutes() <= 0);
        out.sort(Comparator.comparingInt(LinkTotal::minutes).reversed());
        return out;
    }

    static FocusStats summarise(List<FocusSession> sinceWeekStart, Instant dayStart, long totalFocus) {
        int todaySec = 0;
        int todayCount = 0;
        int weekSec = 0;
        for (FocusSession s : sinceWeekStart) {
            weekSec += s.getDurationSec();
            if (!s.getCompletedAt().isBefore(dayStart)) {
                todaySec += s.getDurationSec();
                todayCount++;
            }
        }
        return new FocusStats(
                (int) Duration.ofSeconds(todaySec).toMinutes(),
                todayCount,
                (int) Duration.ofSeconds(weekSec).toMinutes(),
                totalFocus, 0, 0);
    }
}
