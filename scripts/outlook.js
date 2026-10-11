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
const dayLabel = (k) => MON[Number(k.slice(5, 7)) - 1] + ' ' + Number(k.slice(8, 10));

/** Boot holds 60 days of daily logs; Report fetches the year (`insightHistory.year`, same
    shape as /api/daily-logs) after first paint. Use it once it lands; the live stores win a
    shared day (they hold today's edits). Report's sections use it too. */
export function yearOf(trends, wellness, insightHistory) {
  const y = insightHistory && insightHistory.year;
  if (!y) return { trends, wellness };
  const w = wellness || {};
  return {
    trends: { byDate: { ...(y.byDate || {}), ...((trends && trends.byDate) || {}) } },
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

/** Where 90 days of net saving leads: the nearest dated money goal, else a month 3 out. */
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
  const span = Math.min(90, t0 - Math.min(...all.map((r) => num(r.date))) + 1);
  if (!(span >= 30)) return null;
  // ponytail: straight line over 90 days, upgrade to least-squares like insights paceSlope if users call it jumpy
  const rate = (sumAmt(inc) - sumAmt(exp)) / span;
  const goal = (money.goals || [])
    .filter((g) => g && g.dueDate && Number(g.target) > goalSaved(g))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (goal) {
    const left = Number(goal.target) - goalSaved(goal);
    const days = rate > 0 ? Math.ceil(left / rate) : Infinity;
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
        ', ' +
        byDate.slice(0, 4) +
        (onTime ? '' : ', after its ' + dayLabel(goal.dueDate) + ' target');
    return { kind: 'goal', name: goal.name, byDate, onTime, rate, text };
  }
  if (rate <= 0) return null;
  const [y, m] = to.split('-').map(Number);
  const end = Date.UTC(y, m + 3, 0) / DAY_MS; // last day of the month 3 out
  const amount = Math.round(rate * (end - t0));
  const month = key(end).slice(0, 7);
  return {
    kind: 'month',
    amount,
    month,
    rate,
    text: 'At this pace: ' + fmt(amount) + ' more saved by the end of ' + monthLabel(month + '-01'),
  };
}

/** The best daily streak and the day it reaches its next milestone. */
export function streakPace(habits, now = Date.now()) {
  const best = (habits || [])
    .filter((hb) => hb && hb.active !== false && (hb.cadence || 'daily') === 'daily')
    .sort((a, b) => (Number(b.streak) || 0) - (Number(a.streak) || 0))[0];
  const streak = best ? Number(best.streak) || 0 : 0;
  if (streak < 2) return null;
  const next = MILESTONES.find((x) => x > streak);
  if (!next) return null; // ponytail: past a year there is no next milestone; add yearly ones if anyone gets there
  // A streak not ticked yet today still counts through yesterday, so today is the next day of it.
  const byDate = key(num(localKey(new Date(now))) + next - streak - (best.doneToday ? 0 : 1));
  const name = best.name || 'habit';
  return {
    name,
    streak,
    next,
    byDate,
    text: 'Keep it up: a ' + next + '-day ' + name + ' streak on ' + dayLabel(byDate),
  };
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
