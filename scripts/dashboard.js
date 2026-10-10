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
  refreshIcons,
} from './gb-kit.js';
import { MoneyHomeCard } from './money-home.js';
import { CacheStorage } from './cache-storage.js';
import { occursOn } from './recurrence.js';
import {
  HOME_WIDGETS,
  resolveHomeLayout,
  sortTasksForHome,
  sortHabitsForHome,
  habitDue,
  topStreaks,
  homeGoals,
} from './home-order.js';
import { suggestReminderTime } from './habit-stats.js';
import { fmtDate, fmtNumber } from './i18n.js';
import {
  groupBySlot,
  mealSlotAt,
  DRINKS,
  effectiveMl,
  suggestWaterGoalMl,
  dayMicros,
} from './nutrition.js';

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
              // On a fresh account the checklist is the whole Home, so hiding it
              // left a blank screen; ask for a re-render to bring the full Home back.
              if (onOnboardDismiss) onOnboardDismiss({ rerender: true });
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

function ScoreCard({ score, tasks: allTasks, habits }) {
  // Paused tasks are out of the score, so out of its "x/y tasks" line too.
  const tasks = allTasks.filter((t) => !t.paused);
  const doneTasks = tasks.filter((t) => t.done).length;
  // The habits owed today, as the server's score counts them (HabitService.
  // countsOn): a weekly habit already done this week, or a paused one, is not
  // today's miss. "2/3 habits" used to count every habit.
  const dueHabits = habits.filter((hb) => habitDue(hb) || hb.doneToday);
  const doneHabits = dueHabits.filter((hb) => hb.doneToday).length;
  const best = topStreaks(habits);

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

  // Days and weeks are different units, so each gets its own pill; one max
  // over both called a 6-week streak "6-day".
  const pills = [];
  [
    [best.days, '-day', ' day streak'],
    [best.weeks, '-week', ' week streak'],
  ].forEach(([n, unit, spoken]) => {
    if (n > 0) {
      const pill = Pill({
        icon: 'flame',
        label: n + unit,
        bg: 'var(--coral-50)',
        fg: 'var(--coral-700)',
      });
      pill.setAttribute('aria-label', 'Best ' + n + spoken);
      pills.push(pill);
    }
  });

  const subParts = [];
  if (tasks.length) subParts.push(doneTasks + '/' + tasks.length + ' tasks');
  if (dueHabits.length) subParts.push(doneHabits + '/' + dueHabits.length + ' habits');
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

function TaskRow(task, toggleTask, onEdit, onPause, onFocus) {
  const p = PRIORITY[task.priority] || PRIORITY.Low;
  return h(
    'div',
    {
      class: 'gb-row' + (task.done ? ' is-done' : '') + (task.paused ? ' is-paused' : ''),
      'data-task-id': task.id,
    },
    Check({ done: task.done, onToggle: () => toggleTask(task.id), label: task.title }),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h('div', { class: 'title' }, task.title),
      // The pill rides the sub line, not the row: beside the pause and edit
      // buttons it squeezed a long title onto four lines on a phone.
      h(
        'div',
        { class: 'sub' },
        // task.time is already formatted ("Overdue · 1 Jan · 10:00") by
        // mapTask; formatTime() could not parse it and blanked every row.
        task.paused
          ? 'Paused'
          : h(
              'span',
              task.overdue ? { style: { color: 'var(--coral-700)', fontWeight: 600 } } : null,
              task.time
            ),
        Pill({
          label: task.priority,
          bg: p.bg,
          fg: p.fg,
          dot: p.dot,
          style: { padding: '2px 8px' },
        })
      )
    ),
    onPause && !task.done
      ? h(
          'button',
          {
            type: 'button',
            class: 'gb-icon-btn',
            'aria-label': (task.paused ? 'Resume ' : 'Pause ') + task.title,
            'aria-pressed': String(task.paused),
            onclick: () => onPause(task),
          },
          Icon(task.paused ? 'play' : 'pause', { size: 15, sw: 2.4 })
        )
      : null,
    // Opens the Focus timer with this task picked as what the session is on.
    onFocus && !task.done && !task.paused
      ? h(
          'button',
          {
            type: 'button',
            class: 'gb-icon-btn',
            'aria-label': 'Start focus on ' + task.title,
            title: 'Start focus',
            onclick: () => onFocus(task),
          },
          Icon('timer', { size: 15, sw: 2.4 })
        )
      : null,
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

/* The Home task list grows with the page. It was a 284px scroll box inside the
   scrolling page, a scroller in a scroller that trapped the thumb; now it shows
   the first TASKS_SHOWN and a "Show all" that opens the rest in place. The
   choice lives here so a re-render after a tick doesn't fold it back. */
const TASKS_SHOWN = 6;
let tasksExpanded = false;

function TasksCard(props) {
  const { toggleTask, onAdd, onEdit, onPause, onFocus } = props;
  // Overdue, today, upcoming, no date; paused and done last (home-order.js).
  const tasks = sortTasksForHome(props.tasks);
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
  const hidden = tasksExpanded ? 0 : Math.max(0, tasks.length - TASKS_SHOWN);
  const card = Card({
    children: [
      h(
        'div',
        { class: 'gb-tasks-list' },
        tasks
          .slice(0, tasks.length - hidden)
          .map((t) => TaskRow(t, toggleTask, onEdit, onPause, onFocus))
      ),
      hidden
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--ghost gb-tasks-more',
              onclick: () => {
                tasksExpanded = true;
                const next = TasksCard(props);
                card.replaceWith(next);
                refreshIcons();
                // The button is gone; land on the first row it revealed.
                const row = next.querySelectorAll('.gb-row')[TASKS_SHOWN];
                row?.querySelector('button, input, [tabindex]')?.focus();
              },
            },
            'Show all ' + tasks.length + ' tasks'
          )
        : null,
    ],
  });
  return card;
}

function HabitCard(habit, toggleHabit) {
  return Card({
    className: 'gb-habit-card' + (habit.doneToday ? ' is-done' : ''),
    children: [
      IconChip({ domain: habit.domain, icon: habit.icon }),
      h('div', { class: 'name' }, habit.name),
      // The flame and a bare number said nothing to a screen reader.
      h(
        'div',
        {
          class: 'streak',
          role: 'img',
          'aria-label':
            (habit.streak || 0) +
            ((habit.cadence || 'daily') === 'daily' ? '-day' : '-week') +
            ' streak',
        },
        Icon('flame', { size: 14, color: 'var(--coral-500)' }),
        String(habit.streak || 0)
      ),
      toggleHabit
        ? Check({
            done: !!habit.doneToday,
            onToggle: () => toggleHabit(habit.id),
            label: habit.name,
          })
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
  if (water && waterPct < 100) chips.push({ label: waterPct + '% water' });
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
  // A habit with its own reminder time is already covered (bell, push and
  // WhatsApp at that time); suggesting a second 19:00 one for it read as if
  // its reminder had landed here instead, and Add booked a duplicate.
  // Only a habit still owed today: a paused one, or a weekly one already met,
  // has nothing to be reminded of.
  const missedHabit = (habits || []).find(
    (habit) => !habit.doneToday && !habit.reminderTime && habitDue(habit)
  );
  // The time: when this user already likes to be nudged — the median of the
  // reminder times on their other habits (suggestReminderTime), else 19:00.
  // The server keeps no time of day for a check-in, so "when they usually tick"
  // isn't knowable here.
  if (missedHabit)
    items.push({
      icon: 'repeat',
      text: missedHabit.name + ' reminder',
      time: suggestReminderTime(habits),
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

function WaterCard({ water, onQuickAddWater, onUpdateWaterGoal, onDeleteWater, weightKg }) {
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
    // Backdating: "I forgot to log yesterday's bottle". Capped at today.
    const dayInput = cfg.withDay
      ? h('input', {
          type: 'date',
          class: 'gb-input',
          value: todayKey(),
          max: todayKey(),
          'aria-label': 'Day',
        })
      : null;
    // What was drunk: tea and coffee count for a little less (nutrition.js
    // HYDRATION). Water first and preselected; the quick buttons are always water.
    let drink = 'water';
    const drinkRow = cfg.withDrink
      ? h(
          'div',
          { class: 'gb-water-drinks', role: 'radiogroup', 'aria-label': 'Drink' },
          DRINKS.map((d) =>
            h(
              'button',
              {
                type: 'button',
                class: 'gb-water-drink' + (d.key === drink ? ' is-on' : ''),
                role: 'radio',
                'aria-checked': String(d.key === drink),
                onclick: (e) => {
                  drink = d.key;
                  for (const b of drinkRow.children) {
                    const on = b === e.currentTarget;
                    b.classList.toggle('is-on', on);
                    b.setAttribute('aria-checked', String(on));
                  }
                },
              },
              d.label
            )
          )
        )
      : null;
    // "Suggested: 2,250 ml" — one tap puts it in the field; Save still saves.
    const suggestBtn = cfg.suggestion
      ? h(
          'button',
          {
            type: 'button',
            class: 'gb-water-suggest',
            onclick: () => {
              input.value = String(cfg.suggestion.value);
              input.focus();
            },
          },
          cfg.suggestion.label
        )
      : null;

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
      if (dayInput && dayInput.value > todayKey()) {
        showError("You can't log water for a day that hasn't happened yet.");
        dayInput.focus();
        return;
      }
      if (typeof cfg.onConfirm === 'function') {
        cfg.onConfirm(Math.round(value), dayInput ? dayInput.value || todayKey() : undefined, drink);
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
          suggestBtn,
          drinkRow ? h('div', { class: 'gb-field-label' }, 'Drink') : null,
          drinkRow,
          dayInput ? h('div', { class: 'gb-field-label' }, 'Day') : null,
          dayInput,
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
            class: 'gb-btn gb-btn--primary',
            onclick: submit,
          },
          cfg.confirmLabel
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--ghost',
            onclick: close,
          },
          'Cancel'
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
      withDay: true,
      withDrink: true,
      onConfirm: (amount, day, drink) => onQuickAddWater(amount, day, drink),
    });
  }

  function setGoalAmount() {
    if (!onUpdateWaterGoal) return;
    // 33 ml per kg of the profile's weight, to the nearest 250; none without one.
    const suggested = suggestWaterGoalMl(weightKg);
    openNumericPrompt({
      suggestion:
        suggested && suggested !== goalMl
          ? {
              value: suggested,
              label: 'Suggested for ' + weightKg + ' kg: ' + fmtNumber(suggested) + ' ml',
            }
          : null,
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
            // Full height, slid down by what's missing: a transform runs on the
            // compositor where an animated height re-laid the card every frame,
            // and unlike scaleY it doesn't squash the bubbles and wave inside.
            { class: 'gb-water-fill', style: { transform: 'translateY(' + (100 - pct) + '%)' } },
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
                  h(
                    'span',
                    null,
                    (item.amountMl || 0) +
                      ' ml' +
                      (item.drinkType && item.drinkType !== 'water'
                        ? ' ' +
                          item.drinkType +
                          ' (counts ' +
                          (item.effectiveMl ?? effectiveMl(item.amountMl, item.drinkType)) +
                          ')'
                        : '')
                  ),
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

/* Slots start at these local hours; "Copy yesterday's" is offered for an empty
   one only once it has begun (a snack, any time). */
const SLOT_STARTS = { breakfast: 4, lunch: 11, dinner: 18, snack: 0 };

function FoodCard({ food, onAddFood, onDeleteFood, onEditFood, onCopySlot }) {
  const total = Math.max(0, (food && food.totalCalories) || 0);
  const entries = (food && food.entries) || [];
  const groups = groupBySlot(entries);
  const micros = dayMicros(food);
  const isToday = !food || !food.date || food.date === todayKey();
  const hourNow = new Date().getHours();
  const nowSlot = mealSlotAt(new Date());

  const row = (item) =>
    h(
      'div',
      { class: 'gb-water-log-row', 'data-food-id': item.id },
      // The text is the edit button (as on a Money expense row).
      h(
        onEditFood ? 'button' : 'div',
        onEditFood
          ? {
              type: 'button',
              class: 'gb-food-row-edit',
              onclick: () => onEditFood(item),
              'aria-label': 'Edit ' + item.foodName,
            }
          : { style: { flex: 1 } },
        h('span', null, item.foodName + ' (' + item.quantityGrams + 'g)'),
        h('span', { style: { marginLeft: '8px' } }, item.kcalEstimated + ' kcal')
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--icon',
          // app.js confirms first and plays the row's exit after.
          onclick: () => onDeleteFood && onDeleteFood(item.id),
          title: 'Delete',
          'aria-label': 'Delete food entry',
        },
        Icon('x', { size: 16, sw: 2.4 })
      )
    );

  // An empty slot that has begun (or the one we're in) offers yesterday's.
  const copyBtn = (g) =>
    onCopySlot && isToday && (hourNow >= SLOT_STARTS[g.slot] || g.slot === nowSlot)
      ? h(
          'button',
          {
            type: 'button',
            class: 'gb-food-copy',
            onclick: () => onCopySlot(g.slot),
          },
          Icon('copy', { size: 14, sw: 2.2 }),
          'Copy yesterday’s ' + g.label.toLowerCase()
        )
      : null;

  const slots = groups
    .map((g) =>
      g.entries.length
        ? h(
            'section',
            { class: 'gb-food-slot', 'aria-label': g.label },
            h(
              'div',
              { class: 'gb-food-slot-head' },
              h('span', null, g.label),
              h('span', { class: 'gb-food-slot-kcal' }, g.kcal + ' kcal')
            ),
            h('div', { class: 'gb-water-log' }, g.entries.map(row))
          )
        : copyBtn(g)
    )
    .filter(Boolean);
  const copies = slots.filter((n) => n.classList && n.classList.contains('gb-food-copy'));
  const filled = slots.filter((n) => !copies.includes(n));

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
          // Same full-width soft button as the Summary card's "Open summary" below it.
          class: 'gb-btn gb-btn--soft gb-food-check-btn gb-food-add',
          onclick: () => onAddFood && onAddFood(),
        },
        Icon('plus', { size: 16, sw: 2.4 }),
        'Log food'
      ),
      // Only what is known: fibre is estimated, sugar and sodium come from a
      // scanned label, so a day without either shows no 0 for them.
      micros.length
        ? h(
            'div',
            { class: 'gb-food-micros' },
            micros.map((m) => h('span', null, m.label + ' ' + m.value + ' ' + m.unit))
          )
        : null,
      entries.length
        ? filled
        : h(
            'p',
            { class: 'gb-water-quote', style: { marginTop: '8px' } },
            'No food logged yet today.'
          ),
      copies.length ? h('div', { class: 'gb-food-copies' }, copies) : null,
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
const isGood = (key, v) =>
  v === 'ok' || (v === 'high' && (key === 'protein' || key === 'fiber' || key === 'water'));
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
    : fmtDate(date, 'weekday');
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
        h('span', { class: 'gb-thali-total' }, fmtNumber(week.avgKcal)),
        h('span', { class: 'gb-thali-unit' }, 'kcal a day'),
        h('span', { class: 'gb-thali-of' }, 'goal ' + fmtNumber(week.goalKcal))
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

function NutrientPanel(week, n, onPickDay) {
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
              ". Buddy's read on this day",
            onclick: () => onPickDay && onPickDay(d.date),
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
function DayByDayCard(week, onPickDay) {
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
      NUTRIENTS.map((n) => NutrientPanel(week, n, onPickDay)),
      h('p', { class: 'gb-summary-hint' }, "Tap a day for Buddy's read on it."),
    ],
  });
}

function WaterWeekCard(water) {
  const goal = Math.max(1, water.goalMl || 2000);
  const days = water.days || [];
  const last = days.length - 1;
  // Same days as the calorie average (FoodWeek.averaged): finished days with
  // something logged; only today logged, then today. Counting empty days as 0
  // read "0.0 L a day" beside a 0.5 L bar.
  const logged = days.filter((d) => d.ml > 0);
  const past = logged.filter((d) => d !== days[last]);
  const done = past.length ? past : logged;
  const avg = done.length ? done.reduce((s, d) => s + d.ml, 0) / done.length : 0;
  const hits = days.filter((d) => d.ml >= goal).length;
  const litres = (ml) => (ml / 1000).toFixed(1);
  return Card({
    className: 'gb-food-week-card gb-summary-card gb-water-week',
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
          // Read-only: a tap used to ask Buddy (an AI call) about the day.
          h(
            'div',
            {
              class: 'gb-tumbler-col' + (i === last ? ' is-today' : ''),
              role: 'img',
              'aria-label': dayLabel(d.date, i === last) + ': ' + d.ml + ' ml of water',
            },
            h('small', { 'aria-hidden': 'true' }, litres(d.ml)),
            h(
              'div',
              { class: 'gb-tumbler' + (d.ml >= goal ? ' is-full' : ''), 'aria-hidden': 'true' },
              h('div', {
                class: 'gb-tumbler-fill',
                style: { transform: 'scaleY(' + Math.min(1, d.ml / goal).toFixed(3) + ')' },
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

// "today", or the weekday a tapped bar belongs to.
function dayName(date) {
  return date === todayKey()
    ? 'today'
    : fmtDate(date, 'weekdayLong');
}

// One day's numbers, straight from the week already on screen: shown the moment a
// day is tapped, while Buddy is still reading it. Like Money's day panel.
function dayFacts(date, week, water) {
  const f = ((week && week.days) || []).find((d) => d.date === date);
  const w = ((water && water.days) || []).find((d) => d.date === date);
  const parts = [];
  if (f) {
    parts.push(
      fmtNumber(f.kcal) + ' of ' + fmtNumber(week.goalKcal) + ' kcal',
      f.count === 1 ? '1 dish' : f.count + ' dishes'
    );
  }
  if (w) {
    parts.push((w.ml / 1000).toFixed(1) + ' of ' + (water.goalMl / 1000).toFixed(1) + ' L water');
  }
  return parts.length ? h('p', { class: 'gb-summary-meta' }, parts.join(' · ')) : null;
}

function DietCheckCard({ check, canCheck, onCheck, week, water, onOpenDay }) {
  const st = check || {};
  const scope = st.scope || 'week';
  const date = scope === 'day' ? st.date : todayKey();
  const what = scope === 'day' ? dayName(date) : 'your week';
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
    body = Thinking('Buddy is reading ' + what, [
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
            NUTRIENTS.map((n) => level(n, r[n.key])),
            r.water
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-food-level' + (isGood('water', r.water) ? ' is-good' : ''),
                    onclick: () => {
                      const card = document.querySelector('.gb-water-week');
                      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                      if (card)
                        card.scrollIntoView({
                          behavior: still ? 'auto' : 'smooth',
                          block: 'start',
                        });
                    },
                  },
                  'Water · ' + (LEVEL_TEXT[r.water] || '-')
                )
              : null
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
      'Buddy reads the dishes and water you logged and tells you how to close the gaps. Tap a day above for that day alone.'
    );
  }
  const facts = scope === 'day' ? dayFacts(date, week, water) : null;
  return Card({
    className: 'gb-food-week-card gb-summary-card gb-summary-buddy',
    children: [
      h(
        'div',
        { class: 'gb-buddy-eyebrow' },
        Icon('sparkles', { size: 16, sw: 2.4 }),
        "Buddy's read on " + what
      ),
      facts,
      body,
      scope === 'day' && !st.loading
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--ghost gb-btn--compact gb-food-check-meals',
              onclick: () => onOpenDay && onOpenDay(date),
            },
            'See these meals in Calendar',
            Icon('chevron-right', { size: 16, sw: 2.6 })
          )
        : null,
      h(
        'div',
        { class: 'gb-food-check-btns' },
        [
          [
            'day',
            date === todayKey() ? 'Check today' : 'Check ' + dayName(date),
            () => onCheck && onCheck(date),
          ],
          ['week', 'Check my week', () => onCheck && onCheck()],
        ].map(([s, label, run]) => {
          const mine = s === scope && (st.loading || st.data || st.error);
          return h(
            'button',
            {
              type: 'button',
              class:
                'gb-btn gb-btn--soft gb-food-check-btn' +
                (mine && st.loading ? ' is-thinking' : ''),
              disabled: !!st.loading || !canCheck,
              onclick: run,
            },
            mine && st.loading ? thinkingLabel('Reading') : mine ? 'Check again' : label
          );
        })
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
  onPickDay,
}) {
  const on = (k) => !features || features[k] !== false;
  // A tapped day is read in the Buddy card; runDietCheck brings the card to the tap.
  const pick = (date) => onPickDay && onPickDay(date);
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
    fmtDate(k, 'dayMonth');
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
        food ? DayByDayCard(week, pick) : null,
        on('water') ? WaterWeekCard(water) : null,
        on('food')
          ? DietCheckCard({
              check,
              canCheck: logged.length > 0,
              onCheck,
              week,
              water: on('water') ? water : null,
              onOpenDay,
            })
          : null,
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
    // on Home — not scrolled off, not rendered. What is still owed comes first.
    sortHabitsForHome(habits).map((h2) => HabitCard(h2, toggleHabit))
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
    const rems = remindersOn(key);
    // A daily reminder put a "1" on every day ahead, so the badge said nothing.
    // The number counts one-off items only; a repeating one is a dot, and a day
    // with nothing but its routine still reads as free.
    const repeating = rems.filter((r) => r.repeat && r.repeat !== 'none').length;
    const reminderCount = rems.length - repeating;
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
          'aria-label':
            prettyDate(key) +
            ', ' +
            (total ? plural(total, 'item') : 'free') +
            (repeating ? ', ' + plural(repeating, 'repeating reminder') : ''),
          onclick: () => onSelectDate(key),
        },
        h('span', { class: 'num' }, String(dt.getDate())),
        total
          ? h('span', { class: 'badge' }, String(total))
          : repeating
            ? h('span', { class: 'gb-mini-cal-rep' })
            : null
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
        h(
          'span',
          { class: 'gb-mini-cal-legend-item' },
          h('span', { class: 'dot is-repeating' }),
          'Repeating'
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

/* HOME_WIDGETS and resolveHomeLayout live in home-order.js (DOM-free, so they
   have a node test); re-exported below for the callers that import them here. */

/* ---- Goals widget ----
   The nearest open goals: days to the target, the next unticked milestone, the
   day tracker's count. The whole card opens Goals; nothing is edited here. */
function GoalsCard({ goals, goalProgress, onOpenGoals }) {
  const rows = homeGoals(goals, goalProgress, todayKey());
  const dueLine = (r) => {
    if (r.daysLeft == null) return 'No target date';
    if (r.daysLeft < 0) return 'Overdue by ' + plural(-r.daysLeft, 'day');
    if (r.daysLeft === 0) return 'Due today';
    return plural(r.daysLeft, 'day') + ' left';
  };
  return Card({
    className: 'gb-home-goals',
    children: [
      h('div', { class: 'gb-card-titleline' }, Icon('target', { size: 18, sw: 2.4 }), 'Goals'),
      rows.length
        ? h(
            'div',
            { class: 'gb-timeline-list' },
            rows.map((r) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-timeline-row gb-home-goal',
                  style: {
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 0,
                    padding: 0,
                    cursor: 'pointer',
                  },
                  'aria-label': r.goal.title + ', ' + dueLine(r) + '. Open Goals',
                  onclick: onOpenGoals,
                },
                h('span', { class: 'gb-timeline-dot' }),
                h(
                  'span',
                  { class: 'gb-timeline-copy' },
                  h('strong', null, r.goal.title),
                  h(
                    'small',
                    r.daysLeft != null && r.daysLeft < 0
                      ? { style: { color: 'var(--coral-700)', fontWeight: 600 } }
                      : null,
                    [
                      dueLine(r),
                      r.nextMilestone ? 'Next: ' + r.nextMilestone : null,
                      r.days ? r.days.done + '/' + r.days.total + ' days' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  )
                )
              )
            )
          )
        : h(
            'div',
            { class: 'gb-empty-slim' },
            'No open goals. ',
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--ghost gb-btn--compact',
                onclick: onOpenGoals,
              },
              'Set one'
            )
          ),
    ],
  });
}

function ScreenDashboard({
  features,
  tasks,
  toggleTask,
  habits,
  toggleHabit,
  goals,
  goalProgress,
  onOpenGoals,
  score,
  water,
  wellness,
  reminders,
  foodSummary,
  dayFoodLoading,
  dayFoodError,
  onAddTask,
  onEditTask,
  onPauseTask,
  onFocusTask,
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
    // A turned-off feature drops out of the cards that summarise it, not just its own card.
    score: () => ScoreCard({ score, tasks, habits: on('habits') ? habits : [] }),
    plan: () => TodayPlanCard({ water: on('water') ? water : null, wellness, onPlanToday }),
    wellness: () => WellnessCard({ wellness, onAddSleep, onAddMood }),
    tasks: () => [
      SectionTitle({ title: "Today's tasks", action: '+ Add', onAction: onAddTask }),
      TasksCard({
        tasks,
        toggleTask,
        onAdd: onAddTask,
        onEdit: onEditTask,
        onPause: onPauseTask,
        onFocus: onFocusTask,
      }),
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
    goals: () => GoalsCard({ goals, goalProgress, onOpenGoals }),
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
  onEditFood,
  onCopySlot,
  weightKg,
}) {
  const on = (k) => !features || features[k] !== false;
  return h(
    'div',
    { class: 'gb-rise', style: { padding: '0 0 24px' } },
    on('water')
      ? h(
          'div',
          { class: 'gb-dash-block' },
          WaterCard({ water, onQuickAddWater, onUpdateWaterGoal, onDeleteWater, weightKg })
        )
      : null,
    on('food')
      ? h('div', { class: 'gb-dash-block' }, FoodCard({ food, onAddFood, onDeleteFood, onEditFood, onCopySlot }))
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
