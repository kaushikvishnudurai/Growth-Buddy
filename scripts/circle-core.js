/* =====================================================================
   Growth Buddy — Circle, the pure parts (no DOM; checked by
   circle-core.test.mjs): where you stand in a challenge, the wins worth
   sharing, the one-tap challenge templates, and the invite link.
   ===================================================================== */

/** One-tap starts for "Start a challenge": each fills the form, Start sends it. */
export const CHALLENGE_TEMPLATES = [
  { label: '7-day habit sprint', title: '7-day habit sprint', metric: 'habit_checkins', days: 7 },
  { label: 'Focus week', title: 'Focus week', metric: 'focus_minutes', days: 7 },
  { label: 'Hydration week', title: 'Hit the water goal', metric: 'water_days', days: 7 },
  { label: '30-day streak', title: '30-day habit streak', metric: 'habit_checkins', days: 30 },
];

/**
 * One line on what to do next: "You're #2, 3 check-ins behind Priya." An ended
 * challenge names its winner instead. `unit(n)` is the metric's own wording.
 * Null when there is nothing to say (no board, or you're not on it).
 */
export function standingLine(entries, me, unit, ended) {
  if (!entries || !entries.length) return null;
  const top = entries.filter((e) => e.rank === 1);
  if (ended) {
    if (!top[0] || top[0].value <= 0) return 'Ended with no score on the board.';
    const names = top.map((e) => (e.userId === me ? 'You' : e.name));
    return (
      (names.length > 1
        ? names.join(' and ') + ' tied for the win'
        : names[0] === 'You'
          ? 'You won'
          : names[0] + ' won') +
      ' with ' +
      unit(top[0].value) +
      '.'
    );
  }
  const mine = entries.find((e) => e.userId === me);
  if (!mine || entries.length < 2) return null;
  if (mine.rank === 1) {
    if (top.length > 1) return 'Tied for first. One more puts you ahead.';
    const next = entries.find((e) => e.rank > 1);
    return next ? 'You lead by ' + unit(mine.value - next.value) + '.' : null;
  }
  const ahead = entries.filter((e) => e.rank < mine.rank).pop();
  return (
    "You're #" + mine.rank + ', ' + unit(ahead.value - mine.value) + ' behind ' + ahead.name + '.'
  );
}

/**
 * Wins worth a post, from what the app already holds: a streak of 3+ days, a
 * goal finished in the last week, a full habit day. Newest-sounding first, at
 * most four, so the composer offers a tap instead of a blank box.
 */
export function winLines({ habits = [], goals = [], today = '' } = {}) {
  const out = [];
  habits
    .filter((x) => x && x.kind !== 'quit' && x.active !== false && (x.streak || 0) >= 3)
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 2)
    .forEach((x) => out.push('Day ' + x.streak + ' of ' + x.name + ' in a row.'));
  const weekAgo = today ? shiftDay(today, -7) : '';
  goals
    .filter(
      (g) => g && g.completed && (!weekAgo || String(g.completedAt || '').slice(0, 10) >= weekAgo)
    )
    .slice(0, 1)
    .forEach((g) => out.push('Goal done: ' + g.title + '.'));
  const daily = habits.filter((x) => x && x.kind !== 'quit' && x.active !== false);
  if (daily.length >= 2 && daily.every((x) => x.doneToday)) {
    out.push('Every habit ticked today, all ' + daily.length + '.');
  }
  return out.slice(0, 4);
}

function shiftDay(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The link that joins a circle in one tap: a private one by its code, a public one by id. */
export function inviteLink(base, c) {
  const q = c.joinCode
    ? 'join=' + encodeURIComponent(c.joinCode)
    : 'circle=' + encodeURIComponent(c.id);
  return base.replace(/#.*$/, '') + '#/circle?' + q;
}

/** What an opened invite link asks for: {code} or {id}, else null. */
export function inviteFromHash(hash) {
  const q = String(hash || '').split('?')[1];
  if (!q) return null;
  const p = new URLSearchParams(q);
  if (p.get('join')) return { code: p.get('join').toUpperCase() };
  if (p.get('circle')) return { id: p.get('circle') };
  return null;
}
