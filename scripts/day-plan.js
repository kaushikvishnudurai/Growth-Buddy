/* Plan my day, drafted without the AI: today's fixed reminders, bills due or
   overdue, habits not yet done, and the three most pressing open tasks, each
   given a free hour-long focus block. The user switches off what they don't want
   and the blocks become reminders. Pure; checked by day-plan.test.mjs. */
import { occursOn } from './recurrence.js';

const DAY_START = 9 * 60;
const DAY_END = 21 * 60; // last block starts by 21:00
const BLOCK = 60;
const TASK_LIMIT = 3;

const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const toHHMM = (min) =>
  String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');

/* Overdue, then due today, then High, then the rest; creation order breaks ties. */
function taskRank(t, today) {
  const due = t.dueAt ? localKeyOf(new Date(t.dueAt)) : null;
  if (due && due < today) return 0;
  if (due === today) return 1;
  if (t.priority === 'High') return 2;
  return 3;
}
function localKeyOf(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}
const WHY = ['overdue', 'due today', 'high priority', ''];

/* Bills whose due day is today or already passed this month and still unpaid. */
function billsToday(subscriptions, today) {
  const [y, m, d] = today.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const month = today.slice(0, 7);
  return (subscriptions || [])
    .filter((s) => s && (s.paidFor || '') < month)
    .map((s) => ({ s, due: Math.min(Number(s.dueDay) || 1, dim) }))
    .filter((x) => x.due <= d)
    .map((x) => ({
      name: x.s.name || 'Bill',
      amount: Number(x.s.amount) || 0,
      overdue: x.due < d,
    }));
}

/**
 * @param {object} o
 * @param {Array} o.tasks      mapped tasks ({id, title, done, paused, dueAt, priority})
 * @param {Array} o.habits     ({id, name, doneToday, reminderTime})
 * @param {Array} o.reminders  calendar reminders (recurrence.js shape, plus text/time/done)
 * @param {Array} o.subscriptions  Money's subscriptions ({name, amount, dueDay, paidFor})
 * @param {string} o.today     'YYYY-MM-DD', the user's day
 * @param {number} o.nowMin    minutes since local midnight
 * @returns {Array<{kind, title, time, id?, detail?, block?}>} timed first, by time
 */
export function buildDayPlan({
  tasks,
  habits,
  reminders,
  subscriptions,
  today,
  nowMin,
  workWeek,
} = {}) {
  const items = [];
  const busy = [];
  for (const r of reminders || []) {
    if (!r || !r.text || !occursOn(r, today, workWeek)) continue;
    if (Array.isArray(r.doneDates) && r.doneDates.includes(today)) continue;
    const t = toMin(r.time);
    if (t !== null) busy.push([t, Math.max(t + 30, toMin(r.endTime) || 0)]);
    items.push({ kind: 'reminder', title: r.text, time: t === null ? null : toHHMM(t) });
  }
  for (const b of billsToday(subscriptions, today)) {
    items.push({
      kind: 'bill',
      title: 'Pay ' + b.name,
      time: null,
      detail: (b.amount ? b.amount + ' · ' : '') + (b.overdue ? 'overdue' : 'due today'),
    });
  }
  for (const hb of habits || []) {
    if (!hb || hb.doneToday) continue;
    const t = toMin(hb.reminderTime);
    items.push({ kind: 'habit', id: hb.id, title: hb.name, time: t === null ? null : toHHMM(t) });
  }
  const open = (tasks || [])
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t && !t.done && !t.paused && t.title)
    .sort((a, b) => taskRank(a.t, today) - taskRank(b.t, today) || a.i - b.i)
    .slice(0, TASK_LIMIT);
  // First free hour from the next half hour (never before 09:00), clear of every
  // timed reminder and of the blocks already handed out.
  let cursor = Math.max(DAY_START, Math.ceil(((nowMin || 0) + 1) / 30) * 30);
  for (const { t } of open) {
    let slot = null;
    while (cursor <= DAY_END) {
      const end = cursor + BLOCK;
      const clash = busy.find(([s, e]) => cursor < e && s < end);
      if (!clash) {
        slot = cursor;
        busy.push([cursor, end]);
        cursor = end;
        break;
      }
      cursor = Math.ceil(clash[1] / 30) * 30;
    }
    items.push({
      kind: 'task',
      id: t.id,
      title: t.title,
      time: slot === null ? null : toHHMM(slot),
      block: slot !== null,
      detail: WHY[taskRank(t, today)],
    });
  }
  return items.sort((a, b) => {
    if (a.time === b.time) return 0;
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time < b.time ? -1 : 1;
  });
}
