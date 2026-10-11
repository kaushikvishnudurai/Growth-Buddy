/* =====================================================================
   Growth Buddy — one-tap guesses from data the user already logged
   ---------------------------------------------------------------------
   Pure, DOM-free. Each answer is a guess the user confirms with one tap
   (Home's morning check-in, the repeat-expense prompt, a form's usual time,
   a habit that ticks itself); none of them writes anything. A guess needs a
   pattern to stand on — too little history means null, never a default.
   Checked by `node scripts/nudges.test.mjs`.
   ===================================================================== */

const DAY_MS = 86400000;
const dayNum = (key) => Math.floor(Date.parse(key + 'T00:00:00Z') / DAY_MS);
const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const toHHMM = (min) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const round5 = (min) => Math.round(min / 5) * 5;

/**
 * The usual night, from the last 14 days before `today` (3 nights at least):
 * {bedtime, wakeTime} as 'HH:MM', or null. A bedtime after midnight counts as
 * late, not early: 00:30 sits after 23:30, so the median of the two is midnight.
 */
export function usualSleep(sleepByDate, today) {
  const t = dayNum(today);
  const beds = [];
  const wakes = [];
  for (const [key, e] of Object.entries(sleepByDate || {})) {
    const age = t - dayNum(key);
    if (!(age >= 1 && age <= 14) || !e) continue;
    const b = toMin(e.bedtime);
    const w = toMin(e.wakeTime);
    if (b == null || w == null) continue;
    beds.push(b < 720 ? b + 1440 : b);
    wakes.push(w);
  }
  if (beds.length < 3) return null;
  return { bedtime: toHHMM(round5(median(beds))), wakeTime: toHHMM(round5(median(wakes))) };
}

const noteKey = (e) =>
  String((e && e.note) || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * An expense the user logs most days at about this time of day — "Coffee" on
 * 4+ of the last 14 days, 3+ of them with a logged time, and `now` between an
 * hour before and two hours after their usual time. Not offered once one with
 * that note is already in today. The note stands in for a payee, as in
 * insights.js's hiddenSubscription. {note, amount, category, accountId} | null.
 */
export function repeatExpense(expenses, today, now) {
  const t = dayNum(today);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const groups = {};
  const loggedToday = new Set();
  for (const e of expenses || []) {
    const k = noteKey(e);
    if (!k || !e.date || !(Number(e.amount) > 0)) continue;
    if (e.date === today) {
      loggedToday.add(k);
      continue;
    }
    const age = t - dayNum(e.date);
    if (age >= 1 && age <= 14) (groups[k] = groups[k] || []).push(e);
  }
  let best = null;
  for (const k in groups) {
    if (loggedToday.has(k)) continue;
    const g = groups[k];
    const days = new Set(g.map((e) => e.date)).size;
    if (days < 4) continue;
    const mins = g
      .filter((e) => Number(e.createdAt) > 0)
      .map((e) => {
        const d = new Date(Number(e.createdAt));
        return d.getHours() * 60 + d.getMinutes();
      });
    if (mins.length < 3) continue;
    const at = median(mins);
    if (nowMin < at - 60 || nowMin > at + 120) continue;
    if (best && days <= best.days) continue;
    const latest = g.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
    const cats = {};
    g.forEach((e) => e.category && (cats[e.category] = (cats[e.category] || 0) + 1));
    const category = Object.keys(cats).sort((a, b) => cats[b] - cats[a])[0] || 'others';
    best = {
      days,
      note: latest.note.trim(),
      amount: Math.round(median(g.map((e) => Number(e.amount)))),
      category,
      accountId: latest.accountId || null,
    };
  }
  if (!best) return null;
  const { days: _days, ...out } = best;
  return out;
}

/** The time the user gives their reminders most often (twice at least), 'HH:MM' | null. */
export function usualReminderTime(reminders) {
  const n = {};
  for (const r of reminders || []) {
    const m = toMin(r && r.time);
    if (m != null) n[m] = (n[m] || 0) + 1;
  }
  const top = Object.keys(n).sort((a, b) => n[b] - n[a] || a - b)[0];
  return top != null && n[top] >= 2 ? toHHMM(Number(top)) : null;
}

/**
 * A Steps habit's daily target, read from its name: "Walk 8k steps" 8000,
 * "10,000 steps" 10000. Null when the name says no number.
 */
// ponytail: the target lives in the name because habits have no daily-value column;
// add one (and a field on the form) if names without a number need auto-ticking.
export function stepsTarget(name) {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(k\b)?\s*([a-z]*)/i.exec(String(name || ''));
  // "Walk 30 min" or "Walk 5 km" is a number, but not a step count.
  if (!m || (!m[2] && m[3] && !/^steps?$/i.test(m[3]))) return null;
  const n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
  return n >= 100 && n <= 100000 ? Math.round(n) : null;
}

/**
 * A habit the focus timer can tick: its name says focus / deep work / pomodoro.
 * The minutes it needs come from the name ("Deep work 2h" 120, "Focus 45 min"
 * 45), else one 25-minute session. Null when it isn't a focus habit.
 */
export function focusMinutesTarget(name) {
  const s = String(name || '');
  if (!/\b(focus|deep[\s-]?work|pomodoro)/i.test(s)) return null;
  const m = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i.exec(s);
  if (!m) return 25;
  const v = Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1);
  return v >= 1 && v <= 1440 ? Math.round(v) : 25;
}
