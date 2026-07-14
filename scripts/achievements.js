/* =====================================================================
   Growth Buddy — Achievements gallery
   A dedicated, unlockable badge gallery derived from the data we already
   track: XP/level, habit streaks (freeze-protected), goals, and the local
   wellness + trends history. All client-side (frontend-first), reached from
   the profile menu.
   ===================================================================== */
import { h, Card, SectionTitle, Icon } from './gb-kit.js';

const XP_PER_LEVEL = 500;

// Tier labels (shown as a small caption). Unlocked badges share one calm brand
// treatment rather than a different colour per tier, to keep the wall quiet.
const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

function countKeys(obj) {
  return obj ? Object.keys(obj).length : 0;
}

/**
 * Build the grouped achievement list from the current state. Each item is
 * either unlocked, or carries { current, target } so we can show progress.
 */
function computeAchievements({ user, topStreak, goals, wellness, trends, food, water }) {
  const xp = (user && user.xpTotal) || 0;
  const level = (user && user.level) || 1;
  const flatGoals = (goals || []).flatMap((s) => s.goals || []);
  const goalsTotal = flatGoals.length;
  const goalsDone = flatGoals.filter((g) => g.completed).length;

  const byDate = (trends && trends.byDate) || {};
  const trendDays = Object.values(byDate);
  const daysLogged = trendDays.length;
  const waterGoalDays = trendDays.filter(
    (d) => d.waterGoalMl > 0 && d.waterMl >= d.waterGoalMl
  ).length;
  const foodDays = trendDays.filter((d) => (d.kcal || 0) > 0).length;
  const strongDays = trendDays.filter((d) => (d.score || 0) >= 80).length;

  const moodCheckins = countKeys(wellness && wellness.moodByDate);
  const nights = countKeys(wellness && wellness.sleepByDate);
  const photos = ((wellness && wellness.photoHistory) || []).length;
  const todayPlates = (food && food.entries ? food.entries.length : 0) || 0;
  const waterHitToday =
    water && water.goalMl > 0 && (water.consumedMl || 0) >= water.goalMl ? 1 : 0;

  // helper: a milestone with a numeric threshold.
  const m = (id, icon, title, desc, tier, value, target) => ({
    id,
    icon,
    title,
    desc,
    tier,
    target,
    current: Math.min(value, target),
    unlocked: value >= target,
  });

  // Targets are set to be earned, not handed out: the first tier of each track
  // is a genuine milestone, and gold tiers take real, sustained effort.
  return [
    {
      title: 'Progress',
      items: [
        m('lvl2', 'sparkles', 'Rising Star', 'Reach Level 3', 'bronze', xp, XP_PER_LEVEL * 2),
        m('lvl5', 'zap', 'Achiever', 'Reach Level 8', 'silver', xp, XP_PER_LEVEL * 7),
        m('lvl10', 'trophy', 'Growth Guru', 'Reach Level 15', 'gold', xp, XP_PER_LEVEL * 14),
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
          waterGoalDays + waterHitToday,
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
          photos + foodDays + todayPlates,
          3
        ),
        m('food7', 'utensils', 'Food Diary', 'Log meals on 14 days', 'silver', foodDays, 14),
      ],
    },
  ];
}

function badgeTile(item) {
  const children = [
    h(
      'div',
      { class: 'gb-ach-icon' },
      Icon(item.icon, {
        size: 20,
        sw: 2.2,
        color: item.unlocked ? 'var(--fg-on-brand)' : 'var(--fg3)',
      })
    ),
    h(
      'div',
      { class: 'gb-ach-body' },
      h('div', { class: 'gb-ach-title' }, item.title),
      h(
        'div',
        { class: 'gb-ach-desc' },
        item.desc,
        TIER_LABEL[item.tier]
          ? h('span', { class: 'gb-ach-tier' }, ' · ' + TIER_LABEL[item.tier])
          : null
      )
    ),
  ];
  if (item.unlocked) {
    children.push(
      h('span', { class: 'gb-ach-check', title: 'Unlocked' }, Icon('check', { size: 14, sw: 3 }))
    );
  } else {
    const pct = item.target ? Math.round((item.current / item.target) * 100) : 0;
    children.push(
      h(
        'div',
        { class: 'gb-ach-progress' },
        h(
          'div',
          { class: 'gb-ach-progress-bar' },
          h('div', { class: 'gb-ach-progress-fill', style: { width: pct + '%' } })
        ),
        h('div', { class: 'gb-ach-progress-label' }, item.current + ' / ' + item.target)
      )
    );
  }
  return h(
    'div',
    {
      class: 'gb-ach-tile' + (item.unlocked ? ' is-unlocked' : ' is-locked'),
      'aria-label':
        item.title + ' — ' + (item.unlocked ? 'unlocked' : item.current + ' of ' + item.target),
    },
    children
  );
}

function ScreenAchievements(props) {
  const groups = computeAchievements(props);
  const all = groups.flatMap((g) => g.items);
  const unlocked = all.filter((i) => i.unlocked).length;
  const total = all.length;
  const pct = total ? Math.round((unlocked / total) * 100) : 0;
  const user = props.user || {};
  const xp = user.xpTotal || 0;
  const xpInLevel = xp % XP_PER_LEVEL;
  const xpPct = Math.round((xpInLevel / XP_PER_LEVEL) * 100);

  return h(
    'div',
    { class: 'gb-rise gb-ach' },
    h(
      'div',
      { class: 'gb-dash-block' },
      Card({
        className: 'gb-ach-summary',
        children: [
          h(
            'div',
            { class: 'gb-ach-summary-top' },
            h(
              'span',
              { class: 'gb-ach-summary-ic' },
              Icon('award', { size: 22, color: 'var(--brand)' })
            ),
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { class: 'gb-ach-summary-title' }, unlocked + ' of ' + total + ' unlocked'),
              h(
                'div',
                { class: 'gb-ach-summary-sub' },
                'Level ' + (user.level || 1) + ' · ' + xp + ' XP'
              )
            ),
            h('div', { class: 'gb-ach-summary-pct' }, pct + '%')
          ),
          // Badge completion — this is what the big % refers to.
          h(
            'div',
            { class: 'gb-ach-summary-bar' },
            h('div', { class: 'gb-ach-summary-fill', style: { width: pct + '%' } })
          ),
          h('div', { class: 'gb-ach-summary-caption' }, pct + '% of badges earned'),
          // XP toward the next level — a separate metric, so give it its own
          // labelled bar (previously the label sat under the badge bar, which
          // made "% to next level" look like it belonged to the badge %).
          h(
            'div',
            { class: 'gb-ach-summary-bar gb-ach-summary-bar--xp' },
            h('div', { class: 'gb-ach-summary-fill gb-ach-summary-fill--xp', style: { width: xpPct + '%' } })
          ),
          h('div', { class: 'gb-ach-summary-caption' }, xpPct + '% to Level ' + ((user.level || 1) + 1)),
        ],
      })
    ),
    groups.map((group) =>
      h(
        'div',
        { class: 'gb-dash-block' },
        SectionTitle({ title: group.title }),
        h('div', { class: 'gb-ach-grid' }, group.items.map(badgeTile))
      )
    )
  );
}

export { ScreenAchievements, computeAchievements };
