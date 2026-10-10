package com.growthbuddy.habit;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.ProgressService;
import com.growthbuddy.user.UserClock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.WeekFields;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HabitService {

    /** Most freeze tokens a user can bank at once. One is granted per ISO week. */
    public static final int FREEZE_CAP = 2;

    /**
     * How far back the read paths load check-ins. A live streak walks back only
     * until its first gap, so this bounds a run only for someone over ~13 months
     * unbroken, and then the cached {@link HabitStreak} (recomputed from the full
     * history on every mutation) takes over; see {@link #liveOrCached}.
     */
    static final int HISTORY_WINDOW_DAYS = 400;

    /**
     * Every icon the app can put on a habit: the DOMAIN icons in gb-kit.js, the
     * FITNESS_PRESETS in app.js, and DataSeeder's. Anything else renders as an
     * empty tile. ponytail: hand-kept mirror of those three lists; add here when
     * the habit form gains an icon.
     */
    static final Set<String> HABIT_ICONS = Set.of(
            "repeat", "dumbbell", "sparkles", "notebook-pen", "users-round", "trophy",
            "book-open", "briefcase", "footprints", "bike", "brain",
            // HABIT_TEMPLATES in app.js; "ban" is a quit habit's own icon.
            "droplets", "leaf", "ban");

    private final HabitRepository habits;
    private final HabitCheckinRepository checkins;
    private final HabitStreakRepository streaks;
    private final StreakFreezeWalletRepository wallets;
    private final ProgressService progress;
    private final UserClock clock;

    public HabitService(HabitRepository habits, HabitCheckinRepository checkins,
                        HabitStreakRepository streaks,
                        StreakFreezeWalletRepository wallets,
                        ProgressService progress,
                        UserClock clock) {
        this.habits = habits;
        this.checkins = checkins;
        this.streaks = streaks;
        this.wallets = wallets;
        this.progress = progress;
        this.clock = clock;
    }

    /* ---- Freeze-token wallet (weekly grant) ---- */

    /** Load (or create) the wallet, topping it up if a new ISO week has started. */
    private StreakFreezeWallet wallet(UUID userId, LocalDate today) {
        LocalDate thisWeek = weekStart(today);
        StreakFreezeWallet[] created = {null};
        StreakFreezeWallet w = wallets.findById(userId).orElseGet(() -> {
            StreakFreezeWallet n = new StreakFreezeWallet();
            n.setUserId(userId);
            n.setTokens(1);
            n.setWeekAnchor(thisWeek);
            created[0] = n;
            return n;
        });
        boolean isNew = created[0] != null;
        boolean topUp = w.getWeekAnchor() == null || w.getWeekAnchor().isBefore(thisWeek);
        if (topUp) {
            w.setWeekAnchor(thisWeek);
            w.setTokens(Math.min(FREEZE_CAP, w.getTokens() + 1));
        }
        // Only write when something actually changed — the habit list reads the
        // wallet on every render, and an unconditional save was an UPSERT per call.
        if (isNew || topUp) {
            wallets.save(w);
        }
        return w;
    }

    @Transactional
    public FreezeStatus freezeStatus(UUID userId) {
        return new FreezeStatus(wallet(userId, clock.today(userId)).getTokens(), FREEZE_CAP);
    }

    /**
     * A habit's recent days, so the freeze calendar can show which were done,
     * which were missed and which a token already covers. Missed days are the
     * gaps — a day with no check-in row at all — so only the days that exist
     * are returned and the client fills the rest of the month in as missed.
     */
    @Transactional(readOnly = true)
    public HabitHistory history(UUID userId, UUID id, int days) {
        Habit h = require(userId, id);
        ZoneId zone = clock.zoneOf(userId);
        // Clamped like historyAll: ?days=2147483647 made minusDays throw (a 500).
        LocalDate from = clock.today(userId).minusDays(clampHistoryDays(days));
        // The habit's own start, in the user's zone — a day before it existed is
        // not a day they missed.
        LocalDate since = LocalDate.ofInstant(h.getCreatedAt(), zone);
        List<HabitDay> rows = checkins.findByHabitIdAndLogDateGreaterThanEqualOrderByLogDateDesc(id, from)
                .stream()
                .map(HabitDay::of)
                .toList();
        return new HabitHistory(since.isBefore(from) ? from : since, rows);
    }

    /**
     * {@link #history} for every habit the user has, in one check-in query —
     * Insights asked once per daily habit, so ten habits were ten requests on
     * every Report open. Same shape per habit ({@code since} included), keyed by
     * habit id, in the user's order; a habit with no check-ins in range maps to an
     * empty {@code days}. {@code days} is clamped to 1..{@link #HISTORY_WINDOW_DAYS}:
     * this one reads every habit at once, so an unbounded value was a full-table
     * read per request.
     */
    @Transactional(readOnly = true)
    public Map<UUID, HabitHistory> historyAll(UUID userId, int days) {
        List<Habit> rows = habits.findByUserIdAndDeletedAtIsNullOrderBySortOrderAscCreatedAtAsc(userId);
        Map<UUID, HabitHistory> out = new java.util.LinkedHashMap<>();
        if (rows.isEmpty()) {
            return out;
        }
        ZoneId zone = clock.zoneOf(userId);
        LocalDate from = clock.today(userId).minusDays(clampHistoryDays(days));
        Map<UUID, List<HabitDay>> byHabit = new HashMap<>();
        // Newest first, as the single-habit read returns them. Rows of a deleted
        // habit come back too and are simply never looked up.
        for (HabitCheckin c : checkins.findByUserIdAndLogDateGreaterThanEqualOrderByLogDateDesc(userId, from)) {
            byHabit.computeIfAbsent(c.getHabitId(), k -> new ArrayList<>())
                    .add(HabitDay.of(c));
        }
        for (Habit h : rows) {
            LocalDate since = LocalDate.ofInstant(h.getCreatedAt(), zone);
            out.put(h.getId(), new HabitHistory(since.isBefore(from) ? from : since,
                    byHabit.getOrDefault(h.getId(), List.of())));
        }
        return out;
    }

    static int clampHistoryDays(int days) {
        return Math.max(1, Math.min(days, HISTORY_WINDOW_DAYS));
    }

    /** Protect a day (rest/freeze): spend a token, mark the day, recompute. */
    @Transactional
    public HabitResponse protect(UUID userId, UUID id, LocalDate date) {
        Habit h = require(userId, id);
        LocalDate today = clock.today(userId);
        LocalDate day = date != null ? date : today;
        if (day.isAfter(today)) {
            // Usually not a future day at all: the account's timezone is behind
            // the device's (travel, or an API signup that left it on UTC).
            throw ApiException.badRequest("That day hasn't started yet in your timezone ("
                    + clock.zoneOf(userId).getId() + "). If that's wrong, update it in Settings.");
        }
        if (h.getCreatedAt() != null
                && day.isBefore(LocalDate.ofInstant(h.getCreatedAt(), clock.zoneOf(userId)))) {
            // A day before the habit existed was never missed, so a token spent
            // on it bought nothing.
            throw ApiException.badRequest("That day is before you started this habit");
        }
        if (isQuit(h)) {
            // Nothing to bridge: a quit habit's day is clean unless a slip is logged.
            throw ApiException.badRequest("A habit you're breaking doesn't need a freeze");
        }
        HabitCheckin c = checkins.findByHabitIdAndLogDate(id, day).orElse(null);
        if (c != null && c.isDone()) {
            throw ApiException.badRequest("That day is already completed");
        }
        if (c == null || !c.isProtectedDay()) {
            StreakFreezeWallet w = wallet(userId, today);
            if (w.getTokens() <= 0) {
                throw ApiException.badRequest("No freezes left this week");
            }
            w.setTokens(w.getTokens() - 1);
            wallets.save(w);
            if (c == null) {
                c = new HabitCheckin();
                c.setHabitId(id);
                c.setLogDate(day);
                c.setUserId(userId);
            }
            c.setDone(false);
            c.setProtectedDay(true);
            checkins.save(c);
            recomputeStreak(h, today);
        }
        return toResponse(h, today, userId);
    }

    /** Undo a protected day and refund the token. */
    @Transactional
    public HabitResponse unprotect(UUID userId, UUID id, LocalDate date) {
        Habit h = require(userId, id);
        LocalDate today = clock.today(userId);
        LocalDate day = date != null ? date : today;
        HabitCheckin c = checkins.findByHabitIdAndLogDate(id, day).orElse(null);
        if (c != null && c.isProtectedDay()) {
            c.setProtectedDay(false);
            checkins.save(c);
            StreakFreezeWallet w = wallet(userId, today);
            w.setTokens(Math.min(FREEZE_CAP, w.getTokens() + 1));
            wallets.save(w);
            recomputeStreak(h, today);
        }
        return toResponse(h, today, userId);
    }

    // Read-write (not readOnly): wallet() may persist a weekly token grant.
    @Transactional
    public List<HabitResponse> list(UUID userId) {
        LocalDate today = clock.today(userId);
        // The user's own order (PUT /order), oldest first among ties.
        List<Habit> rows = habits.findByUserIdAndDeletedAtIsNullOrderBySortOrderAscCreatedAtAsc(userId);
        if (rows.isEmpty()) {
            return List.of();
        }
        // Batch the reads that used to run per-habit (was 2 full-history queries
        // + a streak write + a wallet upsert *per habit* on the hottest endpoint):
        //   - all check-ins for the user in one query, grouped by habit
        //   - all streak rows in one query
        //   - the wallet once
        // Streaks are already recomputed on every mutation, so we don't rewrite
        // them here — just read the cached value.
        Map<UUID, List<HabitCheckin>> byHabit = new HashMap<>();
        LocalDate from = today.minusDays(HISTORY_WINDOW_DAYS);
        for (HabitCheckin c : checkins.findByUserIdAndLogDateGreaterThanEqualOrderByLogDateDesc(userId, from)) {
            byHabit.computeIfAbsent(c.getHabitId(), k -> new ArrayList<>()).add(c);
        }
        Map<UUID, HabitStreak> streakById = new HashMap<>();
        for (HabitStreak s : streaks.findAllById(rows.stream().map(Habit::getId).toList())) {
            streakById.put(s.getHabitId(), s);
        }
        int tokens = wallet(userId, today).getTokens();
        // Only a quit habit needs the zone (its start day); most lists have none.
        ZoneId zone = rows.stream().anyMatch(HabitService::isQuit) ? clock.zoneOf(userId) : null;
        if (zone != null) {
            creditCleanDays(userId, rows, byHabit, today, zone);
        }
        return rows.stream()
                .map(h -> toResponse(h, today,
                        byHabit.getOrDefault(h.getId(), List.of()),
                        streakById.get(h.getId()), tokens, zone))
                .toList();
    }

    /**
     * Pay a quit habit's finished clean days, each once. Clean days are not rows,
     * so nothing else would ever reach them: the habit list (the screen's main
     * read, already read-write for the wallet) settles every day up to yesterday
     * and moves {@code cleanCreditedThrough} past it. Today is never paid — it
     * can still be slipped. A slip logged on a day already paid takes nothing
     * back, and un-slipping it pays nothing again, so there is nothing to farm.
     */
    private void creditCleanDays(UUID userId, List<Habit> rows, Map<UUID, List<HabitCheckin>> byHabit,
                                 LocalDate today, ZoneId zone) {
        int days = 0;
        List<Habit> moved = new ArrayList<>();
        for (Habit h : rows) {
            if (!isQuit(h)) {
                continue;
            }
            Set<LocalDate> slips = slipDates(byHabit.getOrDefault(h.getId(), List.of()));
            int paid = creditableCleanDays(h, slips, today, zone);
            LocalDate through = today.minusDays(1);
            if (h.getCleanCreditedThrough() == null || h.getCleanCreditedThrough().isBefore(through)) {
                h.setCleanCreditedThrough(through);
                moved.add(h);
            }
            days += paid;
        }
        if (!moved.isEmpty()) {
            habits.saveAll(moved);
        }
        if (days > 0) {
            progress.awardHabitCleanDays(userId, days);
        }
    }

    /**
     * How many of a quit habit's days, after {@code cleanCreditedThrough} and up
     * to yesterday, were clean and are owed XP. None for a build habit, and none
     * while it is paused (ponytail: the pause state at settle time stands for the
     * whole span; a per-day pause log would make it exact). Bounded to the read
     * window, which is all the slips the caller loaded.
     */
    static int creditableCleanDays(Habit h, Set<LocalDate> slips, LocalDate today, ZoneId zone) {
        if (!isQuit(h) || !h.isActive()) {
            return 0;
        }
        LocalDate start = startDay(h, zone, today);
        LocalDate from = h.getCleanCreditedThrough() == null ? start : h.getCleanCreditedThrough().plusDays(1);
        if (from.isBefore(start)) {
            from = start;
        }
        LocalDate floor = today.minusDays(HISTORY_WINDOW_DAYS);
        if (from.isBefore(floor)) {
            from = floor;
        }
        int clean = 0;
        for (LocalDate d = from; d.isBefore(today); d = d.plusDays(1)) {
            if (!slips.contains(d)) {
                clean++;
            }
        }
        return clean;
    }

    /* ---- "Break a habit" (HabitKind.quit) ---- */

    static boolean isQuit(Habit h) {
        return h.getKind() == HabitKind.quit;
    }

    /** On a quit habit, the row that records a slip: not done, and not a freeze. */
    static boolean isSlip(HabitCheckin c) {
        return !c.isDone() && !c.isProtectedDay();
    }

    private static Set<LocalDate> slipDates(List<HabitCheckin> rows) {
        Set<LocalDate> out = new HashSet<>();
        for (HabitCheckin c : rows) {
            if (isSlip(c)) {
                out.add(c.getLogDate());
            }
        }
        return out;
    }

    /** The habit's first day in the user's zone; today when that can't be told. */
    static LocalDate startDay(Habit h, ZoneId zone, LocalDate today) {
        if (h.getCreatedAt() == null || zone == null) {
            return today;
        }
        LocalDate d = LocalDate.ofInstant(h.getCreatedAt(), zone);
        return d.isAfter(today) ? today : d;
    }

    /**
     * A quit habit's streak: clean days in the run ending today, today included
     * unless it was slipped. Days since the last slip, or since the habit
     * started when there has been none — so day one reads 1, a slip today 0.
     */
    static int quitStreak(LocalDate today, LocalDate start, LocalDate lastSlip) {
        LocalDate anchor = start.minusDays(1);
        if (lastSlip != null && lastSlip.isAfter(anchor)) {
            anchor = lastSlip;
        }
        return (int) Math.max(0, java.time.temporal.ChronoUnit.DAYS.between(anchor, today));
    }

    /** The longest clean run between slips (and from the start, and up to today). */
    static int longestQuitRun(LocalDate today, LocalDate start, Set<LocalDate> slips) {
        LocalDate prev = start.minusDays(1);
        int longest = 0;
        for (LocalDate s : new TreeSet<>(slips)) {
            if (s.isAfter(today)) {
                break;
            }
            if (!s.isAfter(prev)) {
                continue;
            }
            longest = Math.max(longest, (int) java.time.temporal.ChronoUnit.DAYS.between(prev, s) - 1);
            prev = s;
        }
        return Math.max(longest, quitStreak(today, start, prev));
    }

    /**
     * Human-readable summary of the user's habits today, for the AI mentor's
     * silent context (so it can answer "plan my day" without the user
     * pasting their list).
     */
    @Transactional(readOnly = true)
    public String contextSummary(UUID userId) {
        List<Habit> hs = habits.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(userId);
        if (hs.isEmpty()) return "Habits: none tracked.\n";
        LocalDate today = clock.today(userId);
        StringBuilder sb = new StringBuilder("Habits:\n");
        for (Habit h : hs) {
            HabitStreak s = streaks.findById(h.getId()).orElse(null);
            if (isQuit(h)) {
                // The cache's lastDoneOn is the last slip on a quit habit; its
                // current streak goes stale a day at a time, so it is worked out.
                LocalDate lastSlip = s == null ? null : s.getLastDoneOn();
                boolean slipped = today.equals(lastSlip);
                sb.append("  - Quitting: ").append(h.getName())
                        .append(" — ").append(slipped ? "slipped today" : "clean today")
                        .append(", ").append(quitStreak(today, startDay(h, clock.zoneOf(userId), today), lastSlip))
                        .append(" days clean\n");
                continue;
            }
            boolean done = checkins.existsByHabitIdAndLogDateAndDoneTrue(h.getId(), today);
            int streak = s == null ? 0 : s.getCurrentStreak();
            sb.append("  - ").append(h.getName())
                    .append(" — ").append(done ? "done today" : "not yet today")
                    .append(", ").append(streak).append("-day streak\n");
        }
        return sb.toString();
    }

    /** One habit's streak, for a mentor's weekly check-in card (HabitResponse is package-private). */
    public record StreakLine(String name, int streak, int longestStreak, boolean doneToday) {
    }

    /**
     * The user's active habits with their cached streaks, in their own order.
     * Read-only: three queries, no streak recompute and no wallet write (which
     * {@link #list} may do), so another user's read can't touch their rows.
     */
    @Transactional(readOnly = true)
    public List<StreakLine> streakLines(UUID userId) {
        List<Habit> hs = habits.findByUserIdAndDeletedAtIsNullOrderBySortOrderAscCreatedAtAsc(userId).stream()
                .filter(Habit::isActive).toList();
        if (hs.isEmpty()) {
            return List.of();
        }
        LocalDate today = clock.today(userId);
        Map<UUID, HabitStreak> byId = new HashMap<>();
        streaks.findAllById(hs.stream().map(Habit::getId).toList()).forEach(s -> byId.put(s.getHabitId(), s));
        Set<UUID> doneToday = new HashSet<>();
        checkins.findByUserIdAndLogDateAndDoneTrue(userId, today).forEach(c -> doneToday.add(c.getHabitId()));
        List<StreakLine> out = new ArrayList<>();
        for (Habit h : hs) {
            HabitStreak s = byId.get(h.getId());
            if (isQuit(h)) {
                // Clean unless today is the last slip (the cache's lastDoneOn on a quit habit).
                LocalDate lastSlip = s == null ? null : s.getLastDoneOn();
                int clean = quitStreak(today, startDay(h, clock.zoneOf(userId), today), lastSlip);
                out.add(new StreakLine(h.getName(), clean,
                        Math.max(clean, s == null ? 0 : s.getLongestStreak()), !today.equals(lastSlip)));
                continue;
            }
            out.add(new StreakLine(h.getName(), s == null ? 0 : s.getCurrentStreak(),
                    s == null ? 0 : s.getLongestStreak(), doneToday.contains(h.getId())));
        }
        return out;
    }

    /** Completed habit check-ins in [start, end] — used by circle challenge leaderboards. */
    @Transactional(readOnly = true)
    public long countDoneBetween(UUID userId, LocalDate start, LocalDate end) {
        return checkins.countByUserIdAndDoneTrueAndLogDateBetween(userId, start, end);
    }

    /** Batched variant: done-counts for many users in one query (userId → count). */
    @Transactional(readOnly = true)
    public Map<UUID, Long> countDoneBetween(List<UUID> userIds, LocalDate start, LocalDate end) {
        Map<UUID, Long> out = new HashMap<>();
        if (userIds.isEmpty()) {
            return out;
        }
        for (Object[] row : checkins.countDoneByUsersBetween(userIds, start, end)) {
            out.put((UUID) row[0], (Long) row[1]);
        }
        return out;
    }

    /** Today's completed-vs-total habit counts (used by the daily score). */
    @Transactional(readOnly = true)
    public TodayCounts todayCounts(UUID userId) {
        return countsOn(userId, clock.today(userId));
    }

    /**
     * The same counts for any day. Check-ins are stored against a log date, so a
     * day that has already ended still answers truthfully — which is what the
     * digest needs, since it reports a day the midnight sweep has already rolled.
     */
    @Transactional(readOnly = true)
    public TodayCounts countsOn(UUID userId, LocalDate day) {
        List<Habit> list = habits.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(userId);
        if (list.isEmpty()) {
            return new TodayCounts(0, 0);
        }
        // Two queries instead of one-exists-per-habit: the week's done check-ins up
        // to and including `day` (a weekly habit needs the earlier days to know
        // whether it is still owed).
        // Every row, not just the done ones: a quit habit's slip is a not-done row.
        List<HabitCheckin> week = checkins.findByUserIdAndLogDateBetween(
                userId, weekStart(day), day);
        return countDue(list, week, day, clock.zoneOf(userId));
    }

    /**
     * Which habits count on {@code day}, and how many of those were done. A habit
     * counts when it is active (not paused), existed by that day, and is still owed:
     * a daily habit always is; a weekly / N-per-week habit is owed until the week's
     * quota is met on an earlier day, so a Monday run on a once-a-week habit stops
     * reading as a miss on Tuesday. A habit done on {@code day} always counts (and
     * counts as done), so ticking it never shrinks the total under the user.
     * Soft-deleted habits are not in {@code habitsList}, so their check-ins are ignored.
     * A quit habit counts every day it is active and existed, and counts as done
     * unless {@code day} holds its slip (a not-done, not-frozen row).
     */
    static TodayCounts countDue(List<Habit> habitsList, List<HabitCheckin> weekDone,
                                LocalDate day, ZoneId zone) {
        Map<UUID, Integer> earlier = new HashMap<>();
        Set<UUID> doneOnDay = new HashSet<>();
        Set<UUID> slipOnDay = new HashSet<>();
        for (HabitCheckin c : weekDone) {
            if (!c.isDone()) {
                if (isSlip(c) && c.getLogDate().isEqual(day)) {
                    slipOnDay.add(c.getHabitId());
                }
                continue;
            }
            if (c.getLogDate().isEqual(day)) {
                doneOnDay.add(c.getHabitId());
            } else if (c.getLogDate().isBefore(day) && !c.getLogDate().isBefore(weekStartOf(day))) {
                earlier.merge(c.getHabitId(), 1, Integer::sum);
            }
        }
        int done = 0;
        int total = 0;
        for (Habit h : habitsList) {
            if (isQuit(h)) {
                if (isDue(h, 0, day, zone)) {
                    total++;
                    if (!slipOnDay.contains(h.getId())) {
                        done++;
                    }
                }
                continue;
            }
            boolean doneThatDay = doneOnDay.contains(h.getId());
            if (doneThatDay || isDue(h, earlier.getOrDefault(h.getId(), 0), day, zone)) {
                total++;
                if (doneThatDay) {
                    done++;
                }
            }
        }
        return new TodayCounts(done, total);
    }

    /**
     * Owed on {@code day}, given the done days earlier in the same ISO week. A null
     * {@code zone} skips the "existed by then" check (moot when asking about today).
     */
    static boolean isDue(Habit h, int doneEarlierThisWeek, LocalDate day, ZoneId zone) {
        if (!h.isActive()) {
            return false;
        }
        if (zone != null && h.getCreatedAt() != null
                && day.isBefore(LocalDate.ofInstant(h.getCreatedAt(), zone))) {
            return false;
        }
        return doneEarlierThisWeek < requiredPerWeek(h);
    }

    /** Done days a week asks for: daily = every day, weekly = 1, custom = its target. */
    static int requiredPerWeek(Habit h) {
        if (h.getCadence() == Cadence.weekly) {
            return 1;
        }
        if (h.getCadence() == Cadence.custom) {
            return Math.max(1, Math.min(7, h.getTargetPerWeek()));
        }
        return Integer.MAX_VALUE; // daily: never "met for the week"
    }

    /** Completed-vs-total pair for a single day. */
    public record TodayCounts(int done, int total) {
    }

    private static String checkIcon(String icon) {
        if (!HABIT_ICONS.contains(icon)) {
            throw ApiException.badRequest("Unknown habit icon: " + icon);
        }
        return icon;
    }

    @Transactional
    public HabitResponse create(UUID userId, CreateHabitRequest req) {
        Habit h = new Habit();
        h.setUserId(userId);
        h.setName(req.name().trim());
        h.setDomain(req.domain() != null ? req.domain() : HabitDomain.habit);
        h.setIcon(checkIcon(req.icon()));
        h.setColor(req.color());
        h.setCadence(req.cadence() != null ? req.cadence() : Cadence.daily);
        h.setTargetPerWeek(req.targetPerWeek() != null ? req.targetPerWeek() : 7);
        h.setMetric(req.metric() != null ? req.metric() : HabitMetric.none);
        h.setReminderTime(req.reminderTime());
        h.setSound(req.sound());
        if (req.kind() == HabitKind.quit) {
            // Breaking a habit is a daily thing with nothing to measure, and it
            // has been "paid" up to the day before it started.
            h.setKind(HabitKind.quit);
            h.setCadence(Cadence.daily);
            h.setTargetPerWeek(7);
            h.setMetric(HabitMetric.none);
            h.setCleanCreditedThrough(clock.today(userId).minusDays(1));
        }
        // A new habit goes to the bottom of the user's order: left at 0 it would
        // tie with the first habit and land second once the list was reordered.
        h.setSortOrder(nextSortOrder(
                habits.findByUserIdAndDeletedAtIsNullOrderBySortOrderAscCreatedAtAsc(userId)));
        habits.save(h);
        return toResponse(h, clock.today(userId), userId);
    }

    /** One past the largest position in use; 0 for a first habit. */
    static int nextSortOrder(List<Habit> existing) {
        int max = -1;
        for (Habit h : existing) {
            max = Math.max(max, h.getSortOrder());
        }
        return max + 1;
    }

    /**
     * Save the user's habit order ({@code PUT /api/habits/order}). {@code ids} is
     * the list top to bottom; returns the habit list in its new order.
     */
    @Transactional
    public List<HabitResponse> reorder(UUID userId, List<UUID> ids) {
        List<Habit> rows = habits.findByUserIdAndDeletedAtIsNullOrderBySortOrderAscCreatedAtAsc(userId);
        List<Habit> changed = applyOrder(rows, ids);
        if (!changed.isEmpty()) {
            habits.saveAll(changed);
        }
        return list(userId);
    }

    /**
     * Number {@code rows} (the user's live habits, in their current order) 0..n-1
     * so the ids in {@code ids} come first, in that order, and every habit the
     * request left out keeps its relative place after them — a client holding a
     * stale list (a habit added on another device) can't drop one off the end.
     * A repeated id counts once, at its first place. An id that is not one of the
     * user's live habits is refused: a deleted or foreign habit has no place here.
     * Returns only the habits whose position changed, the ones worth saving.
     */
    static List<Habit> applyOrder(List<Habit> rows, List<UUID> ids) {
        Map<UUID, Habit> byId = new HashMap<>();
        for (Habit h : rows) {
            byId.put(h.getId(), h);
        }
        List<Habit> ordered = new ArrayList<>(rows.size());
        Set<UUID> placed = new HashSet<>();
        for (UUID id : ids == null ? List.<UUID>of() : ids) {
            Habit h = id == null ? null : byId.get(id);
            if (h == null) {
                throw ApiException.notFound("Habit");
            }
            if (placed.add(id)) {
                ordered.add(h);
            }
        }
        for (Habit h : rows) {
            if (!placed.contains(h.getId())) {
                ordered.add(h);
            }
        }
        List<Habit> changed = new ArrayList<>();
        for (int i = 0; i < ordered.size(); i++) {
            Habit h = ordered.get(i);
            if (h.getSortOrder() != i) {
                h.setSortOrder(i);
                changed.add(h);
            }
        }
        return changed;
    }

    @Transactional
    public HabitResponse update(UUID userId, UUID id, UpdateHabitRequest req) {
        Habit h = require(userId, id);
        if (req.name() != null && !req.name().isBlank()) {
            h.setName(req.name().trim());
        }
        if (req.domain() != null) {
            h.setDomain(req.domain());
        }
        if (req.icon() != null) {
            h.setIcon(checkIcon(req.icon()));
        }
        if (req.color() != null) {
            h.setColor(req.color().isBlank() ? null : req.color());
        }
        if (req.cadence() != null) {
            h.setCadence(req.cadence());
        }
        if (req.targetPerWeek() != null) {
            h.setTargetPerWeek(req.targetPerWeek());
        }
        if (req.metric() != null) {
            h.setMetric(req.metric());
        }
        if (req.reminderTime() != null) {
            h.setReminderTime(req.reminderTime());
        } else if (Boolean.TRUE.equals(req.clearReminder())) {
            h.setReminderTime(null);
        }
        if (req.active() != null) {
            h.setActive(req.active());
        }
        if (req.sound() != null) {
            h.setSound(req.sound().isBlank() ? null : req.sound());
        }
        if (isQuit(h)) {
            // A quit habit stays daily and unmeasured whatever the form sent.
            h.setCadence(Cadence.daily);
            h.setTargetPerWeek(7);
            h.setMetric(HabitMetric.none);
        }
        habits.save(h);
        LocalDate today = clock.today(userId);
        if (req.cadence() != null || req.targetPerWeek() != null) {
            // The cached streak is in the old cadence's units (days vs weeks), and
            // the read path trusts it for long runs; rebuild it in the new ones.
            recomputeStreak(h, today);
        }
        return toResponse(h, today, userId);
    }

    @Transactional
    public void delete(UUID userId, UUID id) {
        Habit h = require(userId, id);
        h.setDeletedAt(Instant.now());
        habits.save(h);
    }

    /** Record (or clear) a check-in for a day, then recompute the streak. */
    @Transactional
    public HabitResponse checkin(UUID userId, UUID id, CheckinRequest req) {
        Habit h = require(userId, id);
        LocalDate today = clock.today(userId);
        LocalDate date = req.date() != null ? req.date() : today;
        if (date.isAfter(today)) {
            throw ApiException.badRequest("That day hasn't happened yet in your timezone ("
                    + clock.zoneOf(userId).getId() + ").");
        }
        boolean done = req.done() == null || req.done();

        HabitCheckin existing = checkins.findByHabitIdAndLogDate(h.getId(), date).orElse(null);
        HabitCheckin c = existing;
        if (c == null) {
            c = new HabitCheckin();
            c.setHabitId(h.getId());
            c.setLogDate(date);
            c.setUserId(userId);
            // A fresh row starts undone. The entity's field default is done = true,
            // which made a first tick look like a re-tick.
            c.setDone(false);
        }
        boolean wasDone = c.isDone();
        // XP once per habit per day. Un-ticking keeps the row (done = false), so a
        // re-tick finds it and earns nothing: tick/untick/tick used to pay 10 XP
        // every round. The one exception is completing a protected (freeze) day:
        // it was never done, and each one cost a capped token.
        boolean firstCompletion = existing == null || existing.isProtectedDay();
        c.setUserId(userId);
        c.setDone(done);
        if (done || isQuit(h)) {
            // A completed day supersedes a protected (rest/freeze) day. On a quit
            // habit done = false is a slip, which a freeze must not disguise.
            c.setProtectedDay(false);
        }
        // Absent = unchanged: re-saving a measured value used to wipe the note.
        if (req.note() != null) {
            c.setNote(req.note().isBlank() ? null : req.note());
        }
        // The number only means anything on a measured habit, and only on a day
        // that actually happened — un-ticking a day clears it rather than leaving
        // a distance behind on a day the user says they didn't do.
        if (done && h.getMetric() != HabitMetric.none) {
            c.setMetricValue(req.value());
            c.setDurationMin(req.durationMin());
        } else {
            c.setMetricValue(null);
            c.setDurationMin(null);
        }
        checkins.save(c);

        // A quit habit earns nothing here: done = true only takes a slip back (or
        // carries a note), and its clean days are paid once by creditCleanDays.
        if (!wasDone && done && firstCompletion && !isQuit(h)) {
            progress.awardHabitCheckin(userId);
        }

        recomputeStreak(h, today);
        return toResponse(h, today, userId);
    }

    /** Toggle today's check-in (used by the dashboard "done today" tap). */
    @Transactional
    public HabitResponse toggleToday(UUID userId, UUID id) {
        LocalDate today = clock.today(userId);
        boolean doneNow;
        if (isQuit(require(userId, id))) {
            // Clean unless today's row is a slip: a toggle logs a slip, or takes it back.
            HabitCheckin row = checkins.findByHabitIdAndLogDate(id, today).orElse(null);
            doneNow = row == null || !isSlip(row);
        } else {
            doneNow = checkins.existsByHabitIdAndLogDateAndDoneTrue(id, today);
        }
        return checkin(userId, id, new CheckinRequest(today, !doneNow, null, null, null));
    }

    /**
     * Rebuild the streak counters by walking consecutive completed days backward
     * from the most recent check-in.
     */
    private void recomputeStreak(Habit habit, LocalDate today) {
        List<HabitCheckin> all = checkins.findByHabitIdOrderByLogDateDesc(habit.getId());
        List<HabitCheckin> done = all.stream().filter(HabitCheckin::isDone).toList();
        Set<LocalDate> doneDates = new HashSet<>();
        Set<LocalDate> protectedDates = new HashSet<>();
        for (HabitCheckin c : all) {
            if (c.isDone()) {
                doneDates.add(c.getLogDate());
            } else if (c.isProtectedDay()) {
                protectedDates.add(c.getLogDate());
            }
        }

        HabitStreak s = streaks.findById(habit.getId()).orElseGet(() -> {
            HabitStreak n = new HabitStreak();
            n.setHabitId(habit.getId());
            return n;
        });

        if (isQuit(habit)) {
            // Days since the last slip. lastDoneOn holds that slip on a quit habit
            // (null = never slipped): the read path needs it for a run older than
            // its window, since a quit streak grows with no mutation to refresh it.
            Set<LocalDate> slips = slipDates(all);
            LocalDate start = startDay(habit, clock.zoneOf(habit.getUserId()), today);
            LocalDate lastSlip = slips.stream().filter(d -> !d.isAfter(today))
                    .max(LocalDate::compareTo).orElse(null);
            s.setCurrentStreak(quitStreak(today, start, lastSlip));
            s.setLongestStreak(Math.max(s.getLongestStreak(), longestQuitRun(today, start, slips)));
            s.setLastDoneOn(lastSlip);
            streaks.save(s);
            return;
        }

        if (done.isEmpty()) {
            s.setCurrentStreak(0);
            s.setLastDoneOn(null);
            s.setLongestStreak(Math.max(s.getLongestStreak(), 0));
            streaks.save(s);
            return;
        }

        int current;
        int longest;
        if (habit.getCadence() == Cadence.daily) {
            current = currentDailyRun(today, doneDates, protectedDates);
            longest = longestDailyRun(doneDates, protectedDates);
        } else {
            int required = habit.getCadence() == Cadence.weekly
                    ? 1
                    : Math.max(1, habit.getTargetPerWeek());
            List<LocalDate> completedWeeks = completedWeekBuckets(done, required);
            current = currentWeeklyRun(today, completedWeeks);
            longest = longestWeeklyRun(completedWeeks);
        }

        s.setCurrentStreak(current);
        s.setLastDoneOn(done.get(0).getLogDate());
        s.setLongestStreak(Math.max(s.getLongestStreak(), longest));
        streaks.save(s);
    }

    /** A day keeps the streak alive if it was done or protected (rest/freeze). */
    private boolean active(LocalDate d, Set<LocalDate> done, Set<LocalDate> prot) {
        return done.contains(d) || prot.contains(d);
    }

    /**
     * Current daily streak: walk back from today (or yesterday) over active days.
     * Done days increment the count; protected days hold it (bridge the gap).
     */
    /** Package-private + date-injected so the streak math is unit-testable. */
    int currentDailyRun(LocalDate today, Set<LocalDate> done, Set<LocalDate> prot) {
        LocalDate cursor;
        if (active(today, done, prot)) {
            cursor = today;
        } else if (active(today.minusDays(1), done, prot)) {
            cursor = today.minusDays(1);
        } else {
            return 0;
        }
        return runEndingAt(cursor, done, prot);
    }

    /** Count done days in the unbroken active run ending at {@code end} (inclusive). */
    private int runEndingAt(LocalDate end, Set<LocalDate> done, Set<LocalDate> prot) {
        int run = 0;
        LocalDate cursor = end;
        while (active(cursor, done, prot)) {
            if (done.contains(cursor)) {
                run++;
            }
            cursor = cursor.minusDays(1);
        }
        return run;
    }

    /** Longest run of done days across history, allowing protected days to bridge. */
    int longestDailyRun(Set<LocalDate> done, Set<LocalDate> prot) {
        Set<LocalDate> activeAsc = new TreeSet<>();
        activeAsc.addAll(done);
        activeAsc.addAll(prot);
        int longest = 0;
        int doneInRun = 0;
        LocalDate prev = null;
        for (LocalDate d : activeAsc) {
            if (prev == null || !prev.plusDays(1).isEqual(d)) {
                doneInRun = 0; // gap — start a fresh run
            }
            if (done.contains(d)) {
                doneInRun++;
            }
            longest = Math.max(longest, doneInRun);
            prev = d;
        }
        return longest;
    }

    List<LocalDate> completedWeekBuckets(List<HabitCheckin> doneDesc, int requiredPerWeek) {
        Map<LocalDate, Integer> countsByWeek = new HashMap<>();
        for (HabitCheckin c : doneDesc) {
            LocalDate bucket = weekStart(c.getLogDate());
            countsByWeek.put(bucket, countsByWeek.getOrDefault(bucket, 0) + 1);
        }
        ArrayList<LocalDate> completed = new ArrayList<>();
        for (Map.Entry<LocalDate, Integer> e : countsByWeek.entrySet()) {
            if (e.getValue() >= requiredPerWeek) {
                completed.add(e.getKey());
            }
        }
        completed.sort((a, b) -> b.compareTo(a));
        return completed;
    }

    int currentWeeklyRun(LocalDate today, List<LocalDate> completedWeeksDesc) {
        if (completedWeeksDesc.isEmpty()) {
            return 0;
        }
        LocalDate currentWeek = weekStart(today);
        LocalDate mostRecent = completedWeeksDesc.get(0);
        // Weekly/custom streak is still current if the latest completed week is
        // this week or last week.
        if (mostRecent.isBefore(currentWeek.minusWeeks(1))) {
            return 0;
        }
        int run = 0;
        LocalDate expected = mostRecent;
        for (LocalDate w : completedWeeksDesc) {
            if (w.isEqual(expected)) {
                run++;
                expected = expected.minusWeeks(1);
            } else if (w.isBefore(expected)) {
                break;
            }
        }
        return run;
    }

    private int longestWeeklyRun(List<LocalDate> completedWeeksDesc) {
        int longest = 0;
        int run = 0;
        LocalDate prev = null;
        for (LocalDate w : completedWeeksDesc) {
            if (prev == null || prev.minusWeeks(1).isEqual(w)) {
                run++;
            } else {
                run = 1;
            }
            longest = Math.max(longest, run);
            prev = w;
        }
        return longest;
    }

    private LocalDate weekStart(LocalDate d) {
        return weekStartOf(d);
    }

    static LocalDate weekStartOf(LocalDate d) {
        return d.with(WeekFields.ISO.dayOfWeek(), 1);
    }

    /** Single-habit convenience (mutation paths): loads this habit's data itself. */
    private HabitResponse toResponse(Habit h, LocalDate today, UUID userId) {
        return toResponse(h, today,
                checkins.findByHabitIdAndLogDateGreaterThanEqualOrderByLogDateDesc(
                        h.getId(), today.minusDays(HISTORY_WINDOW_DAYS)),
                streaks.findById(h.getId()).orElse(null),
                wallet(userId, today).getTokens(),
                isQuit(h) ? clock.zoneOf(userId) : null);
    }

    /**
     * Core: builds the response from already-loaded check-ins, streak, and token
     * count. {@code zone} is needed only by a quit habit (its start day).
     */
    private HabitResponse toResponse(Habit h, LocalDate today,
                                     List<HabitCheckin> checkinsDesc, HabitStreak s, int tokens,
                                     ZoneId zone) {
        if (isQuit(h)) {
            return quitResponse(h, today, checkinsDesc, s, tokens, zone);
        }
        Set<LocalDate> done = new HashSet<>();
        Set<LocalDate> prot = new HashSet<>();
        HabitCheckin todayRow = null;
        for (HabitCheckin c : checkinsDesc) {
            if (c.getLogDate().isEqual(today)) {
                todayRow = c;
            }
            if (c.isDone()) {
                done.add(c.getLogDate());
            } else if (c.isProtectedDay()) {
                prot.add(c.getLogDate());
            }
        }
        boolean doneToday = done.contains(today);
        boolean protectedToday = prot.contains(today);

        // Compute the current streak live from the check-ins + today's date, so a
        // streak that broke from a missed day is reflected on read (the stored
        // value is only refreshed on a mutation).
        int currentStreak;
        if (h.getCadence() == Cadence.daily) {
            currentStreak = currentDailyRun(today, done, prot);
        } else {
            int required = h.getCadence() == Cadence.weekly ? 1 : Math.max(1, h.getTargetPerWeek());
            Map<LocalDate, Integer> byWeek = new HashMap<>();
            for (LocalDate d : done) {
                byWeek.merge(weekStart(d), 1, Integer::sum);
            }
            List<LocalDate> completedWeeks = new ArrayList<>();
            for (Map.Entry<LocalDate, Integer> e : byWeek.entrySet()) {
                if (e.getValue() >= required) completedWeeks.add(e.getKey());
            }
            completedWeeks.sort((a, b) -> b.compareTo(a));
            currentStreak = currentWeeklyRun(today, completedWeeks);
        }
        currentStreak = liveOrCached(currentStreak, s);

        // "At risk" = a daily streak that survives only if yesterday's gap is
        // protected (the reactive rescue prompt). Proactive rest uses the same token.
        boolean atRisk = false;
        int riskStreak = 0;
        if (h.getCadence() == Cadence.daily && !doneToday && !protectedToday) {
            LocalDate yesterday = today.minusDays(1);
            if (!active(yesterday, done, prot)) {
                riskStreak = runEndingAt(today.minusDays(2), done, prot);
                atRisk = riskStreak > 0;
            }
        }

        LocalDate week = weekStart(today);
        int doneThisWeek = 0;
        int doneEarlierThisWeek = 0;
        for (LocalDate d : done) {
            if (!d.isBefore(week) && !d.isAfter(today)) {
                doneThisWeek++;
                if (d.isBefore(today)) {
                    doneEarlierThisWeek++;
                }
            }
        }
        // Same rule as countsOn, so Home's "x/y habits" and the score agree.
        boolean dueToday = doneToday || isDue(h, doneEarlierThisWeek, today, null);
        // todayRow comes from the check-ins already loaded: this used to be one more
        // query per measured habit on every list read.
        boolean measured = h.getMetric() != HabitMetric.none;
        return HabitResponse.of(h, s, currentStreak, doneToday, protectedToday, atRisk, riskStreak,
                tokens,
                measured && todayRow != null ? todayRow.getMetricValue() : null,
                measured && todayRow != null ? todayRow.getDurationMin() : null,
                dueToday, doneThisWeek,
                todayRow != null ? todayRow.getNote() : null);
    }

    /**
     * A quit habit's response. doneToday = clean today (active, and no slip
     * logged); streak = days since the last slip, live from the rows, falling
     * back to the cache's last slip when none is inside the read window. No
     * freezes, no at-risk prompt: there is no gap to bridge. doneThisWeek counts
     * the clean days so far this week.
     */
    private HabitResponse quitResponse(Habit h, LocalDate today, List<HabitCheckin> checkinsDesc,
                                       HabitStreak s, int tokens, ZoneId zone) {
        LocalDate start = startDay(h, zone, today);
        Set<LocalDate> slips = slipDates(checkinsDesc);
        HabitCheckin todayRow = null;
        for (HabitCheckin c : checkinsDesc) {
            if (c.getLogDate().isEqual(today)) {
                todayRow = c;
            }
        }
        LocalDate lastSlip = slips.stream().filter(d -> !d.isAfter(today))
                .max(LocalDate::compareTo).orElse(null);
        if (lastSlip == null && s != null) {
            lastSlip = s.getLastDoneOn();
        }
        boolean slippedToday = slips.contains(today);
        int streak = quitStreak(today, start, lastSlip);
        LocalDate week = weekStart(today);
        LocalDate from = start.isAfter(week) ? start : week;
        int cleanThisWeek = 0;
        for (LocalDate d = from; !d.isAfter(today); d = d.plusDays(1)) {
            if (!slips.contains(d)) {
                cleanThisWeek++;
            }
        }
        boolean active = h.isActive();
        return HabitResponse.of(h, s, streak, active && !slippedToday, false, false, 0, tokens,
                null, null, isDue(h, 0, today, zone), cleanThisWeek,
                todayRow != null ? todayRow.getNote() : null);
    }

    /**
     * The live streak, unless the bounded read cut it short. A run that is still
     * going was last recomputed (from the full history) by the tick that extended
     * it, so the cached value is exact then; a broken run reads 0 live, and the
     * stale cache is ignored.
     */
    static int liveOrCached(int live, HabitStreak cached) {
        if (live <= 0) {
            return 0;
        }
        return cached == null ? live : Math.max(live, cached.getCurrentStreak());
    }

    private Habit require(UUID userId, UUID id) {
        return habits.findByIdAndUserIdAndDeletedAtIsNull(id, userId)
                .orElseThrow(() -> ApiException.notFound("Habit"));
    }
}
