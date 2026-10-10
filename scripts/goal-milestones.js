/* =====================================================================
   Growth Buddy — a goal's milestone list, habit links and dated progress log, as data. No DOM,
   so `node scripts/goal-milestones.test.mjs` can check it; goals.js draws.
   Milestones live in the goal's progress blob: [{ id, title, done, due? }],
   `due` a YYYY-MM-DD key or absent. Every helper returns a new list and
   leaves the one it was given alone (the old one is the rollback copy).
   ===================================================================== */

/** `list` with the item `id` moved `delta` places (−1 up, +1 down); unchanged at an end. */
export function moveItem(list, id, delta) {
  const arr = (list || []).slice();
  const from = arr.findIndex((x) => x && x.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= arr.length) return arr;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  return arr;
}

/** Rename one milestone. A blank title is refused: the list comes back as it was. */
export function renameMilestone(list, id, title) {
  const t = String(title || '')
    .trim()
    .slice(0, 160);
  if (!t) return (list || []).slice();
  return (list || []).map((x) => (x.id === id ? { ...x, title: t } : x));
}

/** Set or clear (`''` / null) one milestone's due date. */
export function setMilestoneDue(list, id, due) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(String(due || ''));
  return (list || []).map((x) => {
    if (x.id !== id) return x;
    const next = { ...x };
    if (valid) next.due = due;
    else delete next.due;
    return next;
  });
}

/**
 * How a milestone's due date reads today: null (no date, or done — a ticked
 * milestone is not late), 'overdue', 'today', 'soon' (within 7 days) or 'later'.
 */
export function milestoneDueState(ms, today) {
  if (!ms || ms.done || !ms.due) return null;
  if (ms.due < today) return 'overdue';
  if (ms.due === today) return 'today';
  const [y, m, d] = ms.due.split('-').map(Number);
  const [ty, tm, td] = String(today).split('-').map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
  return days <= 7 ? 'soon' : 'later';
}

/** The habit ids a goal links, without repeats and without habits that no longer exist. */
export function liveLinkedIds(ids, habits) {
  const live = new Set((habits || []).map((x) => x.id));
  return [...new Set(ids || [])].filter((id) => live.has(id));
}

/* ---- The dated progress log ----
   `progressLog` in the same blob: [{ date: 'YYYY-MM-DD', pct: 0..100 }], oldest
   first, one entry per day (the day's last save wins), the newest
   PROGRESS_LOG_MAX kept. Written by app.js `updateGoalProgress` on every save,
   read by insights.js `goalPace` for a least-squares finish date. */
export const PROGRESS_LOG_MAX = 120;

/** How far through a goal is, 0..1, from its milestones or its day tracker; null if neither. */
export function progressFraction(p) {
  const ms = (p && p.milestones) || [];
  if (ms.length) return ms.filter((m) => m && m.done).length / ms.length;
  if (p && p.durationDays > 0) return Math.min(1, (p.daysFollowed || 0) / p.durationDays);
  return null;
}

/** `log` with `{date, pct}` set for that day (replacing that day's entry), sorted, capped. */
export function appendProgressLog(log, date, pct, max = PROGRESS_LOG_MAX) {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) && Number.isFinite(pct);
  const kept = (Array.isArray(log) ? log : []).filter(
    (e) => e && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) && Number.isFinite(e.pct)
  );
  if (!ok) return kept.slice(-max);
  const v = Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10;
  const out = kept.filter((e) => e.date !== date).concat({ date, pct: v });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out.slice(-max);
}

/** The blob with today's progress logged; unchanged (same object) when it has nothing to measure. */
export function withProgressLog(blob, date) {
  const f = progressFraction(blob);
  if (f == null) return blob;
  return { ...blob, progressLog: appendProgressLog(blob.progressLog, date, f * 100) };
}

/** True when saving the blob today would add or change its log entry. */
export function needsProgressLog(blob, date) {
  const f = progressFraction(blob);
  if (f == null) return false;
  const log = (blob && blob.progressLog) || [];
  const last = log[log.length - 1];
  return !last || last.date !== date || last.pct !== Math.round(f * 1000) / 10;
}
