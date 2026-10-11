/* =====================================================================
   Growth Buddy — Achievements gallery
   A dedicated, unlockable badge gallery derived from the data we already
   track: XP/level, habit streaks (freeze-protected), goals, and the local
   wellness + trends history. All client-side (frontend-first), reached from
   the profile menu. The screen itself is achievements-screen.js (lazy);
   this half stays in boot for the unlock check and the XP bar.
   ===================================================================== */

// The server owns the level curve (ProgressService.XP_PER_LEVEL) and sends each
// user's progress through it; this is only the fallback for an older cached user.
const XP_PER_LEVEL_FALLBACK = 100;

/** Level progress, from the server's numbers when the user object carries them. */
function levelProgress(user) {
  const u = user || {};
  const xp = Number(u.xpTotal) || 0;
  const per = Number(u.xpPerLevel) > 0 ? Number(u.xpPerLevel) : XP_PER_LEVEL_FALLBACK;
  const level = Number(u.level) || Math.max(1, 1 + Math.floor(xp / per));
  const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const into = num(u.xpIntoLevel) ?? xp % per;
  const toNext = num(u.xpForNextLevel) ?? per - into;
  const span = into + toNext || per;
  return { xp, level, into, toNext, pct: Math.round((into / span) * 100) };
}

function countKeys(obj) {
  return obj ? Object.keys(obj).length : 0;
}

/**
 * Build the grouped achievement list from the current state. Each item is
 * either unlocked, or carries { current, target } so we can show progress.
 */
function computeAchievements({ user, topStreak, goals, wellness, trends, food, water, seen }) {
  const { xp, level } = levelProgress(user);
  // A badge once earned stays earned: the day counts below only see the 60 days
  // boot loads, so "Be active 14 days" would relock as old days slid out.
  const earned = new Set(Array.isArray(seen) ? seen : []);
  const flatGoals = (goals || []).flatMap((s) => s.goals || []);
  const goalsTotal = flatGoals.length;
  const goalsDone = flatGoals.filter((g) => g.completed).length;

  const byDate = (trends && trends.byDate) || {};
  const trendDays = Object.values(byDate);
  const daysLogged = trendDays.length;
  // Day counts are sets of dates: adding today's live numbers to a history that
  // may already hold today counted it twice (two plates on day 1 unlocked "3 days").
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
  const datesWhere = (ok) => new Set(Object.keys(byDate).filter((k) => ok(byDate[k])));
  const waterDates = datesWhere((d) => d.waterGoalMl > 0 && d.waterMl >= d.waterGoalMl);
  const foodDates = datesWhere((d) => (d.kcal || 0) > 0);
  const strongDays = trendDays.filter((d) => (d.score || 0) >= 80).length;

  const moodCheckins = countKeys(wellness && wellness.moodByDate);
  const nights = countKeys(wellness && wellness.sleepByDate);
  ((wellness && wellness.photoHistory) || []).forEach((p) => p && p.date && foodDates.add(p.date));
  if (food && food.entries && food.entries.length) foodDates.add(today);
  if (water && water.goalMl > 0 && (water.consumedMl || 0) >= water.goalMl) waterDates.add(today);
  const waterGoalDays = waterDates.size;
  const foodDays = foodDates.size;

  // helper: a milestone with a numeric threshold.
  const m = (id, icon, title, desc, tier, value, target) => {
    const unlocked = value >= target || earned.has(id);
    return {
      id,
      icon,
      title,
      desc,
      tier,
      target,
      current: unlocked ? target : Math.min(value, target),
      unlocked,
    };
  };

  // Targets are set to be earned, not handed out: the first tier of each track
  // is a genuine milestone, and gold tiers take real, sustained effort.
  return [
    {
      title: 'Progress',
      items: [
        m('lvl2', 'sparkles', 'Rising Star', 'Reach Level 3', 'bronze', level, 3),
        m('lvl5', 'zap', 'Achiever', 'Reach Level 8', 'silver', level, 8),
        m('lvl10', 'trophy', 'Growth Guru', 'Reach Level 15', 'gold', level, 15),
      ],
      note: 'Level ' + level + ' · ' + xp + ' XP',
    },
    {
      title: 'Streaks',
      items: [
        m('streak3', 'flame', 'Spark', 'Hold a 5-day habit streak', 'bronze', topStreak, 5),
        m('streak7', 'flame', 'Ablaze', 'Hold a 14-day streak', 'silver', topStreak, 14),
        m('streak30', 'flame', 'Inferno', 'Hold a 50-day streak', 'gold', topStreak, 50),
      ],
    },
    {
      title: 'Consistency',
      items: [
        m('log3', 'calendar-check', 'Showing Up', 'Be active 5 days', 'bronze', daysLogged, 5),
        m('log7', 'calendar-check', 'Regular', 'Be active 14 days', 'silver', daysLogged, 14),
        m('strong5', 'verified', 'On a Roll', 'Score 80%+ on 10 days', 'gold', strongDays, 10),
      ],
    },
    {
      title: 'Wellness',
      items: [
        m(
          'mood1',
          'smile-plus',
          'Self-Aware',
          'Log 3 mood check-ins',
          'bronze',
          moodCheckins,
          3
        ),
        m('mood7', 'heart', 'Mindful', 'Log 14 mood check-ins', 'silver', moodCheckins, 14),
        m('sleep5', 'moon', 'Well Rested', 'Log 10 nights of sleep', 'silver', nights, 10),
      ],
    },
    {
      title: 'Hydration',
      items: [
        m(
          'water1',
          'droplets',
          'Hydrated',
          'Hit your water goal 3 days',
          'bronze',
          waterGoalDays,
          3
        ),
        m('water7', 'droplets', 'Aqua Pro', 'Hit your water goal 14 days', 'gold', waterGoalDays, 14),
      ],
    },
    {
      title: 'Goals',
      items: [
        m('goal1', 'target', 'Dreamer', 'Create your first goal', 'bronze', goalsTotal, 1),
        m('goaldone1', 'verified', 'Finisher', 'Complete a goal', 'silver', goalsDone, 1),
        m('goaldone5', 'trophy', 'Visionary', 'Complete 10 goals', 'gold', goalsDone, 10),
      ],
    },
    {
      title: 'Nutrition',
      items: [
        m(
          'plate1',
          'camera',
          'Plate Logger',
          'Log meals on 3 days',
          'bronze',
          foodDays,
          3
        ),
        m('food7', 'utensils', 'Food Diary', 'Log meals on 14 days', 'silver', foodDays, 14),
      ],
    },
  ];
}

export { computeAchievements, levelProgress };
