package com.growthbuddy.habit;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.ProgressService;
import java.time.Instant;
import java.time.LocalDate;
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

    private final HabitRepository habits;
    private final HabitCheckinRepository checkins;
    private final HabitStreakRepository streaks;
    private final StreakFreezeWalletRepository wallets;
    private final ProgressService progress;

    public HabitService(HabitRepository habits, HabitCheckinRepository checkins,
                        HabitStreakRepository streaks,
                        StreakFreezeWalletRepository wallets,
                        ProgressService progress) {
        this.habits = habits;
        this.checkins = checkins;
        this.streaks = streaks;
        this.wallets = wallets;
        this.progress = progress;
    }

    /* ---- Freeze-token wallet (weekly grant) ---- */

    /** Load (or create) the wallet, topping it up if a new ISO week has started. */
    private StreakFreezeWallet wallet(UUID userId) {
        LocalDate thisWeek = weekStart(LocalDate.now());
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
        return new FreezeStatus(wallet(userId).getTokens(), FREEZE_CAP);
    }

    /** Protect a day (rest/freeze): spend a token, mark the day, recompute. */
    @Transactional
    public HabitResponse protect(UUID userId, UUID id, LocalDate date) {
        Habit h = require(userId, id);
        LocalDate day = date != null ? date : LocalDate.now();
        if (day.isAfter(LocalDate.now())) {
            throw ApiException.badRequest("Cannot protect a future day");
        }
        HabitCheckin c = checkins.findByHabitIdAndLogDate(id, day).orElse(null);
        if (c != null && c.isDone()) {
            throw ApiException.badRequest("That day is already completed");
        }
        if (c == null || !c.isProtectedDay()) {
            StreakFreezeWallet w = wallet(userId);
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
            recomputeStreak(h);
        }
        return toResponse(h, LocalDate.now(), userId);
    }

    /** Undo a protected day and refund the token. */
    @Transactional
    public HabitResponse unprotect(UUID userId, UUID id, LocalDate date) {
        Habit h = require(userId, id);
        LocalDate day = date != null ? date : LocalDate.now();
        HabitCheckin c = checkins.findByHabitIdAndLogDate(id, day).orElse(null);
        if (c != null && c.isProtectedDay()) {
            c.setProtectedDay(false);
            checkins.save(c);
            StreakFreezeWallet w = wallet(userId);
            w.setTokens(Math.min(FREEZE_CAP, w.getTokens() + 1));
            wallets.save(w);
            recomputeStreak(h);
        }
        return toResponse(h, LocalDate.now(), userId);
    }

    // Read-write (not readOnly): wallet() may persist a weekly token grant.
    @Transactional
    public List<HabitResponse> list(UUID userId) {
        LocalDate today = LocalDate.now();
        List<Habit> rows = habits.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(userId);
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
        for (HabitCheckin c : checkins.findByUserIdOrderByLogDateDesc(userId)) {
            byHabit.computeIfAbsent(c.getHabitId(), k -> new ArrayList<>()).add(c);
        }
        Map<UUID, HabitStreak> streakById = new HashMap<>();
        for (HabitStreak s : streaks.findAllById(rows.stream().map(Habit::getId).toList())) {
            streakById.put(s.getHabitId(), s);
        }
        int tokens = wallet(userId).getTokens();
        return rows.stream()
                .map(h -> toResponse(h, today,
                        byHabit.getOrDefault(h.getId(), List.of()),
                        streakById.get(h.getId()), tokens))
                .toList();
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
        LocalDate today = LocalDate.now();
        StringBuilder sb = new StringBuilder("Habits:\n");
        for (Habit h : hs) {
            boolean done = checkins.existsByHabitIdAndLogDateAndDoneTrue(h.getId(), today);
            HabitStreak s = streaks.findById(h.getId()).orElse(null);
            int streak = s == null ? 0 : s.getCurrentStreak();
            sb.append("  - ").append(h.getName())
                    .append(" — ").append(done ? "done today" : "not yet today")
                    .append(", ").append(streak).append("-day streak\n");
        }
        return sb.toString();
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
        List<Habit> list = habits.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(userId);
        LocalDate today = LocalDate.now();
        // Two queries instead of one-exists-per-habit: pull today's done check-ins
        // once and count those belonging to a still-active habit (a soft-deleted
        // habit keeps its old check-ins, so filter by the active set).
        Set<UUID> activeIds = new HashSet<>();
        for (Habit h : list) {
            activeIds.add(h.getId());
        }
        int done = (int) checkins.findByUserIdAndLogDateAndDoneTrue(userId, today).stream()
                .filter(c -> activeIds.contains(c.getHabitId()))
                .count();
        return new TodayCounts(done, list.size());
    }

    /** Completed-vs-total pair for a single day. */
    public record TodayCounts(int done, int total) {
    }

    @Transactional
    public HabitResponse create(UUID userId, CreateHabitRequest req) {
        Habit h = new Habit();
        h.setUserId(userId);
        h.setName(req.name().trim());
        h.setDomain(req.domain() != null ? req.domain() : HabitDomain.habit);
        h.setIcon(req.icon());
        h.setColor(req.color());
        h.setCadence(req.cadence() != null ? req.cadence() : Cadence.daily);
        h.setTargetPerWeek(req.targetPerWeek() != null ? req.targetPerWeek() : 7);
        h.setReminderTime(req.reminderTime());
        habits.save(h);
        return toResponse(h, LocalDate.now(), userId);
    }

    @Transactional
    public HabitResponse update(UUID userId, UUID id, UpdateHabitRequest req) {
        Habit h = require(userId, id);
        if (req.name() != null) {
            h.setName(req.name().trim());
        }
        if (req.domain() != null) {
            h.setDomain(req.domain());
        }
        if (req.icon() != null) {
            h.setIcon(req.icon());
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
        if (req.reminderTime() != null) {
            h.setReminderTime(req.reminderTime());
        }
        if (req.active() != null) {
            h.setActive(req.active());
        }
        habits.save(h);
        return toResponse(h, LocalDate.now(), userId);
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
        LocalDate date = req.date() != null ? req.date() : LocalDate.now();
        boolean done = req.done() == null || req.done();

        HabitCheckin c = checkins.findByHabitIdAndLogDate(h.getId(), date)
                .orElseGet(() -> {
                    HabitCheckin n = new HabitCheckin();
                    n.setHabitId(h.getId());
                    n.setLogDate(date);
                    n.setUserId(userId);
                    return n;
                });
        boolean wasDone = c.isDone();
        c.setUserId(userId);
        c.setDone(done);
        if (done) {
            // A completed day supersedes a protected (rest/freeze) day.
            c.setProtectedDay(false);
        }
        c.setNote(req.note());
        checkins.save(c);

        if (!wasDone && done) {
            progress.awardHabitCheckin(userId);
        }

        recomputeStreak(h);
        return toResponse(h, LocalDate.now(), userId);
    }

    /** Toggle today's check-in (used by the dashboard "done today" tap). */
    @Transactional
    public HabitResponse toggleToday(UUID userId, UUID id) {
        boolean doneNow = checkins.existsByHabitIdAndLogDateAndDoneTrue(id, LocalDate.now());
        return checkin(userId, id, new CheckinRequest(LocalDate.now(), !doneNow, null));
    }

    /**
     * Rebuild the streak counters by walking consecutive completed days backward
     * from the most recent check-in.
     */
    private void recomputeStreak(Habit habit) {
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
            current = currentDailyRun(doneDates, protectedDates);
            longest = longestDailyRun(doneDates, protectedDates);
        } else {
            int required = habit.getCadence() == Cadence.weekly
                    ? 1
                    : Math.max(1, habit.getTargetPerWeek());
            List<LocalDate> completedWeeks = completedWeekBuckets(done, required);
            current = currentWeeklyRun(completedWeeks);
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
    private int currentDailyRun(Set<LocalDate> done, Set<LocalDate> prot) {
        return currentDailyRun(LocalDate.now(), done, prot);
    }

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

    private List<LocalDate> completedWeekBuckets(List<HabitCheckin> doneDesc, int requiredPerWeek) {
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

    private int currentWeeklyRun(List<LocalDate> completedWeeksDesc) {
        if (completedWeeksDesc.isEmpty()) {
            return 0;
        }
        LocalDate currentWeek = weekStart(LocalDate.now());
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
        WeekFields wf = WeekFields.ISO;
        return d.with(wf.dayOfWeek(), 1);
    }

    /** Single-habit convenience (mutation paths): loads this habit's data itself. */
    private HabitResponse toResponse(Habit h, LocalDate today, UUID userId) {
        return toResponse(h, today,
                checkins.findByHabitIdOrderByLogDateDesc(h.getId()),
                streaks.findById(h.getId()).orElse(null),
                wallet(userId).getTokens());
    }

    /** Core: builds the response from already-loaded check-ins, streak, and token count. */
    private HabitResponse toResponse(Habit h, LocalDate today,
                                     List<HabitCheckin> checkinsDesc, HabitStreak s, int tokens) {
        Set<LocalDate> done = new HashSet<>();
        Set<LocalDate> prot = new HashSet<>();
        for (HabitCheckin c : checkinsDesc) {
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
            currentStreak = currentWeeklyRun(completedWeeks);
        }

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

        return HabitResponse.of(h, s, currentStreak, doneToday, protectedToday, atRisk, riskStreak, tokens);
    }

    private Habit require(UUID userId, UUID id) {
        return habits.findByIdAndUserIdAndDeletedAtIsNull(id, userId)
                .orElseThrow(() -> ApiException.notFound("Habit"));
    }
}
