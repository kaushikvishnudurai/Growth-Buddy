/* =====================================================================
   Starter packs: pick a goal on Home's "Getting started" card, get the habits,
   reminders and targets for it in one tap. PACKS is plain data; planStarter is
   pure ("what would be created, given what already exists") so the preview and
   the test see the same list. app.js does the writing.

   Habit icons must be in HabitService.HABIT_ICONS, or the POST is refused.
   ===================================================================== */

export const PACKS = [
  {
    id: 'sleep',
    label: 'Sleep better',
    icon: 'moon',
    items: [
      { kind: 'habit', name: 'Screens off by 10:30 pm', icon: 'leaf', domain: 'habit', reminderTime: '22:15' },
      { kind: 'reminder', text: 'Wind down for bed', time: '22:00', repeat: 'daily', tag: 'health' },
      { kind: 'goal', title: 'Sleep 7+ hours most nights', days: 30 },
    ],
  },
  {
    id: 'money',
    label: 'Save money',
    icon: 'piggy-bank',
    items: [
      { kind: 'habit', name: 'Log every expense', icon: 'notebook-pen', domain: 'habit', reminderTime: '21:00' },
      { kind: 'budget' },
      { kind: 'goal', title: 'Spend less than last month', days: 30 },
    ],
  },
  {
    id: 'fit',
    label: 'Get fit',
    icon: 'dumbbell',
    items: [
      { kind: 'habit', name: 'Walk 8k steps', icon: 'footprints', domain: 'fitness', metric: 'steps', reminderTime: '18:00' },
      { kind: 'habit', name: 'Workout', icon: 'dumbbell', domain: 'fitness', metric: 'minutes', reminderTime: '07:00' },
      { kind: 'goal', title: 'Move every day for a month', days: 30 },
    ],
  },
  {
    id: 'eat',
    label: 'Eat better',
    icon: 'utensils',
    items: [
      { kind: 'habit', name: 'No sugar', icon: 'ban', domain: 'habit', habitKind: 'quit' },
      { kind: 'reminder', text: 'Log lunch', time: '13:30', repeat: 'daily', tag: 'health', feature: 'food' },
      { kind: 'goal', title: 'Cook at home 5 days a week', days: 30 },
    ],
  },
  {
    id: 'focus',
    label: 'Focus more',
    icon: 'focus',
    items: [
      { kind: 'habit', name: 'Read 20 min', icon: 'book-open', domain: 'study', reminderTime: '21:30' },
      { kind: 'reminder', text: "Plan tomorrow's top 3", time: '20:30', repeat: 'weekdays', tag: 'work' },
      { kind: 'goal', title: 'One deep-work block every weekday', days: 30 },
    ],
  },
  {
    id: 'water',
    label: 'Stay hydrated',
    icon: 'droplets',
    items: [{ kind: 'water' }, { kind: 'habit', name: 'Drink water', icon: 'droplets', domain: 'habit' }],
  },
];

/* Which feature a kind of item writes into: switched off, it is not offered. */
const KIND_FEATURE = { habit: 'habits', reminder: 'calendar', goal: 'goals', budget: 'money', water: 'water' };

const low = (s) => String(s || '').trim().toLowerCase();

function addDays(key, n) {
  const d = new Date(key + 'T12:00:00');
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* Budgets from what was really spent: the `limit` biggest categories of the last
   30 days (two for a starter pack; Money's Set budgets asks for all), 10% under,
   to the nearest 100. No spending yet means no number to stand on, so no budget —
   a made-up one is a target the user never chose. A tag that has one is skipped. */
export function budgetsFrom(money, today, limit = 2) {
  const since = addDays(today, -30);
  const spent = {};
  ((money && money.expenses) || []).forEach((e) => {
    if (!e || !e.date || e.date < since || e.date > today) return;
    const c = e.category || 'others';
    spent[c] = (spent[c] || 0) + (Number(e.amount) || 0);
  });
  const have = (money && money.budgets) || {};
  return Object.entries(spent)
    .filter(([c, v]) => v > 0 && !(Number(have[c]) > 0))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([category, v]) => ({ category, amount: Math.max(100, Math.round((v * 0.9) / 100) * 100) }));
}

/* The moment to offer a budget: the expense just added is this month's 5th in a
   tag with none. Exactly the 5th, so it is offered once, not on every one after.
   Returns budgetsFrom's figure for that tag, or null. Never for Others: a cap on
   "everything else" is not a budget anyone plans by. */
export function budgetOffer(money, category, today) {
  if (category === 'others') return null;
  const month = today.slice(0, 7);
  const n = ((money && money.expenses) || []).filter(
    (e) => e && (e.category || 'others') === category && String(e.date || '').startsWith(month)
  ).length;
  if (n !== 5) return null;
  return budgetsFrom(money, today, Infinity).find((b) => b.category === category) || null;
}

/**
 * Everything the chosen packs would create, minus what already exists.
 * ctx: { habits:[{name}], reminders:[{text}], goals:[{title}], features, waterGoalMl,
 *        weightKg, money, today:'YYYY-MM-DD', suggestWater:(kg)=>ml|null }
 * Returns rows { kind, ...fields } ready for app.js to write, deduped across packs.
 */
export function planStarter(packIds, ctx) {
  const on = (k) => !ctx.features || ctx.features[k] !== false;
  const seen = {
    habit: new Set((ctx.habits || []).map((x) => low(x.name))),
    reminder: new Set((ctx.reminders || []).map((x) => low(x.text))),
    goal: new Set((ctx.goals || []).map((x) => low(x.title))),
  };
  const out = [];
  let budgetDone = false;
  let waterDone = false;
  PACKS.filter((p) => packIds.includes(p.id)).forEach((pack) => {
    pack.items.forEach((it) => {
      if (!on(KIND_FEATURE[it.kind]) || (it.feature && !on(it.feature))) return;
      if (it.kind === 'habit' || it.kind === 'reminder' || it.kind === 'goal') {
        const key = low(it.name || it.text || it.title);
        if (seen[it.kind].has(key)) return;
        seen[it.kind].add(key);
        if (it.kind === 'goal') out.push({ ...it, pack: pack.id, targetDate: addDays(ctx.today, it.days) });
        else out.push({ ...it, pack: pack.id });
      } else if (it.kind === 'budget' && !budgetDone) {
        budgetDone = true;
        budgetsFrom(ctx.money, ctx.today).forEach((b) => out.push({ kind: 'budget', pack: pack.id, ...b }));
      } else if (it.kind === 'water' && !waterDone) {
        waterDone = true;
        // ponytail: 2.5 L when there's no weight to work from; Settings has the real field
        const ml = (ctx.suggestWater && ctx.suggestWater(ctx.weightKg)) || 2500;
        if (!(Number(ctx.waterGoalMl) >= ml)) out.push({ kind: 'water', pack: pack.id, goalMl: ml });
      }
    });
  });
  return out;
}
