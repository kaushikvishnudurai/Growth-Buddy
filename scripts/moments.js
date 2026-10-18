/* Small wins worth the celebration popup (celebrate.js): a streak milestone, the
   last of today's habits, every task due today, the water goal, a no-spend day.
   Each takes the state just before and just after one action and returns the
   popup ({ kicker, title, desc, icon, key }) or null; `key` is what app.js
   shows once per day. Pure, so moments.test.mjs runs it in node. */

const MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 250, 365];

export function isStreakMilestone(n) {
  return MILESTONES.includes(n) || (n > 365 && n % 100 === 0);
}

const owed = (h) => h.active !== false && (h.dueToday !== false || h.doneToday);

/* A habit just ticked. One popup per tap: a milestone beats "all done". */
export function habitMoment(habit, habits, day) {
  if (!habit || !habit.doneToday) return null;
  const n = Number(habit.streak) || 0;
  if (isStreakMilestone(n)) {
    // A weekly / N-a-week streak counts weeks (app.js streakUnit), not days.
    const unit = (habit.cadence || 'daily') === 'daily' ? 'day' : 'week';
    return {
      key: 'streak:' + habit.id + ':' + n,
      kicker: 'Streak milestone',
      title: n + ' ' + unit + 's in a row',
      desc: habit.name + ', every ' + unit + ' for ' + n + ' ' + unit + 's.',
      icon: 'flame',
    };
  }
  const due = (habits || []).filter(owed);
  if (due.length >= 2 && due.every((h) => h.doneToday)) {
    return {
      key: 'habits:' + day,
      kicker: 'All habits done',
      title: 'Every habit, done today',
      desc: due.length + ' of ' + due.length + ' ticked off.',
      icon: 'list-checks',
    };
  }
  return null;
}

/* A task just ticked: `today` = tasksForToday after the tick. */
export function tasksMoment(today, day) {
  const list = today || [];
  if (list.length < 2 || !list.every((t) => t.done)) return null;
  return {
    key: 'tasks:' + day,
    kicker: 'Tasks cleared',
    title: 'Everything due today is done',
    desc: list.length + ' tasks finished.',
    icon: 'circle-check',
  };
}

export function waterMoment(beforeMl, afterMl, goalMl, day) {
  if (!(goalMl > 0) || beforeMl >= goalMl || afterMl < goalMl) return null;
  return {
    key: 'water:' + day,
    kicker: 'Water goal reached',
    title: (Math.round(goalMl / 100) / 10).toLocaleString() + ' L today',
    desc: 'You hit your daily water goal.',
    icon: 'droplets',
  };
}

/* `days`: the no-spend days after marking `day` (YYYY-MM-DD). */
export function noSpendMoment(days, day) {
  const month = String(day).slice(0, 7);
  const n = new Set((days || []).filter((d) => String(d).startsWith(month))).size;
  return {
    key: 'nospend:' + day,
    kicker: 'No-spend day',
    title: 'Wallet stayed shut',
    desc: n > 1 ? n + ' no-spend days this month.' : 'Your first no-spend day this month.',
    icon: 'piggy-bank',
  };
}
