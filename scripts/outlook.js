/* =====================================================================
   Growth Buddy — Home's Outlook: the strongest Insight plus where the
   current pace leads. Pure, no DOM, no AI: plain arithmetic over what the
   user has logged. `node scripts/outlook.test.mjs` checks it; the card is
   outlook-card.js.

   Dates are YYYY-MM-DD keys walked with UTC maths (like insights.js), so the
   answer is the same in every timezone. money-core's addDays/diffDays use
   local Dates, which is why they are not used here.
   ===================================================================== */
import { buildInsights } from './insights.js';
import { inRange, sumAmt, goalSaved, fmt, applyCurrency } from './money-core.js';

const DAY_MS = 86400000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MILESTONES = [7, 14, 21, 30, 50, 100, 365];

const pad = (n) => String(n).padStart(2, '0');
const localKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const num = (key) => Date.parse(key + 'T00:00:00Z') / DAY_MS;
const key = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const monthLabel = (k) => MON[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(0, 4);
// "10 Oct", day then month, like the rest of the app.
const dayLabel = (k) => Number(k.slice(8, 10)) + ' ' + MON[Number(k.slice(5, 7)) - 1];

/** Boot holds 60 days of daily logs; Report fetches the year (`insightHistory.year`, same
    shape as /api/daily-logs) after first paint. Use it once it lands; the live stores win a
    shared day (they hold today's edits). Report's sections use it too.
    A daily log's score is the snapshot from the last time the app was open that day; the
    server's finished-day scores (`insightHistory.scores`, the two days before today) replace it. */
export function yearOf(trends, wellness, insightHistory) {
  const y = insightHistory && insightHistory.year;
  // Finished-day scores from the server: `scoreRange` (GET /api/score/range, the year) and
  // `scores` (the two days before today). They replace the snapshot a day was last opened with.
  const h = insightHistory || {};
  const sc = [...(Array.isArray(h.scoreRange) ? h.scoreRange : []), ...(h.scores || [])].filter((s) => s && s.date);
  if (!y && !sc.length) return { trends, wellness };
  const byDate = { ...((y && y.byDate) || {}), ...((trends && trends.byDate) || {}) };
  for (const s of sc) byDate[s.date] = { ...byDate[s.date], date: s.date, score: Number(s.score) || 0 };
  if (!y) return { trends: { byDate }, wellness };
  const w = wellness || {};
  return {
    trends: { byDate },
    wellness: {
      ...w,
      sleepByDate: { ...(y.sleepByDate || {}), ...(w.sleepByDate || {}) },
      moodByDate: { ...(y.moodByDate || {}), ...(w.moodByDate || {}) },
    },
  };
}

/** Same ranking as Report: the first card buildInsights returns over the same data. */
export function topInsight(data) {
  return buildInsights({ ...data, ...yearOf(data.trends, data.wellness, data.history) })[0] || null;
}

/** A salary: the latest income's amount (within 10%) seen 2+ times, each 26-35 days apart.
    Returns { amount, last } or null when income is irregular. */
export function regularIncome(inc) {
  const rows = inc.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return null;
  const a = Number(rows[rows.length - 1].amount) || 0;
  const pay = rows.filter((r) => Math.abs((Number(r.amount) || 0) - a) <= a * 0.1);
  if (pay.length < 2) return null;
  for (let i = 1; i < pay.length; i++) {
    const gap = num(pay[i].date) - num(pay[i - 1].date);
    if (gap < 26 || gap > 35) return null;
  }
  return { amount: a, last: pay[pay.length - 1].date, rows: pay };
}

/** Paydays after day number `afterN` up to day number `endN`, a month apart on the last payday's day. */
function paydays(last, afterN, endN) {
  const [y, m, d] = last.split('-').map(Number);
  const out = [];
  for (let k = 1; ; k++) {
    const dim = new Date(Date.UTC(y, m - 1 + k + 1, 0)).getUTCDate();
    const n = Date.UTC(y, m - 1 + k, Math.min(d, dim)) / DAY_MS;
    if (n > endN) return out;
    if (n > afterN) out.push(n);
  }
}

/** Where the last 90 days lead: the nearest dated money goal, else a month 3 out.
    Income is projected by paydays when it is a salary (two salaries in 45 days are not
    1.33 a month), else at its rate over whole calendar months; spend at its daily rate. */
export function savingsPace(money, now = Date.now()) {
  if (!money) return null;
  applyCurrency(money); // fmt's symbol is module state; Outlook can paint before the Money card sets it
  const t0 = num(localKey(new Date(now)));
  const from = key(t0 - 89);
  const to = key(t0);
  const inc = inRange(money.income || [], from, to);
  const exp = inRange(money.expenses || [], from, to);
  // Both sides logged: income alone promises phantom savings, expenses alone a phantom stall.
  if (inc.length + exp.length < 5 || !inc.length || !exp.length) return null;
  // Days since the ledger began, capped at the 90-day window (an older ledger is a full 90).
  const all = (money.income || []).concat(money.expenses || []).filter((r) => r.date <= to);
  const start = Math.max(t0 - 89, Math.min(...all.map((r) => num(r.date))));
  const span = t0 - start + 1;
  if (!(span >= 30)) return null;
  const spend = sumAmt(exp) / span;
  const sal = regularIncome(inc);
  let perDay; // income per day that is not a payday
  let basis;
  if (sal) {
    const other = inc.filter((r) => !sal.rows.includes(r));
    perDay = sumAmt(other) / span; // ponytail: side income at its straight-line rate
    basis = fmt(sal.amount) + ' a month';
  } else {
    // Whole calendar months inside the ledger: a lump on the 1st is not counted 1.5 times.
    const [sy, sm, sd] = key(start).split('-').map(Number);
    const mFrom = sd === 1 ? Date.UTC(sy, sm - 1, 1) / DAY_MS : Date.UTC(sy, sm, 1) / DAY_MS;
    const [ty, tm] = to.split('-').map(Number);
    const mTo = Date.UTC(ty, tm - 1, 0) / DAY_MS; // last day of last month
    const whole = mTo >= mFrom ? inRange(inc, key(mFrom), key(mTo)) : null;
    perDay = whole ? sumAmt(whole) / (mTo - mFrom + 1) : sumAmt(inc) / span;
    basis = fmt(perDay * 30.44) + ' a month income';
  }
  basis = 'based on ' + basis + ' and ' + fmt(spend) + ' a day spending';
  const net = perDay - spend;
  const pays = sal ? paydays(sal.last, t0, t0 + 3650) : [];
  // Saved by the end of day t0 + d.
  const saved = (d) => net * d + (sal ? sal.amount * pays.filter((n) => n <= t0 + d).length : 0);
  const rate = saved(365) / 365; // average net per day over the next year
  const goal = (money.goals || [])
    .filter((g) => g && g.dueDate && Number(g.target) > goalSaved(g))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (goal) {
    const left = Number(goal.target) - goalSaved(goal);
    let days = Infinity;
    if (rate > 0)
      for (let d = 1; d <= 3650; d++)
        if (saved(d) >= left) {
          days = d;
          break;
        }
    const byDate = days <= 3650 ? key(t0 + days) : null;
    const onTime = !!byDate && byDate <= goal.dueDate;
    const text = !byDate
      ? rate > 0
        ? goal.name + ': over 10 years away at this pace'
        : goal.name + ': no finish date yet, the last 90 days saved nothing net'
      : 'At this pace: ' +
        goal.name +
        ' reached by ' +
        dayLabel(byDate) +
        ' ' +
        byDate.slice(0, 4) +
        (onTime ? '' : ', after its ' + dayLabel(goal.dueDate) + ' target') +
        ', ' +
        basis;
    return { kind: 'goal', name: goal.name, byDate, onTime, rate, text };
  }
  const [y, m] = to.split('-').map(Number);
  const end = Date.UTC(y, m + 3, 0) / DAY_MS; // last day of the month 3 out
  const amount = Math.round(saved(end - t0));
  if (amount <= 0) return null;
  const month = key(end).slice(0, 7);
  return {
    kind: 'month',
    amount,
    month,
    rate,
    text:
      'At this pace: ' +
      fmt(amount) +
      ' more saved by the end of ' +
      monthLabel(month + '-01') +
      ', ' +
      basis,
  };
}

/** The best daily streak and the day it reaches its next milestone. */
export function streakPace(habits, now = Date.now()) {
  const best = (habits || [])
    .filter((hb) => hb && hb.active !== false && (hb.cadence || 'daily') === 'daily')
    .sort((a, b) => (Number(b.streak) || 0) - (Number(a.streak) || 0))[0];
  const streak = best ? Number(best.streak) || 0 : 0;
  if (streak < 2) return null;
  // A streak not ticked yet today still counts through yesterday, so today is the next day of it.
  const today = num(localKey(new Date(now)));
  const last = today - (best.doneToday ? 0 : 1); // the day the streak reaches `streak` (+1 if ticked today)
  const reach = (m) => key(last + m - streak);
  const name = best.name || 'habit';
  const next = MILESTONES.find((x) => x > streak);
  if (!next) return null; // ponytail: past a year there is no next milestone; add yearly ones if anyone gets there
  let byDate = reach(next);
  let text = name + ': ' + next + ' days in a row by ' + dayLabel(byDate);
  // A milestone that lands today is the one-thing card's job ("keep your streak");
  // the outlook looks one further, so it still says something new.
  const after = MILESTONES.find((x) => x > next);
  if (byDate === key(today) && after) {
    // Only reachable when today is not ticked yet, so say what today needs, not what it did.
    text =
      name + ': do it today for ' + next + ' in a row; ' + after + ' by ' + dayLabel(reach(after));
    byDate = reach(after);
    return { name, streak, next: after, byDate, text };
  }
  return { name, streak, next, byDate, text };
}

/** Home's card data; null when there is nothing to say, so the card hides. */
export function outlook(data) {
  const now = data.now || Date.now();
  const off = (k) => !!data.features && data.features[k] === false;
  const insight = topInsight(Object.assign({}, data, { now }));
  const savings = off('money') ? null : savingsPace(data.money, now);
  const streak = off('habits') ? null : streakPace(data.habits, now);
  return insight || savings || streak ? { insight, savings, streak } : null;
}
