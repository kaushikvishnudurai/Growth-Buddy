/* =====================================================================
   Growth Buddy — Home's pure rules: the widget catalog, the saved-layout
   merge, and the order Home lists tasks, habits and goals in. No DOM, so
   `node scripts/home-order.test.mjs` can check them; dashboard.js renders.
   ===================================================================== */

/* ---- Home-screen widget catalog ----
   The set of cards a user can show/hide and reorder on Home. `feature` (if set)
   gates the widget on a feature toggle being on. Order here is the default. */
export const HOME_WIDGETS = [
  {
    id: 'score',
    label: 'Score & streak',
    desc: 'Your daily growth score and streak',
    feature: null,
  },
  { id: 'plan', label: 'Daily brief', desc: 'A quick suggested plan for today', feature: null },
  { id: 'wellness', label: 'Sleep & mood', desc: 'Log sleep and mood check-ins', feature: null },
  { id: 'tasks', label: "Today's tasks", desc: 'Your tasks for today', feature: null },
  {
    id: 'calendar',
    label: 'Mini calendar',
    desc: 'Month view with reminders & food',
    feature: 'calendar',
  },
  {
    id: 'habits',
    label: 'Habit streaks',
    desc: 'Your daily habits and streaks',
    feature: 'habits',
  },
  {
    id: 'goals',
    label: 'Goals',
    desc: 'Your nearest goals and what is next',
    feature: 'goals',
  },
  {
    id: 'money',
    label: 'Money Buddy',
    desc: 'Safe-to-spend & quick expense add',
    feature: 'money',
  },
  {
    id: 'reminders',
    label: 'Smart reminders',
    desc: 'Suggested reminders for today',
    feature: null,
  },
];

/* Merge a saved layout with the catalog: keep saved order/enabled for known
   widgets, drop unknown ids, and append any new catalog widgets (enabled). */
export function resolveHomeLayout(saved) {
  const known = new Set(HOME_WIDGETS.map((w) => w.id));
  const seen = new Set();
  const out = [];
  (Array.isArray(saved) ? saved : []).forEach((item) => {
    if (item && known.has(item.id) && !seen.has(item.id)) {
      out.push({ id: item.id, enabled: item.enabled !== false });
      seen.add(item.id);
    }
  });
  HOME_WIDGETS.forEach((w) => {
    if (!seen.has(w.id)) out.push({ id: w.id, enabled: true });
  });
  return out;
}

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

/* YYYY-MM-DD of a Date in the device's zone. */
export function localDayKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* Where a task sits on Home: overdue, due today, upcoming, no date, paused,
   done. Lower comes first. */
export function taskRank(task, now) {
  if (task.done) return 5;
  if (task.paused) return 4;
  if (!task.dueAt) return 3;
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return 3;
  if (task.overdue || due.getTime() < now.getTime()) return 0;
  return localDayKey(due) === localDayKey(now) ? 1 : 2;
}

/* Home's task list was the whole list in creation order, so this morning's
   overdue task could sit under a dozen done ones. Overdue → today → upcoming
   → no date, paused and done last; soonest first within a group, and the
   original order on a tie (Array.prototype.sort is stable). */
export function sortTasksForHome(tasks, now = new Date()) {
  return (tasks || [])
    .map((t) => ({ t, r: taskRank(t, now), at: t.dueAt ? new Date(t.dueAt).getTime() || 0 : 0 }))
    .sort((a, b) => a.r - b.r || (a.r <= 2 ? a.at - b.at : 0))
    .map((x) => x.t);
}

/* Still owed today (the server's `dueToday`; an older payload: not paused). */
export function habitDue(habit) {
  if (typeof habit.dueToday === 'boolean') return habit.dueToday;
  return habit.active !== false;
}

/* What is still to do comes first: due and not ticked, then not owed today
   (a weekly habit already met), then done, then paused. */
export function sortHabitsForHome(habits) {
  const rank = (hb) => (hb.active === false ? 3 : hb.doneToday ? 2 : habitDue(hb) ? 0 : 1);
  return (habits || [])
    .map((hb, i) => ({ hb, r: rank(hb), i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.hb);
}

/* Best current streak, kept apart by unit: a daily habit's streak counts days,
   a weekly / N-a-week one's counts weeks (HabitService.currentWeeklyRun), so
   one max over both called 6 weeks "6-day". Paused habits are left out. */
export function topStreaks(habits) {
  let days = 0;
  let weeks = 0;
  (habits || []).forEach((hb) => {
    if (hb.active === false) return;
    const n = Number(hb.streak) || 0;
    if ((hb.cadence || 'daily') === 'daily') days = Math.max(days, n);
    else weeks = Math.max(weeks, n);
  });
  return { days, weeks };
}

/* Whole days from `todayKey` to a YYYY-MM-DD target (negative = past). */
export function daysBetween(todayKey, dateKey) {
  if (!todayKey || !dateKey) return null;
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const [ty, tm, td] = String(todayKey).split('-').map(Number);
  if (!y || !m || !d || !ty) return null;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

/* The goals Home shows: open ones, nearest target first, undated last, at most
   `limit`. Each comes with its days left and, from its client-side progress,
   the next unticked milestone and the day tracker's count. */
export function homeGoals(sections, progressById, todayKey, limit = 3) {
  const all = (sections || []).flatMap((s) => s.goals || []).filter((g) => !g.completed);
  return all
    .map((g, i) => ({ g, i }))
    .sort(
      (a, b) =>
        (a.g.targetDate || '9999-12-31').localeCompare(b.g.targetDate || '9999-12-31') || a.i - b.i
    )
    .slice(0, limit)
    .map(({ g }) => {
      const p = (progressById || {})[String(g.id)] || null;
      const ms = (p && p.milestones) || [];
      const next = ms.find((x) => !x.done);
      return {
        goal: g,
        daysLeft: daysBetween(todayKey, g.targetDate),
        nextMilestone: next ? next.title : null,
        milestones: { done: ms.filter((x) => x.done).length, total: ms.length },
        days: p && p.durationDays ? { done: p.daysFollowed || 0, total: p.durationDays } : null,
      };
    });
}
