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
} from './gb-kit.js';
import { MoneyHomeCard } from './money.js';
import { CacheStorage } from './cache-storage.js';

const ONBOARD_KEY = 'gb.onboardDismissed';

/* First-run checklist: shown until the basics are set up (or dismissed). Each
   step marks itself done from existing data, so it doubles as live progress. */
function OnboardingCard({ tasks, habits, wellness, onAddHabit, onAddTask, onAddMood, onOnboardDismiss }) {
  if (CacheStorage.getItem(ONBOARD_KEY) === '1') return null;
  const today = todayKey();
  const steps = [
    { done: (habits || []).length > 0, label: 'Add your first habit', hint: 'Something to do daily', icon: 'repeat', action: onAddHabit },
    { done: (tasks || []).length > 0, label: 'Add a task for today', hint: 'One thing to get done', icon: 'list-todo', action: onAddTask },
    {
      done: !!(wellness && wellness.moodByDate && wellness.moodByDate[today]),
      label: 'Log how you feel', hint: 'A quick mood check-in', icon: 'smile-plus', action: onAddMood,
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
        h('div', null,
          h('div', { class: 'gb-onboard-kicker' }, 'Getting started'),
          h('div', { class: 'gb-onboard-title' }, 'Set up in ' + steps.length + ' quick steps')),
        h(
          'button',
          {
            type: 'button', class: 'gb-onboard-dismiss', 'aria-label': 'Dismiss',
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
      h('div', { class: 'gb-onboard-steps' }, ...steps.map((s) =>
        h(
          'button',
          { type: 'button', class: 'gb-onboard-step' + (s.done ? ' is-done' : ''), onclick: s.done ? null : s.action, disabled: s.done },
          h('span', { class: 'gb-onboard-step-ic' }, Icon(s.done ? 'check' : s.icon, { size: 16, sw: 2.4 })),
          h('span', { class: 'gb-onboard-step-tx' },
            h('span', { class: 'gb-onboard-step-l' }, s.label),
            h('span', { class: 'gb-onboard-step-h' }, s.hint)),
          s.done ? null : Icon('chevron-right', { size: 16, sw: 2.4 })
        )
      )),
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

function ScoreCard({ score, tasks, habits, level }) {
  const doneTasks = tasks.filter((t) => t.done).length;
  const doneHabits = habits.filter((h) => h.doneToday).length;
  const topStreak = habits.reduce((m, h) => Math.max(m, h.streak || 0), 0);

  const ringNumber = h(
    'span',
    {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: '26px',
        color: 'var(--fg1)',
        lineHeight: 1,
      },
    },
    String(score)
  );
  const ringLabel = h(
    'span',
    { style: { fontSize: '10px', fontWeight: 700, color: 'var(--fg3)' } },
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
  if (level && level > 0) {
    pills.push(
      Pill({
        icon: 'zap',
        label: 'Lvl ' + level,
        bg: 'var(--sun-50)',
        fg: 'var(--sun-700)',
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

function TaskRow(task, toggleTask) {
  const p = PRIORITY[task.priority] || PRIORITY.Low;
  return h(
    'div',
    { class: 'gb-row' + (task.done ? ' is-done' : '') },
    Check({ done: task.done, onToggle: () => toggleTask(task.id) }),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h('div', { class: 'title' }, task.title),
      h('div', { class: 'sub' }, task.time)
    ),
    Pill({ label: task.priority, bg: p.bg, fg: p.fg, dot: p.dot })
  );
}

function TasksCard({ tasks, toggleTask, onAdd }) {
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
        tasks.map((t) => TaskRow(t, toggleTask))
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

function TodayPlanCard({ tasks, habits, water, wellness, onPlanToday }) {
  const key = todayKey();
  const sleep = wellness && wellness.sleepByDate ? wellness.sleepByDate[key] : null;
  const mood = wellness && wellness.moodByDate ? wellness.moodByDate[key] : null;
  const pendingTasks = (tasks || []).filter((t) => !t.done).length;
  const pendingHabits = (habits || []).filter((habit) => !habit.doneToday).length;
  const waterGoal = Math.max(1, (water && water.goalMl) || 2000);
  const waterPct = Math.min(
    100,
    Math.round((((water && water.consumedMl) || 0) / waterGoal) * 100)
  );
  const totalTasks = (tasks || []).length;
  const totalHabits = (habits || []).length;
  // Each chip carries a tone so the brief is scannable at a glance: finished
  // items read green, anything still needing attention stays quiet/neutral.
  const chips = [
    totalTasks === 0
      ? { label: 'No tasks yet', tone: 'todo' }
      : pendingTasks === 0
        ? { label: 'Tasks done', tone: 'done' }
        : { label: plural(pendingTasks, 'task') + ' left', tone: 'todo' },
    totalHabits === 0
      ? { label: 'No habits yet', tone: 'todo' }
      : pendingHabits === 0
        ? { label: 'Habits done', tone: 'done' }
        : { label: plural(pendingHabits, 'habit') + ' left', tone: 'todo' },
    { label: waterPct + '% water', tone: waterPct >= 100 ? 'done' : 'todo' },
    sleep ? { label: 'Sleep logged', tone: 'done' } : { label: 'Sleep not logged', tone: 'todo' },
    mood ? { label: 'Mood logged', tone: 'done' } : { label: 'Mood not logged', tone: 'todo' },
  ];
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
          'Plan'
        )
      ),
      h(
        'div',
        { class: 'gb-coach-chiprow' },
        chips.map((chip) => h('span', { class: 'gb-coach-chip gb-coach-chip--' + chip.tone }, chip.label))
      ),
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
          h('strong', null, hours == null ? 'Add' : hours + 'h'),
          h('small', null, sleep ? sleep.quality : 'schedule')
        ),
        h(
          'button',
          { type: 'button', class: 'gb-wellness-tile', onclick: onAddMood },
          h('span', { class: 'gb-wellness-icon' }, Icon('smile-plus', { size: 18, sw: 2.4 })),
          h('span', { class: 'gb-wellness-label' }, 'Mood'),
          h('strong', null, mood ? mood.mood : 'Add'),
          h('small', null, mood ? mood.energy + ' energy' : 'check-in')
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

function ReminderSuggestionsCard({ habits, water, wellness, onAddSuggestedReminder }) {
  const key = todayKey();
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
  if (!items.length)
    items.push({ icon: 'sparkles', text: 'Review tomorrow plan', time: '20:30', tag: 'personal' });
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
        items.slice(0, 3).map((item) =>
          h(
            'div',
            { class: 'gb-suggest-row' },
            h('span', { class: 'gb-suggest-icon' }, Icon(item.icon, { size: 16, sw: 2.4 })),
            h(
              'span',
              { class: 'gb-suggest-copy' },
              h('strong', null, item.text),
              h('small', null, item.time)
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--soft gb-btn--compact',
                onclick: () =>
                  onAddSuggestedReminder && onAddSuggestedReminder(item.text, item.time, item.tag),
              },
              'Add'
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
        : h('div', { class: 'gb-empty-slim' }, 'Log one goal action to start the timeline.'),
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
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

    let overlay = null;
    const input = h('input', {
      type: 'number',
      class: 'gb-input',
      min: String(cfg.min),
      max: String(cfg.max),
      step: '1',
      value: String(cfg.initialValue || ''),
    });
    const error = h('div', { class: 'gb-water-prompt-error', 'aria-live': 'polite' });

    function close() {
      if (!overlay) return;
      document.removeEventListener('keydown', onKeyDown);
      overlay.classList.remove('is-open');
      setTimeout(() => {
        if (overlay) {
          overlay.remove();
          overlay = null;
        }
      }, 180);
    }

    function showError(msg) {
      error.textContent = msg || '';
    }

    function onKeyDown(e) {
      if (!overlay) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    }

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

    const sheet = h(
      'div',
      { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': cfg.title },
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

    overlay = h(
      'div',
      {
        class: 'gb-modal-overlay',
        onclick: (e) => {
          if (e.target === overlay) close();
        },
      },
      sheet
    );
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
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
      min: 250,
      max: 10000,
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
            class: 'gb-water-add is-boost',
            'aria-label': 'Add 750 millilitres of water',
            onclick: () => onQuickAddWater && onQuickAddWater(750),
          },
          'Hydration boost'
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
          'Custom amount'
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
                    { style: { marginLeft: '8px', fontSize: '12px', color: 'var(--fg3)' } },
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

function PhotoHistoryCard({ photoHistory }) {
  const items = photoHistory || [];
  return Card({
    className: 'gb-photo-history-card',
    children: [
      h(
        'div',
        { class: 'gb-water-head' },
        h(
          'div',
          null,
          h('div', { class: 'gb-water-title' }, 'Photo food history'),
          h('div', { class: 'gb-water-meta' }, 'Recent plate estimates and confidence')
        ),
        items.length
          ? h(
              'div',
              { class: 'gb-food-total', 'aria-label': plural(items.length, 'plate photo') },
              items.length
            )
          : null
      ),
      items.length
        ? h(
            'div',
            { class: 'gb-photo-history-list' },
            items
              .slice(0, 6)
              .map((item) =>
                h(
                  'div',
                  { class: 'gb-photo-history-row' },
                  h(
                    'span',
                    { class: 'gb-photo-history-icon' },
                    Icon('camera', { size: 16, sw: 2.4 })
                  ),
                  h(
                    'span',
                    { class: 'gb-photo-history-copy' },
                    h('strong', null, item.foodName || 'Plate photo'),
                    h(
                      'small',
                      null,
                      (item.mealType || 'meal') +
                        (item.confidence == null ? '' : ' - ' + item.confidence + '% confidence')
                    )
                  ),
                  item.fallbackNeeded
                    ? h('span', { class: 'gb-photo-history-pill' }, 'review')
                    : h('span', { class: 'gb-photo-history-pill is-good' }, 'used')
                )
              )
          )
        : h(
            'p',
            { class: 'gb-water-quote', style: { marginTop: '8px' } },
            'Analyze a plate photo while logging food to build history.'
          ),
    ],
  });
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
    habits.slice(0, 4).map((h2) => HabitCard(h2, toggleHabit))
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
  function formatTime(value) {
    if (!value) return 'Any time';
    const parts = String(value).split(':');
    let hh = parseInt(parts[0], 10);
    const mm = parts[1] || '00';
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12;
    if (hh === 0) hh = 12;
    return hh + ':' + mm + ' ' + ampm;
  }
  function prettyTaskTime(iso) {
    if (!iso) return 'No due time';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
  function occursOn(rem, key) {
    const anchorBits = parseKey(rem.date);
    const targetBits = parseKey(key);
    const anchor = new Date(anchorBits.y, anchorBits.m, anchorBits.d);
    const target = new Date(targetBits.y, targetBits.m, targetBits.d);
    if (Number.isNaN(anchor.getTime()) || Number.isNaN(target.getTime())) return false;
    if (target < anchor) return false;
    if (rem.until) {
      const endBits = parseKey(rem.until);
      const end = new Date(endBits.y, endBits.m, endBits.d);
      if (target > end) return false;
    }
    if (Array.isArray(rem.skip) && rem.skip.indexOf(key) !== -1) return false;
    switch (rem.repeat) {
      case 'daily':
        return true;
      case 'weekly':
        return target.getDay() === anchor.getDay();
      case 'monthly':
        return targetBits.d === anchorBits.d;
      case 'yearly':
        return targetBits.m === anchorBits.m && targetBits.d === anchorBits.d;
      default:
        return target.getTime() === anchor.getTime();
    }
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
          'aria-label': prettyDate(key) + ' - ' + (total ? total + ' items' : 'free'),
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
  level,
  onAddTask,
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
  money,
  onSaveMoney,
  onOpenMoney,
  homeLayout,
}) {
  const on = (k) => !features || features[k] !== false;

  // One renderer per widget id. Each returns the card node(s) for that widget.
  const renderers = {
    score: () => ScoreCard({ score, tasks, habits, level }),
    plan: () => TodayPlanCard({ tasks, habits, water, wellness, onPlanToday }),
    wellness: () => WellnessCard({ wellness, onAddSleep, onAddMood }),
    tasks: () => [
      SectionTitle({ title: "Today's tasks", action: '+ Add', onAction: onAddTask }),
      TasksCard({ tasks, toggleTask, onAdd: onAddTask }),
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
    reminders: () => ReminderSuggestionsCard({ habits, water, wellness, onAddSuggestedReminder }),
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

  const onboard = OnboardingCard({ tasks, habits, wellness, onAddHabit, onAddTask, onAddMood, onOnboardDismiss });
  if (onboard) blocks.unshift(h('div', { class: 'gb-dash-block' }, onboard));

  return h('div', { class: 'gb-rise gb-dash gb-dash--single' }, ...blocks);
}

function ScreenFood({
  features,
  water,
  food,
  photoHistory,
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
    on('food') ? h('div', { class: 'gb-dash-block' }, PhotoHistoryCard({ photoHistory })) : null
  );
}

/* ---- Fitness × Sleep insight card ---- */
function HabitSleepInsightCard({ habits, wellness }) {
  const fitnessHabits = (habits || []).filter((hab) => hab.domain === 'fitness');
  const allHabits = habits || [];
  const sleepEntries = Object.values((wellness && wellness.sleepByDate) || {}).sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );

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
  if (fitnessHabits.length === 0) {
    insightText = 'Add a fitness habit to see how exercise affects your sleep.';
  } else if (fitnessStreak >= 5 && avgQualityScore != null && avgQualityScore >= 3) {
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
  HabitSleepInsightCard,
  QuoteCard,
  WeeklyReflectionCard,
  BadgeCard,
  GoalTimelineCard,
};
