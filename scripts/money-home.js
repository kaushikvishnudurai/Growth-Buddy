/* =====================================================================
   Growth Buddy — Money Buddy's Home card
   ---------------------------------------------------------------------
   Kept out of money.js so Home doesn't pull the ~6k-line Money screen into
   the boot chunk: everything the card paints comes from money-core.js.
   "Add expense" is the one thing that needs the screen's code (the expense
   modal), so it imports money.js on tap — precached like every lazy chunk,
   so offline it is a cache hit, not a network wait.
   ===================================================================== */
import { h, Icon, ProgressRing } from './gb-kit.js';
import { toast } from './toast.js';
import {
  normalizeMoney,
  applyCurrency,
  budgetStatus,
  buildInsights,
  fmt,
  todayKey,
  uid,
} from './money-core.js';
import { repeatExpense } from './nudges.js';

/* "You usually log 120 Coffee around now. Add it?" (repeatExpense, nudges.js).
   Add books it exactly as the expense form would; Not today hides it.
   ponytail: the dismissal is in memory, so a relaunch the same morning asks again;
   move it to ui_prefs if that turns out to nag. */
const skippedNudges = new Set(); // 'YYYY-MM-DD|note'

function RepeatExpenseNudge(money, onSaveMoney) {
  const today = todayKey();
  const guess = repeatExpense(money.expenses, today, new Date());
  if (!guess || skippedNudges.has(today + '|' + guess.note.toLowerCase())) return null;
  const node = h(
    'div',
    { class: 'gb-nudge', role: 'group', 'aria-label': 'Usual expense' },
    h('span', null, 'You usually log ' + fmt(guess.amount) + ' ' + guess.note + ' around now. Add it?'),
    h(
      'div',
      { class: 'gb-nudge-opts' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--compact',
          onclick: () => {
            const next = normalizeMoney(money);
            next.expenses.unshift({
              id: uid(),
              amount: guess.amount,
              category: guess.category,
              date: today,
              note: guess.note,
              ...(guess.accountId ? { accountId: guess.accountId } : {}),
              createdAt: Date.now(),
            });
            onSaveMoney(next, money);
            toast.success('Added ' + fmt(guess.amount) + ' ' + guess.note + '.');
          },
        },
        'Add'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-btn--compact',
          onclick: () => {
            skippedNudges.add(today + '|' + guess.note.toLowerCase());
            node.remove();
          },
        },
        'Not today'
      )
    )
  );
  return node;
}

function addExpense(money, onSaveMoney) {
  import('./money.js')
    .then((m) => m.openExpenseModal(money, onSaveMoney))
    .catch((err) => {
      console.error('Money failed to load', err);
      toast.error("Couldn't open the expense form. Check your connection and try again.");
    });
}

export function MoneyHomeCard({ money, onSaveMoney, onOpen }) {
  money = normalizeMoney(money);
  applyCurrency(money);
  const st = budgetStatus(money);
  const totalBudget = st.reduce((a, s) => a + s.budget, 0);
  const spentMonth = st.reduce((a, s) => a + s.spent, 0);
  const safe = totalBudget - spentMonth;
  const hasBudget = totalBudget > 0;
  const ringPct = hasBudget
    ? Math.max(0, Math.min(100, Math.round((safe / totalBudget) * 100)))
    : 0;
  const ringColor = safe >= 0 ? 'var(--success)' : 'var(--brand)';
  const insight = buildInsights(money)[0];
  const figure = hasBudget
    ? ProgressRing({
        value: ringPct,
        size: 72,
        stroke: 8,
        color: ringColor,
        children: [
          h(
            'div',
            { class: 'gb-money-mini-ring-val', style: { color: ringColor } },
            fmt(Math.max(0, safe))
          ),
        ],
      })
    : h(
        'div',
        { class: 'gb-money-mini-figure' },
        h('div', { class: 'gb-money-mini-spent' }, fmt(spentMonth)),
        h('div', { class: 'gb-money-mini-lbl' }, 'this month')
      );
  return h(
    'div',
    { class: 'gb-card gb-money-mini' },
    h(
      'button',
      {
        type: 'button',
        class: 'gb-money-mini-head',
        onclick: onOpen,
        'aria-label': 'Open Money Buddy',
      },
      h(
        'span',
        { class: 'gb-money-mini-eyebrow' },
        Icon('wallet', { size: 14, sw: 2.4 }),
        'Money Buddy'
      ),
      Icon('chevron-right', { size: 18, sw: 2.4 })
    ),
    h(
      'div',
      { class: 'gb-money-mini-body' },
      figure,
      h(
        'div',
        { class: 'gb-money-mini-main' },
        h(
          'div',
          { class: 'gb-money-mini-cap' },
          hasBudget ? (safe >= 0 ? 'safe to spend' : 'over budget') : 'spent so far'
        ),
        h(
          'div',
          { class: 'gb-money-mini-say' },
          insight ? insight.text : 'Track a little each day for clearer money.'
        )
      )
    ),
    h(
      'div',
      { class: 'gb-money-mini-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--compact',
          onclick: () => addExpense(money, onSaveMoney),
        },
        Icon('plus', { size: 14, sw: 2.6 }),
        'Add expense'
      ),
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--ghost gb-btn--compact', onclick: onOpen },
        'Open Money Buddy'
      )
    ),
    RepeatExpenseNudge(money, onSaveMoney)
  );
}
