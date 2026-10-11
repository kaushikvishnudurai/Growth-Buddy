/* =====================================================================
   Growth Buddy — the one thing today
   ---------------------------------------------------------------------
   Pure, DOM-free. Picks the single highest-leverage action for Home's top
   card from data already loaded; the card's one button does it. Returns
   {kind, title, why, label, arg} or null when nothing is owed.
   Checked by `node scripts/one-thing.test.mjs`.
   ===================================================================== */
import { habitDue, sortTasksForHome, localDayKey } from './home-order.js';
import { budgetStatus, normalizeMoney } from './money-core.js';
import { sleepToConfirm } from './nudges.js';

/* `can(kind)` says whether the screen has a handler for that kind; a kind it
   can't act on is skipped, so the card never shows a dead button. */
export function pickOneThing({
  tasks,
  habits,
  water,
  wellness,
  money,
  now = new Date(),
  features,
  can = () => true,
}) {
  const on = (k) => !features || features[k] !== false;
  const today = localDayKey(now);
  const hour = now.getHours() + now.getMinutes() / 60;
  // ponytail: fixed priority order (a streak about to break beats everything);
  // score by measured impact if users say the card picks the wrong thing.

  if (on('habits') && can('streak') && hour >= 18) {
    const hb = (habits || [])
      .filter(
        (x) =>
          x.active !== false &&
          (x.cadence || 'daily') === 'daily' &&
          habitDue(x) &&
          !x.doneToday &&
          (Number(x.streak) || 0) >= 2
      )
      .sort((a, b) => b.streak - a.streak)[0];
    if (hb)
      return {
        kind: 'streak',
        title: 'Keep your ' + hb.streak + '-day ' + hb.name + ' streak',
        why: 'It breaks at midnight',
        label: 'Done',
        arg: hb.id,
      };
  }

  if (can('overdue')) {
    const t = sortTasksForHome(tasks, now).find((x) => x.overdue && !x.done);
    if (t) return { kind: 'overdue', title: t.title, why: 'Overdue', label: 'Done', arg: t.id };
  }

  if (on('money') && can('budget') && money) {
    const b = budgetStatus(normalizeMoney(money))
      .filter((s) => s.budget > 0 && s.pct >= 85)
      .sort((a, b) => b.pct - a.pct)[0];
    if (b)
      return {
        kind: 'budget',
        title: b.cat.label + ' is at ' + b.pct + '% of budget',
        why: 'Check before the next spend',
        label: 'Open Money',
        arg: b.cat.key,
      };
  }

  const sleepByDate = wellness && wellness.sleepByDate;
  const u = can('sleep') ? sleepToConfirm(sleepByDate, today, now) : null;
  if (u)
    return {
      kind: 'sleep',
      title: 'Slept ' + u.bedtime + ' to ' + u.wakeTime + '?',
      why: 'Your usual night, one tap to log it',
      label: 'Yes, usual night',
      arg: u,
    };

  if (on('water') && can('water') && water) {
    const goal = Number(water.goalMl) || 2000;
    // ponytail: linear pace 08:00 to 21:00; the median hourly curve from
    // /api/water/times (as insights.js reads it) when this nags early drinkers.
    const pace = goal * Math.min(1, Math.max(0, (hour - 8) / 13));
    if ((Number(water.consumedMl) || 0) < pace - 250)
      return {
        kind: 'water',
        title: 'You are behind on water',
        why: Math.round(water.consumedMl || 0) + ' of ' + goal + ' ml so far',
        label: '+250 ml',
        arg: 250,
      };
  }

  const moodByDate = wellness && wellness.moodByDate;
  if (can('mood') && hour >= 12 && !(moodByDate && moodByDate[today]))
    return {
      kind: 'mood',
      title: 'How is today going?',
      why: 'Mood not logged yet',
      label: 'Log mood',
      arg: null,
    };

  return null;
}
