/* =====================================================================
   Growth Buddy — the wins worth sharing to a circle (no DOM; checked by
   circle-core.test.mjs). Its own file so app.js can import it at boot
   without pulling the rest of circle-core.js into the boot chunk.
   ===================================================================== */

import { shiftDayKey, habitDue } from './home-order.js';

/**
 * Wins worth a post, from what the app already holds: a streak of 3+ (days, or
 * weeks for a weekly cadence), a goal finished in the last week, a full habit day
 * (every habit due today ticked). Newest-sounding first, at
 * most four, so the composer offers a tap instead of a blank box.
 */
export function winLines({ habits = [], goals = [], today = '' } = {}) {
  const out = [];
  habits
    .filter((x) => x && x.kind !== 'quit' && x.active !== false && (x.streak || 0) >= 3)
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 2)
    .forEach((x) => out.push(((x.cadence || 'daily') === 'daily' ? 'Day ' : 'Week ') + x.streak + ' of ' + x.name + ' in a row.'));
  const weekAgo = today ? shiftDayKey(today, -7) : '';
  goals
    .filter(
      (g) => g && g.completed && (!weekAgo || String(g.completedAt || '').slice(0, 10) >= weekAgo)
    )
    .slice(0, 1)
    .forEach((g) => out.push('Goal done: ' + g.title + '.'));
  const daily = habits.filter((x) => x && x.kind !== 'quit' && habitDue(x));
  if (daily.length >= 2 && daily.every((x) => x.doneToday)) {
    out.push('Every habit ticked today, all ' + daily.length + '.');
  }
  return out.slice(0, 4);
}

