/* =====================================================================
   Growth Buddy — Dashboard (Home) screen
   ===================================================================== */
import {
  h,
  Card,
  SectionTitle,
  Pill,
  IconChip,
  Icon,
  Check,
  ProgressRing,
  plural,
  openOverlay,
  formatTime as sharedFormatTime,
  thinkingLabel,
  Thinking,
} from './gb-kit.js';
import { MoneyHomeCard } from './money.js';
import { CacheStorage } from './cache-storage.js';
import { occursOn } from './recurrence.js';

const ONBOARD_KEY = 'gb.onboardDismissed';

/* First-run checklist: shown until the basics are set up (or dismissed). Each
   step marks itself done from existing data, so it doubles as live progress. */
function OnboardingCard({
  tasks,
  habits,
  wellness,
  onAddHabit,
  onAddTask,
  onAddMood,
  onOnboardDismiss,
}) {
  if (CacheStorage.getItem(ONBOARD_KEY) === '1') return null;
  const today = todayKey();
  const steps = [
    {
      done: (habits || []).length > 0,
      label: 'Add your first habit',
      hint: 'Something to do daily',
      icon: 'repeat',
      action: onAddHabit,
    },
    {
      done: (tasks || []).length > 0,
      label: 'Add a task for today',
      hint: 'One thing to get done',
      icon: 'list-todo',
      action: onAddTask,
    },
    {
      done: !!(wellness && wellness.moodByDate && wellness.moodByDate[today]),
      label: 'Log how you feel',
      hint: 'A quick mood check-in',
      icon: 'smile-plus',
      action: onAddMood,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) {
    CacheStorage.setItem(ONBOARD_KEY, '1'); // all set — don't show again
    if (onOnboardDismiss) onOnboardDismiss();
    return null;
  }
  return Card({
    className: 'gb-onboard',
    children: [
      h(
        'div',
        { class: 'gb-onboard-head' },
        h(
          'div',
          null,
          h('div', { class: 'gb-onboard-kicker' }, 'Getting started'),
          h('div', { class: 'gb-onboard-title' }, 'Set up in ' + steps.length + ' quick steps')
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-onboard-dismiss',
            'aria-label': 'Dismiss',
            onclick: () => {
              CacheStorage.setItem(ONBOARD_KEY, '1');
              if (onOnboardDismiss) onOnboardDismiss();
              const el = document.querySelector('.gb-onboard');
              if (el) el.closest('.gb-dash-block').style.display = 'none';
            },
          },
          Icon('x', { size: 16, sw: 2.4 })
        )
      ),
      h(
        'div',
        { class: 'gb-onboard-steps' },
        ...steps.map((s) =>
          h(
            'button',
            {
              type: 'button',
              class: 'gb-onboard-step' + (s.done ? ' is-done' : ''),
              onclick: s.done ? null : s.action,
              disabled: s.done,
            },
            h(
              'span',
              { class: 'gb-onboard-step-ic' },
              Icon(s.done ? 'check' : s.icon, { size: 16, sw: 2.4 })
            ),
            h(
              'span',
              { class: 'gb-onboard-step-tx' },
              h('span', { class: 'gb-onboard-step-l' }, s.label),
              h('span', { class: 'gb-onboard-step-h' }, s.hint)
            ),
            s.done ? null : Icon('chevron-right', { size: 16, sw: 2.4 })
          )
        )
      ),
    ],
  });
}

const PRIORITY = {
  High: { bg: 'var(--coral-50)', fg: 'var(--coral-700)', dot: 'var(--coral-500)' },
  Medium: { bg: 'var(--sun-50)', fg: 'var(--sun-700)', dot: 'var(--sun-500)' },
  Low: { bg: 'var(--surface-3)', fg: 'var(--fg2)', dot: 'var(--warm-400)' },
};

function todayKey() {
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function sleepHours(entry) {
  if (!entry || !entry.bedtime || !entry.wakeTime) return null;
  const bed = entry.bedtime.split(':').map(Number);
  const wake = entry.wakeTime.split(':').map(Number);
  if (bed.length < 2 || wake.length < 2) return null;
  let start = bed[0] * 60 + bed[1];
  let end = wake[0] * 60 + wake[1];
  if (end <= start) end += 24 * 60;
  return Math.round(((end - start) / 60) * 10) / 10;
}

function allGoals(sections) {
  return (sections || []).flatMap((section) => section.goals || []);
}

function ScoreCard({ score, tasks, habits }) {
  const doneTasks = tasks.filter((t) => t.done).length;
  const doneHabits = habits.filter((h) => h.doneToday).length;
  const topStreak = habits.reduce((m, h) => Math.max(m, h.streak || 0), 0);

  const ringNumber = h(
    'span',
    {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: '1.625rem',
        color: 'var(--fg1)',
        lineHeight: 1,
      },
    },
    score + '%'
  );
  // The unit lives in the number ("17%"), not in the label. "17" over "SCORE"
  // named a currency nobody could price; the percent sign says it's a share of
  // something, and the sub-line beside it ("0/4 tasks · 1/3 habits") says of
  // what. The word stays "score" because Progress calls it that too, in the
  // summary tile and in the "Daily score" trend — one number, one name.
  const ringLabel = h(
    'span',
    { style: { fontSize: '0.625rem', fontWeight: 700, color: 'var(--fg3)' } },
    'SCORE'
  );

  const ring = ProgressRing({
    value: score,
    size: 92,
    color: 'var(--brand)',
    children: [ringNumber, ringLabel],
  });

  const heading =
    score >= 70 ? "You're on track 🔥" : score > 0 ? 'Keep it going' : 'Let’s get started';

  const pills = [];
  if (topStreak > 0) {
    pills.push(
      Pill({
        icon: 'flame',
        label: topStreak + '-day',
        bg: 'var(--coral-50)',
        fg: 'var(--coral-700)',
      })
    );
  }

  const subParts = [];
  if (tasks.length) subParts.push(doneTasks + '/' + tasks.length + ' tasks');
  if (habits.length) subParts.push(doneHabits + '/' + habits.length + ' habits');
  const sub = subParts.length ? subParts.join(' · ') : 'Add a task or habit to begin';

  return Card({
    className: 'gb-score-card',
    children: [
      ring,
      h(
        'div',
        { style: { flex: 1 } },
        h('div', { class: 'gb-score-heading' }, heading),
        h('div', { class: 'gb-score-sub' }, sub),
        pills.length ? h('div', { class: 'gb-pill-row' }, pills) : null
      ),
    ],
  });
}

function TaskRow(task, toggleTask, onEdit) {
  const p = PRIORITY[task.priority] || PRIORITY.Low;
  return h(
    'div',
    { class: 'gb-row' + (task.done ? ' is-done' : '') },
    Check({ done: task.done, onToggle: () => toggleTask(task.id) }),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h('div', { class: 'title' }, task.title),
      h('div', { class: 'sub' }, sharedFormatTime(task.time))
    ),
    Pill({ label: task.priority, bg: p.bg, fg: p.fg, dot: p.dot }),
    onEdit
      ? h(
          'button',
          {
            type: 'button',
            class: 'gb-icon-btn',
            'aria-label': 'Edit ' + task.title,
            onclick: () => onEdit(task),
          },
          Icon('pencil', { size: 15, sw: 2.4 })
        )
      : null
  );
}

function TasksCard({ tasks, toggleTask, onAdd, onEdit }) {
  if (!tasks.length) {
    return Card({
      children: [
        h(
          'div',
          { class: 'gb-empty' },
          Icon('list-todo', { size: 26, color: 'var(--brand-soft-fg)' }),
          h('p', null, 'No tasks yet. Add one to start your day.'),
          h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--soft', onclick: onAdd },
            Icon('plus', { size: 16, sw: 2.6 }),
            'Add your first task'
          )
        ),
      ],
    });
  }
  return Card({
    children: [
      h(
        'div',
        { class: 'gb-tasks-scroll' },
        tasks.map((t) => TaskRow(t, toggleTask, onEdit))
      ),
    ],
  });
}

function HabitCard(habit, toggleHabit) {
  return Card({
    className: 'gb-habit-card' + (habit.doneToday ? ' is-done' : ''),
    children: [
      IconChip({ domain: habit.domain, icon: habit.icon }),
      h('div', { class: 'name' }, habit.name),
      h(
        'div',
        { class: 'streak' },
        Icon('flame', { size: 14, color: 'var(--coral-500)' }),
        String(habit.streak || 0)
      ),
      toggleHabit
        ? Check({ done: !!habit.doneToday, onToggle: () => toggleHabit(habit.id) })
        : null,
    ],
  });
}

function QuoteCard({ quote }) {
  const text = quote && quote.body ? quote.body : 'Do one small thing today.';
  const author = quote && quote.author ? ' - ' + quote.author : '';
  return Card({
    className: 'gb-quote-card',
    children: [
      h(
        'div',
        { class: 'gb-quote-eyebrow' },
        Icon('quote', { size: 16, color: 'var(--ai)' }),
        'Quote of the day'
      ),
      h('p', { class: 'gb-quote-text' }, '"' + text + '"' + author),
    ],
  });
}

function TodayPlanCard({ water, wellness, onPlanToday }) {
  const key = todayKey();
  const sleep = wellness && wellness.sleepByDate ? wellness.sleepByDate[key] : null;
  const mood = wellness && wellness.moodByDate ? wellness.moodByDate[key] : null;
  const waterGoal = Math.max(1, (water && water.goalMl) || 2000);
  const waterPct = Math.min(
    100,
    Math.round((((water && water.consumedMl) || 0) / waterGoal) * 100)
  );
  // The brief lists what's still open. Two rules got it here:
  //   - It doesn't repeat the ring. The score card above measures exactly tasks
  //     and habits and already reads "0/4 tasks · 1/3 habits"; the brief used to
  //     restate that as "4 tasks left · 2 habits left" — the same two facts, in
  //     opposite polarity, one card apart.
  //   - It doesn't congratulate. "Sleep logged" sat directly above a card
  //     showing "7.5h · Good", so the chip said less than the thing beneath it.
  // Finish everything and the row empties out, which is the point.
  const chips = [];
  if (waterPct < 100) chips.push({ label: waterPct + '% water' });
  if (!sleep) chips.push({ label: 'Sleep not logged' });
  if (!mood) chips.push({ label: 'Mood not logged' });
  return Card({
    className: 'gb-coach-card',
    children: [
      h(
        'div',
        { class: 'gb-coach-head' },
        h(
          'div',
          null,
          h('div', { class: 'gb-coach-kicker' }, 'Daily brief'),
          h('div', { class: 'gb-coach-title' }, 'Help me plan today')
        ),
        h(
          'button',
          { type: 'button', class: 'gb-btn gb-btn--primary gb-btn--compact', onclick: onPlanToday },
          Icon('sparkles', { size: 16, sw: 2.5 }),
          'Plan my day'
        )
      ),
      chips.length
        ? h(
            'div',
            { class: 'gb-coach-chiprow' },
            chips.map((chip) =>
              h('span', { class: 'gb-coach-chip gb-coach-chip--todo' }, chip.label)
            )
          )
        : null,
    ],
  });
}

function WellnessCard({ wellness, onAddSleep, onAddMood }) {
  const key = todayKey();
  const sleep = wellness && wellness.sleepByDate ? wellness.sleepByDate[key] : null;
  const mood = wellness && wellness.moodByDate ? wellness.moodByDate[key] : null;
  const hours = sleepHours(sleep);
  return Card({
    className: 'gb-wellness-card',
    children: [
      h(
        'div',
        { class: 'gb-wellness-grid' },
        h(
          'button',
          { type: 'button', class: 'gb-wellness-tile', onclick: onAddSleep },
          h('span', { class: 'gb-wellness-icon' }, Icon('moon', { size: 18, sw: 2.4 })),
          h('span', { class: 'gb-wellness-label' }, 'Sleep'),
          h('strong', null, hours == null ? 'Log' : hours + 'h'),
          h('small', null, sleep ? sleep.quality : 'hours slept')
        ),
        h(
          'button',
          { type: 'button', class: 'gb-wellness-tile', onclick: onAddMood },
          h('span', { class: 'gb-wellness-icon' }, Icon('smile-plus', { size: 18, sw: 2.4 })),
          h('span', { class: 'gb-wellness-label' }, 'Mood'),
          h('strong', null, mood ? mood.mood : 'Log'),
          h('small', null, mood ? mood.energy + ' energy' : 'how you feel')
        )
      ),
    ],
  });
}

function WeeklyReflectionCard({ tasks, habits, food, goals, wellness }) {
  const doneTasks = (tasks || []).filter((t) => t.done).length;
  const doneHabits = (habits || []).filter((habit) => habit.doneToday).length;
  const actionCount = allGoals(goals).reduce((sum, goal) => sum + (goal.actionCount || 0), 0);
  const sleepDays = Object.keys((wellness && wellness.sleepByDate) || {}).length;
  const moodDays = Object.keys((wellness && wellness.moodByDate) || {}).length;
  const kcal = Math.max(0, (food && food.totalCalories) || 0);
  const lines = [
    plural(doneTasks, 'task') + ' completed',
    plural(doneHabits, 'habit') + ' done today',
    plural(actionCount, 'goal action') + ' logged',
    plural(sleepDays, 'sleep log') + ' and ' + plural(moodDays, 'mood log'),
    kcal ? kcal + ' kcal logged today' : 'food log ready when needed',
  ];
  return Card({
    className: 'gb-reflect-card',
    children: [
      h(
        'div',
        { class: 'gb-card-titleline' },
        Icon('calendar-heart', { size: 18, sw: 2.4 }),
        'Weekly reflection'
      ),
      h(
        'div',
        { class: 'gb-reflect-list' },
        lines.map((line) => h('div', { class: 'gb-reflect-row' }, line))
      ),
    ],
  });
}

function BadgeCard({ tasks, habits, water, goals, wellness }) {
  const topStreak = (habits || []).reduce((max, habit) => Math.max(max, habit.streak || 0), 0);
  const waterGoal = (water && water.goalMl) || 2000;
  const waterHit = ((water && water.consumedMl) || 0) >= waterGoal;
  const actionCount = allGoals(goals).reduce((sum, goal) => sum + (goal.actionCount || 0), 0);
  const photoCount = ((wellness && wellness.photoHistory) || []).length;
  const badges = [
    { on: (tasks || []).some((t) => t.done), icon: 'check-circle-2', label: 'Task finisher' },
    { on: topStreak >= 3, icon: 'flame', label: '3-day streak' },
    { on: waterHit, icon: 'droplets', label: 'Hydrated' },
    { on: actionCount > 0, icon: 'target', label: 'Goal mover' },
    { on: photoCount > 0, icon: 'camera', label: 'Plate logged' },
  ];
  return Card({
    className: 'gb-badge-card',
    children: [
      h('div', { class: 'gb-card-titleline' }, Icon('award', { size: 18, sw: 2.4 }), 'Milestones'),
      h(
        'div',
        { class: 'gb-badge-grid' },
        badges.map((badge) =>
          h(
            'div',
            { class: 'gb-badge' + (badge.on ? ' is-on' : '') },
            Icon(badge.icon, { size: 16, sw: 2.4 }),
            h('span', null, badge.label)
          )
        )
      ),
    ],
  });
}

/* A suggestion is for a clock time today, so one whose time has gone by is
   noise — the card still offered "Sleep routine · 22:30" at one in the morning,
   and the Add button would book it for a moment that cannot arrive. */
const minutesOfDay = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

function ReminderSuggestionsCard({ habits, water, wellness, reminders, onAddSuggestedReminder }) {
  const key = todayKey();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const stillToCome = (item) => minutesOfDay(item.time) > nowMinutes;
  const items = [];
  const missedHabit = (habits || []).find((habit) => !habit.doneToday);
  if (missedHabit)
    items.push({
      icon: 'repeat',
      text: missedHabit.name + ' reminder',
      time: '19:00',
      tag: 'health',
    });
  const waterGoal = (water && water.goalMl) || 2000;
  if (((water && water.consumedMl) || 0) < waterGoal * 0.5)
    items.push({ icon: 'droplets', text: 'Drink water', time: '16:00', tag: 'health' });
  if (!((wellness && wellness.sleepByDate) || {})[key])
    items.push({ icon: 'moon', text: 'Sleep routine', time: '22:30', tag: 'personal' });
  /* A suggestion the user already acted on is not a suggestion. Nothing here
     read the reminders that exist, so "Add reminder" stayed on the row after it
     had been added and a second tap booked a duplicate. Matched on the text the
     Add button writes, which is what the suggestion is built from. */
  const booked = new Set(
    (reminders || [])
      .filter((rem) => occursOn(rem, key))
      .map((rem) =>
        String(rem.text || '')
          .trim()
          .toLowerCase()
      )
  );
  const unbooked = (item) => !booked.has(item.text.trim().toLowerCase());

  // Filter before the fallback, not after: with every real suggestion already
  // past, the evening default is still worth offering — but only if it is
  // itself still ahead.
  let live = items.filter((i) => stillToCome(i) && unbooked(i));
  if (!live.length) {
    live = [
      { icon: 'sparkles', text: 'Review tomorrow plan', time: '20:30', tag: 'personal' },
    ].filter((i) => stillToCome(i) && unbooked(i));
  }
  // Nothing left to suggest today. The renderer drops a widget that returns
  // nothing, so the card disappears rather than sitting there empty.
  if (!live.length) return null;
  return Card({
    className: 'gb-suggest-card',
    children: [
      h(
        'div',
        { class: 'gb-card-titleline' },
        Icon('bell-plus', { size: 18, sw: 2.4 }),
        'Smart reminders'
      ),
      h(
        'div',
        { class: 'gb-suggest-list' },
        live.slice(0, 3).map((item) =>
          h(
            'div',
            { class: 'gb-suggest-row' },
            h('span', { class: 'gb-suggest-icon' }, Icon(item.icon, { size: 16, sw: 2.4 })),
            h(
              'span',
              { class: 'gb-suggest-copy' },
              h('strong', null, item.text),
              h('small', null, sharedFormatTime(item.time))
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--soft gb-btn--compact',
                // Up to three of these sit in a column; out of the row's context
                // a screen reader heard "Add reminder" three times over.
                'aria-label': 'Add reminder: ' + item.text + ', ' + sharedFormatTime(item.time),
                onclick: () =>
                  onAddSuggestedReminder && onAddSuggestedReminder(item.text, item.time, item.tag),
              },
              'Add reminder'
            )
          )
        )
      ),
    ],
  });
}

function GoalTimelineCard({ goals }) {
  const actions = allGoals(goals)
    .flatMap((goal) =>
      (goal.recentActions || []).map((action) => ({
        goal: goal.title,
        note: action.note,
        date: action.actionDate || String(action.createdAt || '').slice(0, 10),
      }))
    )
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 4);
  return Card({
    className: 'gb-timeline-card',
    children: [
      h(
        'div',
        { class: 'gb-card-titleline' },
        Icon('route', { size: 18, sw: 2.4 }),
        'Goal timeline'
      ),
      actions.length
        ? h(
            'div',
            { class: 'gb-timeline-list' },
            actions.map((action) =>
              h(
                'div',
                { class: 'gb-timeline-row' },
                h('span', { class: 'gb-timeline-dot' }),
                h(
                  'span',
                  { class: 'gb-timeline-copy' },
                  h('strong', null, action.note),
                  h('small', null, action.goal + ' - ' + (action.date || 'Today'))
                )
              )
            )
          )
        : h(
            'div',
            { class: 'gb-empty-slim' },
            'Log an action on the Goals tab and your timeline starts here.'
          ),
    ],
  });
}

function WaterCard({ water, onQuickAddWater, onUpdateWaterGoal, onDeleteWater }) {
  const goalMl = Math.max(1, (water && water.goalMl) || 2000);
  const consumedMl = Math.max(0, (water && water.consumedMl) || 0);
  const remainingMl = Math.max(0, goalMl - consumedMl);
  const entries = (water && water.entries) || [];
  const pctRaw = Math.round((consumedMl / goalMl) * 100);
  const pct = Math.max(0, Math.min(100, pctRaw));

  const quotesLow = [
    'Every sip is a vote for your future energy.',
    'Hydration first. Momentum second. Greatness next.',
    'Drink now, thank yourself in an hour.',
    'Tiny sips create big focus.',
    'Your brain loves water more than excuses.',
  ];
  const quotesMid = [
    'Nice pace. Keep the flow going.',
    'You are building consistency, one glass at a time.',
    'Halfway hydrated is halfway heroic.',
    'Keep pouring into yourself.',
    'Steady hydration, steady mind.',
  ];
  const quotesHigh = [
    'You are glowing. Keep cruising.',
    'Hydration champion mode unlocked.',
    'Your body is already saying thank you.',
    'This is what disciplined self-care looks like.',
    'You are finishing strong.',
  ];

  const pool = pct < 40 ? quotesLow : pct < 85 ? quotesMid : quotesHigh;
  const quoteIdx = Math.floor(consumedMl / 100 + entries.length) % pool.length;
  const quote = pool[quoteIdx];
  const fishCount = Math.max(1, Math.min(8, Math.floor(pct / 15) + 1));
  const fishPalette = ['sun', 'leaf', 'bloom', 'sky'];
  const fishNodes = Array.from({ length: fishCount }, (_, i) => {
    const left = 8 + ((i * 11) % 52);
    const bottom = 10 + ((i * 13) % 66);
    const size = 10 + (i % 3) * 3;
    const delay = (i % 5) * 0.55;
    const dur = 5.8 + (i % 4) * 1.1;
    const tint = fishPalette[i % fishPalette.length];
    return h('span', {
      class: 'gb-water-fish f' + ((i % 3) + 1),
      style: {
        '--fish-left': left + 'px',
        '--fish-bottom': bottom + 'px',
        '--fish-size': size + 'px',
        '--fish-delay': delay + 's',
        '--fish-duration': dur + 's',
        '--fish-hue': tint,
      },
    });
  });

  const lastThree = entries.slice(-3).reverse();
  const latestAt = entries.length ? entries[entries.length - 1].loggedAt : null;
  const isPouring = !!latestAt && Date.now() - new Date(latestAt).getTime() < 2400;

  function timeLabel(iso) {
    if (!iso) return 'Now';
    try {
      return sharedFormatTime(iso);
    } catch (_) {
      return 'Now';
    }
  }

  function openNumericPrompt(opts) {
    const cfg = Object.assign(
      {
        title: 'Enter value',
        label: 'Value',
        initialValue: '',
        min: 1,
        max: 100,
        confirmLabel: 'Save',
        onConfirm: null,
      },
      opts || {}
    );

    const { sheet, close } = openOverlay({ label: cfg.title });
    const input = h('input', {
      type: 'number',
      class: 'gb-input',
      min: String(cfg.min),
      max: String(cfg.max),
      step: '1',
      value: String(cfg.initialValue || ''),
    });
    const error = h('div', { class: 'gb-water-prompt-error', 'aria-live': 'polite' });

    function showError(msg) {
      error.textContent = msg || '';
    }

    // Escape and the backdrop are the shared overlay's job. Enter belongs to the
    // field, not the document — it only ever meant "submit this one input".
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    function submit() {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < cfg.min || value > cfg.max) {
        showError('Enter a value between ' + cfg.min + ' and ' + cfg.max + '.');
        input.focus();
        return;
      }
      if (typeof cfg.onConfirm === 'function') {
        cfg.onConfirm(Math.round(value));
      }
      close();
    }

    sheet.append(
      h('div', { class: 'gb-modal-head' }, h('div', { class: 'gb-modal-title' }, cfg.title)),
      h(
        'div',
        { class: 'gb-modal-body' },
        h(
          'div',
          { class: 'gb-form' },
          h('div', { class: 'gb-field-label' }, cfg.label),
          input,
          error
        )
      ),
      h(
        'div',
        { class: 'gb-water-prompt-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--ghost',
            onclick: close,
          },
          'Cancel'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--primary',
            onclick: submit,
          },
          cfg.confirmLabel
        )
      )
    );
    setTimeout(() => {
      input.focus();
      input.select();
    }, 60);
  }

  function addCustomAmount() {
    if (!onQuickAddWater) return;
    openNumericPrompt({
      title: 'Add custom water',
      label: 'Amount (ml)',
      initialValue: 300,
      min: 1,
      max: 5000,
      confirmLabel: 'Add water',
      onConfirm: (amount) => onQuickAddWater(amount),
    });
  }

  function setGoalAmount() {
    if (!onUpdateWaterGoal) return;
    openNumericPrompt({
      title: 'Set daily water goal',
      label: 'Goal (ml/day)',
      initialValue: goalMl,
      min: 1000,
      max: 7000,
      confirmLabel: 'Save goal',
      onConfirm: (amount) => onUpdateWaterGoal(amount),
    });
  }

  return Card({
    className: 'gb-water-card' + (pct >= 100 ? ' is-goal' : ''),
    children: [
      h(
        'div',
        { class: 'gb-water-head' },
        h(
          'div',
          null,
          h('div', { class: 'gb-water-title' }, 'Water tracker'),
          h('div', { class: 'gb-water-meta' }, consumedMl + ' ml / ' + goalMl + ' ml')
        ),
        h('div', { class: 'gb-water-chip' }, pct + '%')
      ),

      h(
        'div',
        { class: 'gb-water-visual' },
        h(
          'div',
          { class: 'gb-water-glass' },
          h('div', { class: 'gb-water-pour' + (isPouring ? ' is-active' : '') }),
          h(
            'div',
            { class: 'gb-water-fill', style: { height: pct + '%' } },
            h('span', { class: 'gb-water-bubble b1' }),
            h('span', { class: 'gb-water-bubble b2' }),
            h('span', { class: 'gb-water-bubble b3' }),
            fishNodes
          )
        ),
        h(
          'div',
          { class: 'gb-water-stats' },
          h('div', { class: 'gb-water-big' }, remainingMl + ' ml'),
          h(
            'div',
            { class: 'gb-water-sub' },
            remainingMl > 0 ? 'to hit your goal' : 'goal reached, amazing'
          ),
          h('p', { class: 'gb-water-quote' }, '"' + quote + '"')
        )
      ),

      h(
        'div',
        { class: 'gb-water-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'gb-water-add',
            'aria-label': 'Add 250 millilitres of water',
            onclick: () => onQuickAddWater && onQuickAddWater(250),
          },
          '+250 ml'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-water-add',
            'aria-label': 'Add 500 millilitres of water',
            onclick: () => onQuickAddWater && onQuickAddWater(500),
          },
          '+500 ml'
        ),
        h(
          'button',
          {
            type: 'button',
            // One style for all three: a gradient on the largest read as a different
            // kind of button.
            class: 'gb-water-add',
            'aria-label': 'Add 750 millilitres of water',
            onclick: () => onQuickAddWater && onQuickAddWater(750),
          },
          '+750 ml'
        )
      ),

      h(
        'div',
        { class: 'gb-water-actions gb-water-actions--custom' },
        h(
          'button',
          {
            type: 'button',
            class: 'gb-water-add gb-water-add--custom',
            onclick: addCustomAmount,
          },
          'Custom…'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-water-add gb-water-add--custom',
            onclick: setGoalAmount,
          },
          'Set daily goal'
        )
      ),

      lastThree.length
        ? h(
            'div',
            { class: 'gb-water-log' },
            lastThree.map((item) =>
              h(
                'div',
                { class: 'gb-water-log-row' },
                h(
                  'div',
                  { style: { flex: 1 } },
                  h('span', null, (item.amountMl || 0) + ' ml'),
                  h(
                    'span',
                    { style: { marginLeft: '8px', fontSize: '0.75rem', color: 'var(--fg3)' } },
                    timeLabel(item.loggedAt)
                  )
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-btn gb-btn--icon',
                    onclick: () => onDeleteWater && onDeleteWater(item.id),
                    title: 'Delete',
                    'aria-label': 'Delete water entry',
                  },
                  Icon('x', { size: 16, sw: 2.4 })
                )
              )
            )
          )
        : null,
    ],
  });
}

function FoodCard({ food, onAddFood, onDeleteFood }) {
  const total = Math.max(0, (food && food.totalCalories) || 0);
  const entries = (food && food.entries) || [];
  const recent = entries.slice(0, 5);

  return Card({
    className: 'gb-food-card',
    children: [
      h(
        'div',
        { class: 'gb-water-head' },
        h(
          'div',
          null,
          h('div', { class: 'gb-water-title' }, 'Food calories'),
          h('div', { class: 'gb-water-meta' }, 'Track meals with Indian average estimates')
        ),
        h('div', { class: 'gb-food-total' }, total + ' kcal')
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-water-add gb-food-add',
          onclick: () => onAddFood && onAddFood(),
        },
        'Log food'
      ),
      recent.length
        ? h(
            'div',
            { class: 'gb-water-log' },
            recent.map((item) =>
              h(
                'div',
                { class: 'gb-water-log-row' },
                h(
                  'div',
                  { style: { flex: 1 } },
                  h('span', null, item.foodName + ' (' + item.quantityGrams + 'g)'),
                  h('span', { style: { marginLeft: '8px' } }, item.kcalEstimated + ' kcal')
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-btn gb-btn--icon',
                    onclick: () => onDeleteFood && onDeleteFood(item.id),
                    title: 'Delete',
                    'aria-label': 'Delete food entry',
                  },
                  Icon('x', { size: 16, sw: 2.4 })
                )
              )
            )
          )
        : h(
            'p',
            { class: 'gb-water-quote', style: { marginTop: '8px' } },
            'No food logged yet today.'
          ),
    ],
  });
}

/* ---- Food summary screen (SCREENS.summary) ----
   Nutrition as a thali: four katoris (protein, carbs, fat, fiber) round a plate,
   each ring filled toward its daily target, calories in the middle. Then the
   calorie split, a day-by-day chart per nutrient with the dishes behind it,
   water as tumblers, and Buddy's diet check. Every gram is estimated on the
   server (FoodWeek), and so are the averages and low/ok/high levels, so the
   headline and Buddy's pills agree. The check is an AI call: it runs on a tap,
   and app.js drops it whenever an entry changes. */
const LEVEL_TEXT = { low: 'low', ok: 'good', high: 'high' };
const NUTRIENTS = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
  { key: 'fiber', label: 'Fiber' },
];
// Protein and fiber can't really be too high here; carbs and fat can.
const isGood = (key, v) => v === 'ok' || (v === 'high' && (key === 'protein' || key === 'fiber'));
// The Day by day tab, kept across repaints (a diet check result repaints the screen).
let summaryNutrient = 'protein';

// Flips the Day by day card to one nutrient in place. From a bowl, a calorie
// share or one of Buddy's pills it also brings the card into view, so the tap
// lands on that nutrient's days and the dishes behind them.
function showNutrient(key, reveal) {
  summaryNutrient = key;
  const card = document.querySelector('.gb-daybyday');
  if (!card) return;
  card.querySelectorAll('[data-nutrient]').forEach((el) => {
    const on = el.dataset.nutrient === key;
    if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', String(on));
    else el.hidden = !on;
  });
  if (!reveal) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  const tab = card.querySelector('button[aria-pressed="true"]');
  if (tab) tab.focus({ preventScroll: true });
}

function dayLabel(date, isToday) {
  return isToday
    ? 'Today'
    : new Date(date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' });
}

function FoodSummaryLink({ onOpen }) {
  return Card({
    className: 'gb-food-week-card',
    children: [
      h(
        'div',
        { class: 'gb-water-head' },
        h(
          'div',
          null,
          h('div', { class: 'gb-water-title' }, 'Summary'),
          h('div', { class: 'gb-water-meta' }, 'Nutrition, water and calories for the last 7 days')
        )
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-food-check-btn',
          onclick: () => onOpen && onOpen(),
        },
        Icon('chart-column', { size: 16, sw: 2.4 }),
        'Open summary'
      ),
    ],
  });
}

function summaryHead(title, meta) {
  return h(
    'div',
    { class: 'gb-summary-card-head' },
    h('h2', null, title),
    meta ? h('span', null, meta) : null
  );
}

// Geometry in % of the plate, so it shrinks on a narrow phone instead of
// overflowing: bowls 26.9% wide on the diagonals, 32.5% from the centre.
function NutrientThali(week) {
  const avg = week.averages;
  const tgt = week.targets;
  const angles = [-135, -45, 135, 45];
  return h(
    'figure',
    { class: 'gb-thali-fig' },
    h(
      'div',
      { class: 'gb-thali' },
      h(
        'div',
        { class: 'gb-thali-center' },
        h('span', { class: 'gb-thali-total' }, week.avgKcal.toLocaleString()),
        h('span', { class: 'gb-thali-unit' }, 'kcal a day'),
        h('span', { class: 'gb-thali-of' }, 'goal ' + week.goalKcal.toLocaleString())
      ),
      NUTRIENTS.map((n, i) => {
        const a = (angles[i] * Math.PI) / 180;
        const v = avg[n.key + 'G'];
        const t = Math.max(1, tgt[n.key + 'G']);
        return h(
          'button',
          {
            type: 'button',
            class: 'gb-katori is-' + n.key,
            'aria-label':
              n.label + ': ' + v + ' grams a day, target ' + t + ' grams. Show day by day',
            onclick: () => showNutrient(n.key, true),
            style: {
              left: 50 + 32.5 * Math.cos(a) - 13.4375 + '%',
              top: 50 + 32.5 * Math.sin(a) - 13.4375 + '%',
              '--pct': Math.min(100, Math.round((v / t) * 100)) + '%',
            },
          },
          h(
            'div',
            { class: 'gb-katori-in', 'aria-hidden': 'true' },
            h('strong', null, String(v), h('small', null, 'g')),
            h('span', null, n.label.toUpperCase())
          )
        );
      })
    ),
    h(
      'figcaption',
      { class: 'gb-thali-legend' },
      'A full ring is your daily target. Today counts only when it is all you have logged.'
    )
  );
}

function CalorieSplit(week) {
  const a = week.averages;
  const kcal = [a.proteinG * 4, a.carbsG * 4, a.fatG * 9];
  const total = kcal[0] + kcal[1] + kcal[2];
  if (!total) return null;
  const goal = Math.max(1, week.goalKcal);
  const share = kcal.map((k) => Math.round((k / total) * 100));
  // The aims are FoodWeek.targets' split: protein from the gram target, 50 / 30 for the rest.
  const aims = [Math.round(((week.targets.proteinG * 4) / goal) * 100), 50, 30];
  const parts = NUTRIENTS.slice(0, 3);
  return Card({
    className: 'gb-food-week-card gb-summary-card',
    children: [
      summaryHead('Where your calories come from'),
      h(
        'div',
        {
          class: 'gb-split-bar',
          role: 'img',
          'aria-label':
            parts.map((n, i) => n.label + ' ' + share[i] + ' percent').join(', ') + ' of calories',
        },
        parts.map((n, i) =>
          h('div', { class: 'is-' + n.key, style: { flexGrow: String(kcal[i]) } })
        )
      ),
      h(
        'div',
        { class: 'gb-split-legend' },
        parts.map((n, i) =>
          h(
            'button',
            { type: 'button', class: 'is-' + n.key, onclick: () => showNutrient(n.key, true) },
            h('span', null, n.label),
            h('b', null, share[i] + '%'),
            h('small', null, 'aim ' + aims[i] + '%')
          )
        )
      ),
    ],
  });
}

function NutrientPanel(week, n, onOpenDay) {
  const days = week.days || [];
  const key = n.key + 'G';
  const target = Math.max(1, week.targets[key]);
  const top = Math.max(target * 1.25, ...days.map((d) => d[key]));
  const last = days.length - 1;
  const hits = days.filter((d) => d.count > 0 && d[key] >= target).length;
  const sources = (week.sourcesBy && week.sourcesBy[n.key]) || [];
  const most = Math.max(1, sources.length ? sources[0].g : 1);
  const limit = n.key === 'carbs' || n.key === 'fat';
  return h(
    'div',
    {
      class: 'gb-nutrient-panel is-' + n.key,
      'data-nutrient': n.key,
      hidden: n.key !== summaryNutrient,
    },
    h(
      'p',
      { class: 'gb-summary-meta' },
      n.label +
        ': ' +
        week.averages[key] +
        ' g a day, target ' +
        target +
        ' g. ' +
        (limit ? 'Over target' : 'Target reached') +
        ' on ' +
        hits +
        ' of 7 days.'
    ),
    h(
      'div',
      {
        class: 'gb-food-week-bars',
        role: 'group',
        'aria-label': n.label + ' each day this week, in grams',
      },
      h('div', {
        class: 'gb-food-week-goal',
        // A share of the track, not of the box: the box also holds the 18px value
        // row above and the 22px day row below (.gb-food-week-bars padding).
        style: { bottom: 'calc(22px + (100% - 40px) * ' + (target / top).toFixed(4) + ')' },
      }),
      days.map((d, i) =>
        h(
          'button',
          {
            type: 'button',
            class: 'gb-food-week-col' + (i === last ? ' is-today' : ''),
            'aria-label':
              dayLabel(d.date, i === last) +
              ': ' +
              (d.count ? d[key] + ' grams' : 'nothing logged') +
              '. Open this day',
            onclick: () => onOpenDay && onOpenDay(d.date),
          },
          h('span', { class: 'gb-food-week-val', 'aria-hidden': 'true' }, d.count ? d[key] : ''),
          h(
            'div',
            { class: 'gb-food-week-track', 'aria-hidden': 'true' },
            h('div', {
              class: 'gb-food-week-bar',
              style: { height: d.count ? Math.max(4, (d[key] / top) * 100) + '%' : '0' },
            })
          ),
          h(
            'span',
            { class: 'gb-food-week-day', 'aria-hidden': 'true' },
            dayLabel(d.date, i === last)
          )
        )
      )
    ),
    sources.length
      ? h(
          'div',
          { class: 'gb-nutrient-sources' },
          h(
            'span',
            { class: 'gb-nutrient-sources-title' },
            'Most ' + n.label.toLowerCase() + ' came from'
          ),
          sources.map((s) =>
            h(
              'div',
              { class: 'gb-source-row' },
              h(
                'div',
                { class: 'gb-source-head' },
                h(
                  'span',
                  null,
                  s.name,
                  h('small', null, ' · ' + (s.count === 1 ? 'once' : s.count + ' times'))
                ),
                h('b', null, s.g + ' g')
              ),
              h(
                'div',
                { class: 'gb-source-track' },
                h('div', {
                  class: 'gb-source-bar',
                  style: { width: Math.round((s.g / most) * 100) + '%' },
                })
              )
            )
          )
        )
      : null
  );
}

// The tabs flip panels in place rather than repainting the whole screen.
function DayByDayCard(week, onOpenDay) {
  return Card({
    className: 'gb-food-week-card gb-summary-card gb-daybyday',
    children: [
      summaryHead('Day by day'),
      h(
        'div',
        { class: 'gb-nutrient-tabs', role: 'group', 'aria-label': 'Nutrient to show' },
        NUTRIENTS.map((n) =>
          h(
            'button',
            {
              type: 'button',
              class: 'is-' + n.key,
              'data-nutrient': n.key,
              'aria-pressed': String(n.key === summaryNutrient),
              onclick: () => showNutrient(n.key),
            },
            n.label
          )
        )
      ),
      NUTRIENTS.map((n) => NutrientPanel(week, n, onOpenDay)),
      h('p', { class: 'gb-summary-hint' }, 'Tap a day to see what you ate.'),
    ],
  });
}

function WaterWeekCard(water, onOpenDay) {
  const goal = Math.max(1, water.goalMl || 2000);
  const days = water.days || [];
  const last = days.length - 1;
  const done = days.slice(0, -1);
  const avg = done.length ? done.reduce((s, d) => s + d.ml, 0) / done.length : 0;
  const hits = days.filter((d) => d.ml >= goal).length;
  const litres = (ml) => (ml / 1000).toFixed(1);
  return Card({
    className: 'gb-food-week-card gb-summary-card',
    children: [
      summaryHead('Water', 'goal ' + litres(goal) + ' L'),
      h(
        'p',
        { class: 'gb-summary-meta' },
        litres(avg) + ' L a day on average. Goal reached on ' + hits + ' of 7 days.'
      ),
      h(
        'figure',
        { class: 'gb-tumblers', role: 'group', 'aria-label': 'Water each day this week' },
        days.map((d, i) =>
          h(
            'button',
            {
              type: 'button',
              class: 'gb-tumbler-col' + (i === last ? ' is-today' : ''),
              'aria-label':
                dayLabel(d.date, i === last) + ': ' + d.ml + ' ml of water. Open this day',
              onclick: () => onOpenDay && onOpenDay(d.date),
            },
            h('small', { 'aria-hidden': 'true' }, litres(d.ml)),
            h(
              'div',
              { class: 'gb-tumbler' + (d.ml >= goal ? ' is-full' : ''), 'aria-hidden': 'true' },
              h('div', {
                class: 'gb-tumbler-fill',
                style: { height: Math.min(100, Math.round((d.ml / goal) * 100)) + '%' },
              })
            ),
            h(
              'span',
              { class: 'gb-tumbler-day', 'aria-hidden': 'true' },
              dayLabel(d.date, i === last)
            )
          )
        )
      ),
    ],
  });
}

function DietCheckCard({ check, canCheck, onCheck }) {
  const st = check || {};
  const level = (n, v) =>
    h(
      'button',
      {
        type: 'button',
        class: 'gb-food-level' + (isGood(n.key, v) ? ' is-good' : ''),
        onclick: () => showNutrient(n.key, true),
      },
      n.label + ' · ' + (LEVEL_TEXT[v] || '-')
    );
  let body = null;
  if (st.loading) {
    body = Thinking('Buddy is reading your week', [
      'Reading the dishes you logged',
      'Weighing protein, carbs, fat and fiber',
      'Writing your tips',
    ]);
  } else if (st.error) {
    body = h('p', { class: 'gb-summary-meta' }, st.error);
  } else if (st.data) {
    const r = st.data;
    body = h(
      'div',
      { class: 'gb-food-check' },
      r.protein
        ? h(
            'div',
            { class: 'gb-food-levels' },
            NUTRIENTS.map((n) => level(n, r[n.key]))
          )
        : null,
      h('p', { class: 'gb-food-check-text' }, r.summary),
      r.add && r.add.length
        ? h(
            'ul',
            { class: 'gb-food-check-add' },
            r.add.map((x) => h('li', null, x))
          )
        : null,
      // The AI couldn't answer, so this is the built-in read. Say so, quietly:
      // the stock tips otherwise pass for Buddy's own.
      r.source === 'rules' && r.protein
        ? h(
            'p',
            { class: 'gb-summary-hint' },
            "Standard tips for now. Buddy's own read is unavailable."
          )
        : null
    );
  } else {
    body = h(
      'p',
      { class: 'gb-summary-meta' },
      'Buddy reads the dishes you logged this week and tells you how to close the gaps.'
    );
  }
  return Card({
    className: 'gb-food-week-card gb-summary-card gb-summary-buddy',
    children: [
      h(
        'div',
        { class: 'gb-buddy-eyebrow' },
        Icon('sparkles', { size: 16, sw: 2.4 }),
        "Buddy's read on your week"
      ),
      body,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-food-check-btn' + (st.loading ? ' is-thinking' : ''),
          disabled: !!st.loading || !canCheck,
          onclick: () => onCheck && onCheck(),
        },
        st.loading
          ? thinkingLabel('Reading your week')
          : st.data || st.error
            ? 'Check again'
            : 'Check my week'
      ),
    ],
  });
}

function ScreenSummary({
  features,
  week,
  water,
  check,
  error,
  hasWeight,
  onCheck,
  onRetry,
  onBack,
  onOpenDay,
}) {
  const on = (k) => !features || features[k] !== false;
  const back = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--ghost gb-btn--compact gb-summary-back',
      onclick: onBack,
    },
    Icon('chevron-left', { size: 16, sw: 2.6 }),
    'Food'
  );
  const wrap = (...kids) => h('div', { class: 'gb-rise gb-summary-page' }, back, ...kids);
  if (error) {
    return wrap(
      Card({
        className: 'gb-food-week-card gb-summary-card',
        children: [
          h('p', { class: 'gb-summary-meta' }, error),
          h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--soft gb-food-check-btn', onclick: onRetry },
            'Try again'
          ),
        ],
      })
    );
  }
  if ((on('food') && !week) || (on('water') && !water)) {
    return wrap(
      Thinking('Loading your week', [
        'Gathering your meals',
        'Adding up each day',
        'Filling in your water',
      ])
    );
  }

  const days = (week && week.days) || [];
  const logged = days.filter((d) => d.count > 0);
  const range = (water && water.days) || days;
  const fmt = (k) =>
    new Date(k + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const food = on('food') && logged.length > 0;
  const lv = (week && week.levels) || {};
  const short = NUTRIENTS.filter((n) => lv[n.key] === 'low');
  const heavy = NUTRIENTS.filter((n) => lv[n.key] === 'high' && !isGood(n.key, 'high'));
  // "protein and fiber." with each name in its own colour, the full stop inside the last.
  const named = (list) =>
    list.flatMap((n, i) => [
      i === 0 ? '' : i === list.length - 1 ? ' and ' : ', ',
      h('em', { class: 'is-' + n.key }, n.label.toLowerCase() + (i === list.length - 1 ? '.' : '')),
    ]);
  let headline;
  // Calories lead: the ring under the headline shows them, so "on target" can't
  // sit above a plate nearly double its goal.
  if (!food) headline = ['Your week shows up here as you log it.'];
  else if (lv.calories === 'high') headline = ['Your plate is over your calorie goal.'];
  else if (short.length) headline = ['Your plate is short on ', ...named(short)];
  else if (heavy.length) headline = ['Your plate is heavy on ', ...named(heavy)];
  else if (lv.calories === 'low') headline = ['Your plate is under your calorie goal.'];
  else headline = ['Your plate is close to target on calories and all four.'];

  const hero = h(
    'section',
    { class: 'gb-summary-hero' },
    range.length
      ? h(
          'span',
          { class: 'gb-summary-eyebrow' },
          fmt(range[0].date) + ' – ' + fmt(range[range.length - 1].date) + ' · daily average'
        )
      : null,
    // h2: the header's "Summary" is the screen's h1.
    h('h2', null, ...headline),
    food
      ? h(
          'p',
          { class: 'gb-summary-sub' },
          (short.length || lv.calories === 'high') && heavy.length
            ? 'And heavy on ' + heavy.map((n) => n.label.toLowerCase()).join(' and ') + '. '
            : '',
          'Targets come from your calorie goal' +
            (hasWeight
              ? ' and weight.'
              : '. Add your weight in Settings for a protein target that fits you.')
        )
      : null
  );

  return wrap(
    h(
      'div',
      { class: 'gb-summary-grid' },
      h(
        'div',
        { class: 'gb-summary-col' },
        hero,
        food ? NutrientThali(week) : null,
        food ? CalorieSplit(week) : null
      ),
      h(
        'div',
        { class: 'gb-summary-col' },
        food ? DayByDayCard(week, onOpenDay) : null,
        on('water') ? WaterWeekCard(water, onOpenDay) : null,
        on('food') ? DietCheckCard({ check, canCheck: logged.length > 0, onCheck }) : null,
        on('food')
          ? h(
              'p',
              { class: 'gb-summary-note' },
              'Nutrients are estimated from the dishes you log, using Indian home and hotel averages. Read them as a direction, not a lab result.'
            )
          : null
      )
    )
  );
}

function HabitStrip({ habits, onAdd, toggleHabit }) {
  if (!habits.length) {
    return Card({
      children: [
        h(
          'div',
          { class: 'gb-empty' },
          Icon('repeat', { size: 26, color: 'var(--brand-soft-fg)' }),
          h('p', null, 'No habits yet. Pick one to build a streak.'),
          h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--soft', onclick: onAdd },
            Icon('plus', { size: 16, sw: 2.6 }),
            'Add a habit'
          )
        ),
      ],
    });
  }
  return h(
    'div',
    { class: 'gb-habit-strip' },
    // All of them. The old slice(0, 4) meant a fifth habit simply didn't exist
    // on Home — not scrolled off, not rendered.
    habits.map((h2) => HabitCard(h2, toggleHabit))
  );
}

/* ---- Mini Calendar Card ---- */
function MiniCalendarCard({
  tasks,
  reminders,
  foodSummary,
  dayFoodLoading,
  dayFoodError,
  calYear,
  calMonth,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  onRetryFood,
}) {
  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }
  function dateKey(y, m, d) {
    return y + '-' + pad(m + 1) + '-' + pad(d);
  }
  function parseKey(key) {
    const bits = String(key || '')
      .split('-')
      .map(Number);
    return { y: bits[0], m: bits[1] - 1, d: bits[2] };
  }
  function todayKey() {
    const t = new Date();
    return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function prettyDate(key) {
    const p = parseKey(key);
    const dt = new Date(p.y, p.m, p.d);
    return DOW[dt.getDay()] + ', ' + MONTHS[p.m] + ' ' + p.d;
  }
  const formatTime = (value) => sharedFormatTime(value, 'Any time');
  function prettyTaskTime(iso) {
    if (!iso) return 'No due time';
    try {
      return sharedFormatTime(iso, 'Due');
    } catch (_) {
      return 'Due';
    }
  }
  function keyFromInstant(iso) {
    if (!iso) return '';
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return '';
    return dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }
  function dueTasksOn(key) {
    return (tasks || [])
      .filter((t) => keyFromInstant(t.dueAt) === key)
      .sort((a, b) => String(a.dueAt || '').localeCompare(String(b.dueAt || '')));
  }
  function completedTasksOn(key) {
    return (tasks || [])
      .filter((t) => !!t.done && keyFromInstant(t.doneAt) === key)
      .sort((a, b) => String(a.doneAt || '').localeCompare(String(b.doneAt || '')));
  }
  function remindersOn(key) {
    return (reminders || [])
      .filter((rem) => occursOn(rem, key))
      .sort((a, b) => String(a.time || '99:99').localeCompare(String(b.time || '99:99')));
  }

  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const today = todayKey();
  const selectedDueTasks = dueTasksOn(selectedDate);
  const selectedCompletedTasks = completedTasksOn(selectedDate);
  const selectedReminders = remindersOn(selectedDate);
  const selectedFood = foodSummary && Array.isArray(foodSummary.entries) ? foodSummary.entries : [];

  const dowRow = h(
    'div',
    { class: 'gb-mini-cal-dow' },
    DOW.map((d) => h('span', { class: 'gb-mini-cal-dow-cell' }, d[0]))
  );

  const cells = [];
  const startDay = 1 - firstDow;
  for (let i = 0; i < 42; i++) {
    const dt = new Date(calYear, calMonth, startDay + i);
    const key = dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const inMonth = dt.getFullYear() === calYear && dt.getMonth() === calMonth;
    const taskCount = dueTasksOn(key).length + completedTasksOn(key).length;
    const reminderCount = remindersOn(key).length;
    const total = taskCount + reminderCount;
    const isFree = total === 0 && key >= today;
    const cls =
      'gb-mini-cal-day' +
      (inMonth ? '' : ' is-other-month') +
      (key === today ? ' is-today' : '') +
      (key === selectedDate ? ' is-selected' : '') +
      (taskCount ? ' has-tasks' : '') +
      (reminderCount ? ' has-reminders' : '') +
      (isFree ? ' is-free' : '');

    cells.push(
      h(
        'button',
        {
          type: 'button',
          class: cls,
          'aria-label': prettyDate(key) + ', ' + (total ? plural(total, 'item') : 'free'),
          onclick: () => onSelectDate(key),
        },
        h('span', { class: 'num' }, String(dt.getDate())),
        total ? h('span', { class: 'badge' }, String(total)) : null
      )
    );
  }

  function daySection(title, count, items, emptyText) {
    return h(
      'div',
      { class: 'gb-mini-cal-section' },
      h(
        'div',
        { class: 'gb-mini-cal-section-head' },
        h('span', { class: 'gb-mini-cal-section-title' }, title),
        h('span', { class: 'gb-mini-cal-section-count' }, String(count))
      ),
      items,
      !count ? h('div', { class: 'gb-mini-cal-empty' }, emptyText) : null
    );
  }

  let foodContent = null;
  if (dayFoodLoading && !selectedFood.length) {
    foodContent = h(
      'div',
      { class: 'gb-mini-cal-empty gb-mini-cal-empty--loading' },
      h('span', { class: 'gb-spinner', 'aria-hidden': 'true' }),
      h('span', null, 'Loading food entries…')
    );
  } else if (dayFoodError && !selectedFood.length) {
    foodContent = h(
      'div',
      { class: 'gb-mini-cal-empty gb-mini-cal-empty--error' },
      h('div', null, dayFoodError),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--secondary gb-mini-cal-retry',
          onclick: () => onRetryFood && onRetryFood(selectedDate),
        },
        'Retry'
      )
    );
  } else if (selectedFood.length) {
    foodContent = h(
      'div',
      { class: 'gb-mini-cal-items' },
      selectedFood.map((item) =>
        h(
          'div',
          { class: 'gb-mini-cal-item' },
          h(
            'div',
            { class: 'gb-mini-cal-item-main' },
            h('div', { class: 'gb-mini-cal-item-title' }, item.foodName),
            h(
              'div',
              { class: 'gb-mini-cal-item-sub' },
              item.quantityGrams + 'g · ' + item.kcalEstimated + ' kcal'
            )
          ),
          h('span', { class: 'gb-mini-cal-pill' }, item.mealType || 'meal')
        )
      )
    );
  }

  return Card({
    className: 'gb-mini-cal-card',
    children: [
      h(
        'div',
        { class: 'gb-mini-cal-header' },
        h(
          'button',
          {
            type: 'button',
            class: 'gb-mini-cal-nav-btn',
            onclick: onPrevMonth,
            title: 'Previous month',
            'aria-label': 'Previous month',
          },
          Icon('chevron-left', { size: 16 })
        ),
        h('span', { class: 'gb-mini-cal-month' }, MONTHS[calMonth] + ' ' + calYear),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-mini-cal-nav-btn',
            onclick: onNextMonth,
            title: 'Next month',
            'aria-label': 'Next month',
          },
          Icon('chevron-right', { size: 16 })
        )
      ),
      dowRow,
      h('div', { class: 'gb-mini-cal-grid' }, cells),
      h(
        'div',
        { class: 'gb-mini-cal-legend' },
        h(
          'span',
          { class: 'gb-mini-cal-legend-item' },
          h('span', { class: 'dot has-tasks' }),
          'Tasks'
        ),
        h(
          'span',
          { class: 'gb-mini-cal-legend-item' },
          h('span', { class: 'dot has-reminders' }),
          'Reminders'
        ),
        h('span', { class: 'gb-mini-cal-legend-item' }, h('span', { class: 'dot is-free' }), 'Free')
      ),
      h('div', { class: 'gb-mini-cal-day-title' }, prettyDate(selectedDate)),
      daySection(
        'Tasks due',
        selectedDueTasks.length,
        selectedDueTasks.length
          ? h(
              'div',
              { class: 'gb-mini-cal-items' },
              selectedDueTasks.map((t) =>
                h(
                  'div',
                  { class: 'gb-mini-cal-item' },
                  h(
                    'div',
                    { class: 'gb-mini-cal-item-main' },
                    h('div', { class: 'gb-mini-cal-item-title' }, t.title),
                    h('div', { class: 'gb-mini-cal-item-sub' }, prettyTaskTime(t.dueAt))
                  ),
                  t.done ? h('span', { class: 'gb-mini-cal-pill is-done' }, 'Done') : null
                )
              )
            )
          : null,
        'No tasks due on this day.'
      ),
      daySection(
        'Tasks completed',
        selectedCompletedTasks.length,
        selectedCompletedTasks.length
          ? h(
              'div',
              { class: 'gb-mini-cal-items' },
              selectedCompletedTasks.map((t) =>
                h(
                  'div',
                  { class: 'gb-mini-cal-item is-done' },
                  h(
                    'div',
                    { class: 'gb-mini-cal-item-main' },
                    h('div', { class: 'gb-mini-cal-item-title' }, t.title),
                    h(
                      'div',
                      { class: 'gb-mini-cal-item-sub' },
                      'Completed ' + prettyTaskTime(t.doneAt)
                    )
                  )
                )
              )
            )
          : null,
        'No completed tasks on this day.'
      ),
      daySection('Food', selectedFood.length, foodContent, 'No food logged for this day.'),
      foodSummary && typeof foodSummary.totalCalories === 'number'
        ? h(
            'div',
            { class: 'gb-mini-cal-total' },
            'Total food: ' + foodSummary.totalCalories + ' kcal'
          )
        : null,
      daySection(
        'Reminders',
        selectedReminders.length,
        selectedReminders.length
          ? h(
              'div',
              { class: 'gb-mini-cal-items' },
              selectedReminders.map((rem) =>
                h(
                  'div',
                  { class: 'gb-mini-cal-item' },
                  h(
                    'div',
                    { class: 'gb-mini-cal-item-main' },
                    h('div', { class: 'gb-mini-cal-item-title' }, rem.text),
                    h(
                      'div',
                      { class: 'gb-mini-cal-item-sub' },
                      formatTime(rem.time) +
                        (rem.repeat && rem.repeat !== 'none' ? ' · ' + rem.repeat : '')
                    )
                  ),
                  h('span', { class: 'gb-mini-cal-pill is-tag' }, rem.tag || 'other')
                )
              )
            )
          : null,
        'No reminders for this day.'
      ),
    ],
  });
}

/* ---- Home-screen widget catalog ----
   The set of cards a user can show/hide and reorder on Home. `feature` (if set)
   gates the widget on a feature toggle being on. Order here is the default. */
const HOME_WIDGETS = [
  {
    id: 'score',
    label: 'Score & streak',
    desc: 'Your daily growth score and streak',
    feature: null,
  },
  { id: 'plan', label: 'Daily brief', desc: 'A quick suggested plan for today', feature: null },
  { id: 'wellness', label: 'Sleep & mood', desc: 'Log sleep and mood check-ins', feature: null },
  { id: 'tasks', label: "Today's tasks", desc: 'Your tasks for today', feature: null },
  {
    id: 'calendar',
    label: 'Mini calendar',
    desc: 'Month view with reminders & food',
    feature: 'calendar',
  },
  {
    id: 'habits',
    label: 'Habit streaks',
    desc: 'Your daily habits and streaks',
    feature: 'habits',
  },
  {
    id: 'money',
    label: 'Money Buddy',
    desc: 'Safe-to-spend & quick expense add',
    feature: 'money',
  },
  {
    id: 'reminders',
    label: 'Smart reminders',
    desc: 'Suggested reminders for today',
    feature: null,
  },
];

/* Merge a saved layout with the catalog: keep saved order/enabled for known
   widgets, drop unknown ids, and append any new catalog widgets (enabled). */
function resolveHomeLayout(saved) {
  const known = new Set(HOME_WIDGETS.map((w) => w.id));
  const seen = new Set();
  const out = [];
  (Array.isArray(saved) ? saved : []).forEach((item) => {
    if (item && known.has(item.id) && !seen.has(item.id)) {
      out.push({ id: item.id, enabled: item.enabled !== false });
      seen.add(item.id);
    }
  });
  HOME_WIDGETS.forEach((w) => {
    if (!seen.has(w.id)) out.push({ id: w.id, enabled: true });
  });
  return out;
}

function ScreenDashboard({
  features,
  tasks,
  toggleTask,
  habits,
  toggleHabit,
  score,
  water,
  wellness,
  reminders,
  foodSummary,
  dayFoodLoading,
  dayFoodError,
  onAddTask,
  onEditTask,
  onAddHabit,
  calYear,
  calMonth,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  onRetryFood,
  onPlanToday,
  onAddSleep,
  onAddMood,
  onOnboardDismiss,
  onAddSuggestedReminder,
  food,
  money,
  onSaveMoney,
  onOpenMoney,
  homeLayout,
}) {
  const on = (k) => !features || features[k] !== false;

  // One renderer per widget id. Each returns the card node(s) for that widget.
  const renderers = {
    score: () => ScoreCard({ score, tasks, habits }),
    plan: () => TodayPlanCard({ water, wellness, onPlanToday }),
    wellness: () => WellnessCard({ wellness, onAddSleep, onAddMood }),
    tasks: () => [
      SectionTitle({ title: "Today's tasks", action: '+ Add', onAction: onAddTask }),
      TasksCard({ tasks, toggleTask, onAdd: onAddTask, onEdit: onEditTask }),
    ],
    calendar: () =>
      MiniCalendarCard({
        tasks,
        reminders,
        foodSummary,
        dayFoodLoading,
        dayFoodError,
        calYear,
        calMonth,
        selectedDate,
        onSelectDate,
        onPrevMonth,
        onNextMonth,
        onRetryFood,
      }),
    habits: () => [
      SectionTitle({ title: 'Habit streaks', action: '+ Add', onAction: onAddHabit }),
      HabitStrip({ habits, onAdd: onAddHabit, toggleHabit }),
    ],
    reminders: () =>
      ReminderSuggestionsCard({ habits, water, wellness, reminders, onAddSuggestedReminder }),
    money: () => MoneyHomeCard({ money, onSaveMoney, onOpen: onOpenMoney }),
  };

  const blocks = resolveHomeLayout(homeLayout)
    .map((item) => {
      if (!item.enabled) return null;
      const def = HOME_WIDGETS.find((w) => w.id === item.id);
      if (!def || (def.feature && !on(def.feature))) return null; // respect feature toggles
      const content = renderers[item.id] && renderers[item.id]();
      if (!content) return null;
      const kids = Array.isArray(content) ? content : [content];
      return h('div', { class: 'gb-dash-block' }, ...kids);
    })
    .filter(Boolean);

  const onboard = OnboardingCard({
    tasks,
    habits,
    wellness,
    onAddHabit,
    onAddTask,
    onAddMood,
    onOnboardDismiss,
  });

  // Before you've added anything, the checklist IS the screen. Every widget
  // below it renders its own "nothing yet" state, so a new account used to open
  // on nine empty cards saying the same thing three ways — a checklist, a zero
  // score and a row of grey chips. One instruction beats nine blanks. Dismissing
  // the checklist (or adding anything at all) brings the full Home back. Any
  // data counts: an account with reminders and expenses but no task used to
  // see only the checklist, its own reminders and spending hidden behind it.
  const any = (o) => !!o && Object.keys(o).length > 0;
  const started =
    (tasks || []).length > 0 ||
    (habits || []).length > 0 ||
    (reminders || []).length > 0 ||
    (money && ['expenses', 'income', 'transfers'].some((k) => (money[k] || []).length > 0)) ||
    (food && (food.entries || []).length > 0) ||
    (water && (water.entries || []).length > 0) ||
    (wellness && (any(wellness.moodByDate) || any(wellness.sleepByDate)));
  if (onboard && !started) {
    return h(
      'div',
      { class: 'gb-rise gb-dash gb-dash--single gb-dash--onboarding' },
      h('div', { class: 'gb-dash-block' }, onboard)
    );
  }
  if (onboard) blocks.unshift(h('div', { class: 'gb-dash-block' }, onboard));

  return h('div', { class: 'gb-rise gb-dash gb-dash--single' }, ...blocks);
}

function ScreenFood({
  features,
  water,
  food,
  onOpenSummary,
  onQuickAddWater,
  onUpdateWaterGoal,
  onAddFood,
  onDeleteWater,
  onDeleteFood,
}) {
  const on = (k) => !features || features[k] !== false;
  return h(
    'div',
    { class: 'gb-rise', style: { padding: '0 20px 24px' } },
    on('water')
      ? h(
          'div',
          { class: 'gb-dash-block' },
          WaterCard({ water, onQuickAddWater, onUpdateWaterGoal, onDeleteWater })
        )
      : null,
    on('food')
      ? h('div', { class: 'gb-dash-block' }, FoodCard({ food, onAddFood, onDeleteFood }))
      : null,
    on('food') || on('water')
      ? h('div', { class: 'gb-dash-block' }, FoodSummaryLink({ onOpen: onOpenSummary }))
      : null
  );
}

/* ---- Fitness × Sleep insight card ---- */
function HabitSleepInsightCard({ habits, wellness }) {
  const fitnessHabits = (habits || []).filter((hab) => hab.domain === 'fitness');
  const allHabits = habits || [];
  const sleepEntries = Object.values((wellness && wellness.sleepByDate) || {}).sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );

  // This card correlates two things. Without both it has no correlation to
  // report, and it used to say so at full size: a "Fitness streak —" tile, three
  // tiles repeating numbers Home already shows, and a line asking you to add a
  // fitness habit. A card with nothing to say shouldn't take a card's worth of
  // room; it renders once there's something to correlate.
  if (!fitnessHabits.length || !sleepEntries.length) return null;

  const QUALITY_SCORE = { great: 4, good: 3, okay: 2, low: 1 };
  const avgQualityScore = sleepEntries.length
    ? sleepEntries.reduce((s, e) => s + (QUALITY_SCORE[e.quality] || 2), 0) / sleepEntries.length
    : null;

  const fitnessStreak = fitnessHabits.reduce((m, hab) => Math.max(m, hab.streak || 0), 0);
  const fitnessToday = fitnessHabits.some((hab) => hab.doneToday);
  const habitsDoneToday = allHabits.filter((hab) => hab.doneToday).length;

  const qualityLabel =
    avgQualityScore == null
      ? '—'
      : avgQualityScore >= 3.5
        ? 'Great'
        : avgQualityScore >= 2.5
          ? 'Good'
          : avgQualityScore >= 1.5
            ? 'Okay'
            : 'Low';

  let insightText = '';
  if (fitnessStreak >= 5 && avgQualityScore != null && avgQualityScore >= 3) {
    insightText =
      'Your ' +
      fitnessStreak +
      '-day fitness streak is paying off — sleep is ' +
      qualityLabel.toLowerCase() +
      '. Keep it up!';
  } else if (fitnessStreak >= 2 && avgQualityScore != null && avgQualityScore < 2.5) {
    insightText =
      fitnessStreak + ' days of fitness — good. A steady bedtime would lift your sleep too.';
  } else if (fitnessStreak === 0 && sleepEntries.some((e) => e.quality === 'low')) {
    insightText = 'Sleep has been low. Exercise is one of the best natural fixes — start small.';
  } else if (fitnessToday) {
    insightText = "Fitness done today. Log tonight's sleep to see the effect.";
  } else {
    insightText = 'Build a fitness streak to see how it changes your sleep.';
  }

  const latestSleep = sleepEntries.length ? sleepEntries[0] : null;
  const latestHours = sleepHours(latestSleep);

  return Card({
    className: 'gb-habit-sleep-card',
    children: [
      h(
        'div',
        { class: 'gb-card-titleline' },
        Icon('activity', { size: 18, sw: 2.4 }),
        'Fitness \xd7 Sleep'
      ),
      h(
        'div',
        { class: 'gb-habit-sleep-metrics' },
        h(
          'div',
          { class: 'gb-habit-sleep-metric' },
          h(
            'div',
            { class: 'gb-habit-sleep-metric-val' },
            fitnessStreak > 0 ? fitnessStreak + 'd' : fitnessToday ? '1d' : '—'
          ),
          h('div', { class: 'gb-habit-sleep-metric-label' }, 'Fitness streak')
        ),
        h(
          'div',
          { class: 'gb-habit-sleep-metric' },
          h(
            'div',
            { class: 'gb-habit-sleep-metric-val' },
            latestHours != null ? latestHours + 'h' : '—'
          ),
          h('div', { class: 'gb-habit-sleep-metric-label' }, 'Last sleep')
        ),
        h(
          'div',
          { class: 'gb-habit-sleep-metric' },
          h('div', { class: 'gb-habit-sleep-metric-val' }, qualityLabel),
          h('div', { class: 'gb-habit-sleep-metric-label' }, 'Sleep quality')
        ),
        h(
          'div',
          { class: 'gb-habit-sleep-metric' },
          h(
            'div',
            { class: 'gb-habit-sleep-metric-val' },
            habitsDoneToday + '/' + allHabits.length
          ),
          h('div', { class: 'gb-habit-sleep-metric-label' }, 'Habits today')
        )
      ),
      h('div', { class: 'gb-habit-sleep-insight' }, insightText),
    ],
  });
}

export {
  ScreenDashboard,
  HOME_WIDGETS,
  resolveHomeLayout,
  MiniCalendarCard as RenderMiniCalendarCard,
  ScreenFood,
  ScreenSummary,
  HabitSleepInsightCard,
  QuoteCard,
  WeeklyReflectionCard,
  BadgeCard,
  GoalTimelineCard,
};
