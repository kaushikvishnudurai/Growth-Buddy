/* =====================================================================
   Growth Buddy — Money Buddy (AI-assisted money management)
   ---------------------------------------------------------------------
   Calm, encouraging money section. Money framed as growth, never guilt.
   Persisted server-side as one JSON doc (GET/PUT /api/money) via app.js;
   every insight here is a client-side heuristic over that doc.
   ponytail: heuristics, not an LLM. Real OCR / NL understanding would need
   a vision/LLM endpoint — marked at each spot below.
   ===================================================================== */
import { h, Icon, Card, ProgressRing, refreshIcons, openModal, Thinking } from './gb-kit.js';
import { toast } from './toast.js';
import { shareStoryCard, _demo as _shareCardDemo } from './share-card.js';
import {
  CUR,
  cur,
  applyCurrency,
  PALETTE,
  pad2,
  dkey,
  todayKey,
  parseKey,
  addDays,
  diffDays,
  thisMonthPrefix,
  lastMonthPrefix,
  daysInMonth,
  weekStartKey,
  lastNDays,
  fmt,
  homeCur,
  accCurrency,
  fxRate,
  toHomeAmount,
  editedHomeAmount,
  fmtIn,
  fmtBalance,
  readAmount,
  readWhole,
  fmtDateShort,
  uid,
  clone,
  slug,
  emptyMoney,
  normalizeMoney,
  removeDocItem,
  LEDGER_ARRAYS,
  stable,
  goalSaved,
  mergedCats,
  catOf,
  inRange,
  sumAmt,
  byCategory,
  pctChange,
  suggestCategory,
  buildInsights,
  budgetStatus,
} from './money-core.js';
// The document model moved to money-core.js (boot chunk); re-exported so the tests and
// any import of these from money.js keep working.
export {
  emptyMoney,
  normalizeMoney,
  TOMBSTONED,
  removeDocItem,
  LEDGER_ARRAYS,
  ledgerDiff,
  applyLedgerDiff,
  docPart,
  mergeMoney,
} from './money-core.js';

/* 4 — purchase advisor: a thoughtful recommendation, not yes/no. */
function advise(money, item, price, reason) {
  price = Math.round(Number(price) || 0);
  const txt = (item + ' ' + (reason || '')).toLowerCase();
  const cat = suggestCategory(txt, money) || 'others';
  const wantWords = [
    'want',
    'treat',
    'cool',
    'impulse',
    'tempt',
    'sale',
    'discount',
    'fun',
    'bored',
    'reward',
    'deserve',
    'trend',
    'latest',
    'upgrade',
  ];
  const needWords = [
    'need',
    'required',
    'broke',
    'broken',
    'replace',
    'work',
    'essential',
    'medicine',
    'health',
    'study',
    'repair',
    'emergency',
    'must',
  ];
  let score = 0;
  wantWords.forEach((w) => txt.includes(w) && score++);
  needWords.forEach((w) => txt.includes(w) && score--);
  const isWant = score > 0;
  const st = budgetStatus(money).find((s) => s.cat.key === cat);
  const remaining = st ? st.remaining : 0;
  const hasBudget = st && st.base > 0;
  const fits = !hasBudget || price <= remaining;
  const goals = (money.goals || []).filter((g) => goalSaved(g) < (g.target || 0));
  const goal = goals.sort((a, b) => goalSaved(b) - goalSaved(a))[0] || null;
  const reasons = [];
  reasons.push(
    isWant
      ? `This reads more like a want than a need — and wants are allowed, in balance.`
      : `This sounds like a genuine need, which makes it easier to justify.`
  );
  if (hasBudget)
    reasons.push(
      fits
        ? `It fits your ${catOf(cat, money).label} budget — ${fmt(remaining)} is still free this month.`
        : `It's ${fmt(price - remaining)} over what's left in your ${catOf(cat, money).label} budget this month.`
    );
  else
    reasons.push(
      `You haven't set a ${catOf(cat, money).label} budget yet, so I can't check the fit — setting one would help.`
    );
  if (goal) {
    const left = Math.max(0, (goal.target || 0) - goalSaved(goal));
    reasons.push(
      `Skipping it would cover ${Math.min(100, Math.round((price / Math.max(1, left)) * 100))}% of what's left on "${goal.name}".`
    );
    // The same price in time: how long your recent saving pace takes to put it back.
    const weekly = goalPlan(goal).weeklyRate;
    if (weekly > 0) {
      const days = Math.max(1, Math.round((Math.min(price, left) / weekly) * 7));
      reasons.push(
        `At your pace of ${fmt(weekly)} a week, buying it puts "${goal.name}" about ${days} day${days === 1 ? '' : 's'} further away.`
      );
    }
  }
  let verdict, tone;
  if (!isWant && fits) {
    verdict = 'Go for it';
    tone = 'good';
  } else if (isWant && fits && !goal) {
    verdict = 'Reasonable — enjoy it mindfully';
    tone = 'info';
  } else if (isWant && (!fits || goal)) {
    verdict = 'Maybe sleep on it';
    tone = 'warn';
  } else {
    verdict = 'Worth a short pause';
    tone = 'warn';
  }
  const closer =
    tone === 'good'
      ? `If it's useful and within budget, it's a fair call.`
      : `Try waiting 48 hours — if you still want it and the budget allows, it's a healthier yes.`;
  return { verdict, tone, reasons, closer, cat, price, isWant, fits };
}

/* 5 / 17 — savings plan + ETA (no income needed: from contributions / dueDate). */
function goalPlan(goal) {
  const saved = goalSaved(goal);
  const target = Number(goal.target) || 0;
  const remaining = Math.max(0, target - saved);
  const pct = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;
  const since = dkey(addDays(new Date(), -56));
  const recent = (goal.contribs || []).filter((c) => c.date >= since);
  const weeklyRate = recent.length ? Math.round(sumAmt(recent) / 8) : 0;
  // 17 Future Purchase Planner: if a target date is set, pace to hit it.
  let requiredWeekly = 0;
  let etaKey = null;
  if (goal.dueDate && remaining > 0) {
    const weeks = Math.max(1, Math.ceil(diffDays(goal.dueDate, todayKey()) / 7));
    requiredWeekly = Math.ceil(remaining / weeks);
    etaKey = goal.dueDate;
  }
  const suggestedWeekly = requiredWeekly || (remaining > 0 ? Math.ceil(remaining / 12) : 0);
  const planRate = weeklyRate > 0 ? weeklyRate : suggestedWeekly;
  if (!etaKey && remaining > 0 && planRate > 0)
    etaKey = dkey(addDays(new Date(), Math.ceil(remaining / planRate) * 7));
  return {
    saved,
    target,
    remaining,
    pct,
    weeklyRate,
    suggestedWeekly,
    requiredWeekly,
    requiredDaily: Math.ceil(suggestedWeekly / 7),
    etaKey,
    dueDate: goal.dueDate || null,
    done: remaining <= 0 && target > 0,
  };
}

/* 7 — spending personality. */
function personality(money) {
  const ex = money.expenses;
  if (ex.length < 8) return null;
  const mExp = inRange(ex, thisMonthPrefix() + '-01', todayKey());
  const list = mExp.length >= 6 ? mExp : ex.slice(0, 40);
  const total = sumAmt(list) || 1;
  const cc = byCategory(list, money);
  const share = (k) => cc[k] / total;
  const counts = {};
  list.forEach((e) => (counts[e.category] = (counts[e.category] || 0) + 1));
  const avgTxn = total / list.length;
  const budgetsSet = mergedCats(money).filter(
    (c) => (Number(money.budgets[c.key]) || 0) > 0
  ).length;
  const allUnder = budgetStatus(money)
    .filter((s) => s.base > 0)
    .every((s) => s.pct <= 100);
  const scores = {
    impulse:
      (share('shopping') + share('entertainment')) * 2 +
      (avgTxn < 300 && list.length > 15 ? 0.6 : 0),
    planner: budgetsSet * 0.3 + (allUnder ? 1.2 : 0) + (money.goals.length ? 0.5 : 0),
    convenience: share('food') * 2 + ((counts.food || 0) > list.length * 0.4 ? 0.8 : 0),
    reward: share('entertainment') * 1.6 + share('shopping') * 0.6,
    budget_conscious: (budgetsSet >= 3 && allUnder ? 1.6 : 0) + (avgTxn < 200 ? 0.6 : 0),
  };
  const META = {
    impulse: {
      label: 'Impulse Shopper',
      icon: 'zap',
      blurb: 'You move fast on shopping and fun — spontaneous and generous.',
      tips: [
        'Add a 24-hour pause before non-essentials.',
        'Use the Purchase Advisor before tapping buy.',
      ],
    },
    planner: {
      label: 'Planner',
      icon: 'target',
      blurb: 'You set budgets and stick close to them. Money behaves around you.',
      tips: ['Channel the surplus into a savings goal.', 'Review budgets monthly and nudge them.'],
    },
    convenience: {
      label: 'Convenience Spender',
      icon: 'utensils',
      blurb: 'Food and quick options take a big share — you value your time.',
      tips: ['Try cooking two more meals a week.', 'Set a realistic Food budget to track it.'],
    },
    reward: {
      label: 'Reward Spender',
      icon: 'sparkles',
      blurb: 'You treat yourself often — celebrating effort matters to you.',
      tips: ['Plan one intentional treat per week.', 'Match each treat with a small goal deposit.'],
    },
    budget_conscious: {
      label: 'Budget Conscious',
      icon: 'leaf',
      blurb: 'You spend carefully and stay well within your limits.',
      tips: ['Make sure you still enjoy a little.', 'Put your discipline toward a bigger goal.'],
    },
  };
  const best = Object.keys(scores).sort((a, b) => scores[b] - scores[a])[0];
  return Object.assign({ type: best }, META[best]);
}

function setAsideInRange(money, from, to) {
  return (money.goals || []).reduce(
    (a, g) => a + sumAmt((g.contribs || []).filter((c) => c.date >= from && c.date <= to)),
    0
  );
}
function setAsideThisMonth(money) {
  return setAsideInRange(money, thisMonthPrefix() + '-01', todayKey());
}

/* ---- Income + loans (cumulative; loans are outstanding until settled) ---- */
function incomeInRange(money, from, to) {
  return (money.income || []).filter((e) => e.date >= from && e.date <= to);
}
function sumIncome(list) {
  return list.reduce((a, e) => a + (Number(e.amount) || 0), 0);
}
/* What is still owed on one loan: its amount less the part repayments
   (`repaid[{amount, date}]`), 0 once settled. Worked in paise like splitShares. */
function loanLeft(l) {
  if (!l || l.settled) return 0;
  const back = (Array.isArray(l.repaid) ? l.repaid : []).reduce(
    (a, r) => a + Math.round((Number(r.amount) || 0) * 100),
    0
  );
  return Math.max(0, Math.round((Number(l.amount) || 0) * 100) - back) / 100;
}
// Outstanding (not settled) loans in a direction: 'given' = lent out, 'received' = borrowed.
function loanOutstanding(money, direction) {
  return (money.loans || [])
    .filter((l) => l.direction === direction)
    .reduce((a, l) => a + loanLeft(l), 0);
}

/* 8 / 25 — weekly review + motivation. */
function weeklyReview(money) {
  const tw = weekStartKey();
  const today = todayKey();
  const cur = inRange(money.expenses, tw, today);
  const total = sumAmt(cur);
  const lwS = dkey(addDays(parseKey(tw), -7));
  const lwE = dkey(addDays(parseKey(tw), -1));
  const prevTotal = sumAmt(inRange(money.expenses, lwS, lwE));
  const setAside = setAsideInRange(money, tw, today);
  const cc = byCategory(cur, money);
  const topCat =
    mergedCats(money)
      .map((c) => ({ ...c, v: cc[c.key] }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)[0] || null;
  const wantCats = ['shopping', 'entertainment', 'others'];
  const biggest =
    cur
      .filter((e) => wantCats.includes(e.category))
      .sort((a, b) => (b.amount || 0) - (a.amount || 0))[0] || null;
  const streak = logStreak(money.expenses);
  const st = budgetStatus(money).filter((s) => s.base > 0);
  const underNow = st.filter((s) => s.pct <= 100);
  const positive =
    setAside > 0
      ? `You set aside ${fmt(setAside)} toward your goals.`
      : streak >= 3
        ? `You logged ${streak} days in a row — strong consistency.`
        : underNow.length
          ? `You're still within budget on ${underNow.length} categor${underNow.length === 1 ? 'y' : 'ies'}.`
          : `You started tracking — that's the hardest step.`;
  let improve = null;
  st.forEach((s) => {
    const weekPace = s.budget / 4.3;
    if (weekPace > 0 && cc[s.cat.key] > weekPace) {
      const over = Math.round((cc[s.cat.key] / weekPace - 1) * 100);
      if (!improve || over > improve.over) improve = { cat: s.cat, over };
    }
  });
  const improvement = improve
    ? `Ease ${improve.cat.label} next week — it's ${improve.over}% above its weekly pace.`
    : topCat
      ? `Keep an eye on ${topCat.label}; small trims there add up fast.`
      : `Log a little every day so next week's review is sharper.`;
  // 25 weekly motivation: one warm message from the week's trajectory.
  let motivation;
  if (prevTotal > 0 && total < prevTotal && setAside > 0)
    motivation = `You spent ${fmt(prevTotal - total)} less than last week and set aside ${fmt(setAside)}. You're building a strong habit — keep going!`;
  else if (prevTotal > 0 && total < prevTotal)
    motivation = `You spent ${fmt(prevTotal - total)} less than last week. Momentum looks great!`;
  else if (setAside > 0)
    motivation = `You moved ${fmt(setAside)} toward your goals this week. Future-you says thanks.`;
  else if (streak >= 3)
    motivation = `${streak} days of logging — consistency like this is what changes the numbers.`;
  else motivation = `Every expense you log makes next week clearer. Proud of you for showing up.`;
  return {
    total,
    prevTotal,
    setAside,
    topCat,
    biggest,
    positive,
    improvement,
    motivation,
    count: cur.length,
  };
}

/* ---- Recurring income & expenses ----
   A rule: {id, kind:'income'|'expense', amount, category, accountId?, day: 1-28 |
   'last', note, active, start:'YYYY-MM-DD', postedFor?:'YYYY-MM'}. For income,
   `category` is the source ('salary' | 'other'). On a Money visit each active rule
   whose day this month has come is posted as a ledger row with the id
   `rec-<ruleId>-<YYYY-MM>`: deterministic, so two devices posting the same month
   upsert one row, never two. `postedFor` (forward-only, kept by mergeMoney) stops a
   deleted occurrence coming back. Only the current month is posted: a missed
   month is not backfilled, because the person has most likely logged it by hand.
   A day before `start` (the rule was made after it) waits for next month.
   Amounts are in the home currency. */
function recurDate(rule, ym) {
  const [y, mo] = ym.split('-').map(Number);
  const dim = new Date(y, mo, 0).getDate();
  const d = rule.day === 'last' ? dim : Math.min(dim, Math.max(1, Math.round(Number(rule.day) || 1)));
  return ym + '-' + String(d).padStart(2, '0');
}
function recurId(rule, ym) {
  return 'rec-' + rule.id + '-' + ym;
}
function recurOpen(money, rule, ym) {
  if (!rule || !rule.active || !(Number(rule.amount) > 0)) return false;
  if ((rule.postedFor || '') >= ym) return false;
  const date = recurDate(rule, ym);
  if (rule.start && date < rule.start) return false;
  const list = rule.kind === 'income' ? money.income : money.expenses;
  return !(list || []).some((x) => x && x.id === recurId(rule, ym));
}
/* Occurrences due by today and not posted: [{rule, id, date}]. Pure. */
function recurringDue(money, today = todayKey()) {
  const ym = today.slice(0, 7);
  return (money.recurring || [])
    .filter((r) => recurOpen(money, r, ym) && recurDate(r, ym) <= today)
    .map((rule) => ({ rule, id: recurId(rule, ym), date: recurDate(rule, ym) }));
}
/* Still ahead this month: the forecast's "to come". */
function recurringToCome(money, today = todayKey()) {
  const ym = today.slice(0, 7);
  return (money.recurring || [])
    .filter((r) => recurOpen(money, r, ym) && recurDate(r, ym) > today)
    .map((rule) => ({ rule, id: recurId(rule, ym), date: recurDate(rule, ym) }));
}
/* Posts what recurringDue found into `m` (mutates). Returns how many. */
function materialiseRecurring(m, today = todayKey()) {
  const due = recurringDue(m, today);
  const ym = today.slice(0, 7);
  for (const { rule, id, date } of due) {
    const acc = rule.accountId ? { accountId: rule.accountId } : {};
    if (rule.kind === 'income') {
      m.income = [
        {
          id,
          amount: Number(rule.amount),
          source: rule.category === 'other' ? 'other' : 'salary',
          label: rule.note || (rule.category === 'other' ? 'Income' : 'Salary'),
          date,
          ...acc,
        },
      ].concat(m.income || []);
    } else {
      m.expenses = [
        {
          id,
          amount: Number(rule.amount),
          category: rule.category || 'others',
          note: rule.note || '',
          date,
          ...acc,
        },
      ].concat(m.expenses || []);
    }
    const x = (m.recurring || []).find((r) => r.id === rule.id);
    if (x) x.postedFor = ym;
  }
  return due.length;
}

/* 9 / 24 — monthly forecast.

   Only day-to-day spending is extrapolated. Fixed amounts are added as they are:
   - a bill already paid this month (its expense id is `sub-<id>-<month>`) is in
     `spent` once and not projected again; a bill not yet paid is `committed`.
     (Counting every subscription as committed on top of a run-rate that already
     held the paid ones counted each paid bill about twice.)
   - per category, a one-off: the single largest expense, when it is more than
     half of that category's month so far, is taken as a one-off and not
     multiplied by the days left. A ₹6,000 shoe on the 2nd projected ₹90,000 of
     shopping; now it projects ₹6,000 plus the pace of the rest.
   Pure; `forecast` reads the clock only through todayKey / daysInMonth. */
// A bill or a repeat: a fixed amount on a fixed day, never a pace to multiply.
const isBillExpense = (e) =>
  typeof e.id === 'string' && (e.id.startsWith('sub-') || e.id.startsWith('rec-'));
function projectSpend(list, day, dim) {
  const fixed = list.filter(isBillExpense);
  let rest = list.filter((e) => !isBillExpense(e));
  const total = sumAmt(rest);
  let oneOff = 0;
  if (rest.length) {
    const big = rest.reduce((a, e) => (Number(e.amount) > Number(a.amount) ? e : a));
    if (Number(big.amount) > total / 2) {
      oneOff = Number(big.amount) || 0;
      rest = rest.filter((e) => e !== big);
    }
  }
  const pace = day > 0 ? (sumAmt(rest) / day) * dim : sumAmt(rest);
  return Math.round(sumAmt(fixed) + oneOff + pace);
}
function forecast(money) {
  const mStart = thisMonthPrefix() + '-01';
  const today = todayKey();
  const month = thisMonthPrefix();
  const mExp = inRange(money.expenses, mStart, today);
  const spent = sumAmt(mExp);
  const day = new Date().getDate();
  const dim = daysInMonth();
  // Bills still to pay this month ('YYYY-MM' strings order like months).
  const bills = (money.subscriptions || [])
    .filter((s) => (s.paidFor || '') < month)
    .reduce((a, s) => a + (Number(s.amount) || 0), 0);
  // Repeats whose day is still ahead this month (posted ones are already in mExp).
  const toCome = recurringToCome(money);
  const recurringOut = sumAmt(toCome.filter((x) => x.rule.kind === 'expense').map((x) => x.rule));
  const expectedIncome = sumAmt(toCome.filter((x) => x.rule.kind === 'income').map((x) => x.rule));
  const committed = bills + recurringOut;
  const projected = projectSpend(mExp, day, dim) + committed;
  // Rollover moves a limit, so the warning reads the limit budgetStatus shows.
  const limits = new Map(budgetStatus(money).map((s) => [s.cat.key, s]));
  const willExceed = [];
  // Same bucketing as byCategory: an unknown tag counts as Others.
  const known = new Set(mergedCats(money).map((c) => c.key));
  const byCat = (k) => mExp.filter((e) => (known.has(e.category) ? e.category : 'others') === k);
  mergedCats(money).forEach((c) => {
    const st = limits.get(c.key);
    const b = st && st.base > 0 ? st.budget : 0;
    if (st && st.base > 0) {
      const proj = projectSpend(byCat(c.key), day, dim);
      if (proj > b) willExceed.push({ cat: c, proj, budget: b });
    }
  });
  const disc = ['shopping', 'entertainment', 'food', 'others'];
  const topDisc = disc
    .map((k) => ({ k, proj: projectSpend(byCat(k), day, dim) }))
    .sort((a, b) => b.proj - a.proj)[0];
  const potential = topDisc ? Math.round(topDisc.proj * 0.2) : 0;
  return {
    spent,
    projected,
    committed,
    bills,
    recurringOut,
    expectedIncome,
    willExceed,
    potential,
    topDisc: topDisc && topDisc.proj > 0 ? catOf(topDisc.k, money) : null,
    hasData: mExp.length > 0,
  };
}

/* 10 — gamification. */
function logStreak(expenses) {
  const days = new Set(expenses.map((e) => e.date));
  if (!days.size) return 0;
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(dkey(cursor))) cursor = addDays(cursor, -1);
  while (days.has(dkey(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
function bestStreak(expenses) {
  const days = Array.from(new Set(expenses.map((e) => e.date))).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  days.forEach((k) => {
    run = prev && diffDays(k, prev) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  });
  return best;
}
function levelInfo(money) {
  const n = money.expenses.length;
  return {
    level: Math.floor(n / 15) + 1,
    pct: Math.round(((n % 15) / 15) * 100),
    toNext: 15 - (n % 15),
  };
}
function badges(money) {
  const streak = logStreak(money.expenses);
  const st = budgetStatus(money).filter((s) => s.base > 0);
  const withinBudget = st.length > 0 && st.every((s) => s.pct <= 100);
  const tw = weekStartKey();
  const today = todayKey();
  const wkExp = inRange(money.expenses, tw, today);
  const wantThisWeek = wkExp.some((e) => ['shopping', 'entertainment'].includes(e.category));
  const goalMilestone = (money.goals || []).some((g) => goalPlan(g).pct >= 50);
  const challengeWon = (money.challenges || []).some(
    (c) => challengeProgress(money, c).state === 'won'
  );
  return [
    {
      key: 'streak7',
      icon: 'flame',
      label: '7-Day Streak',
      desc: 'Log expenses 7 days running',
      earned: streak >= 7,
      progress: Math.min(7, streak) + '/7',
    },
    {
      key: 'within',
      icon: 'target',
      label: 'Within Budget',
      desc: 'Stay under every budget this month',
      earned: withinBudget,
    },
    {
      key: 'no_want',
      icon: 'leaf',
      label: 'Mindful Week',
      desc: 'No shopping/entertainment splurge this week',
      earned: !wantThisWeek && wkExp.length > 0,
    },
    {
      key: 'goal50',
      icon: 'trophy',
      label: 'Goal Milestone',
      desc: 'Reach 50% on a savings goal',
      earned: goalMilestone,
    },
    {
      key: 'challenge',
      icon: 'shield-check',
      label: 'Challenge Champ',
      desc: 'Win a money challenge',
      earned: challengeWon,
    },
  ];
}

/* 11 / 15 — challenge progress (no-spend, daily cap, monthly save/log/reduce). */
function distinctLogDaysThisMonth(money) {
  return new Set(inRange(money.expenses, thisMonthPrefix() + '-01', todayKey()).map((e) => e.date))
    .size;
}
function challengeProgress(money, ch) {
  const today = todayKey();
  const start = ch.start || today;
  const end = ch.end || today;
  const scopeMatch = (e) => ch.scope === 'all' || e.category === ch.scope;
  const within = inRange(money.expenses, start, today < end ? today : end).filter(scopeMatch);
  const elapsed = Math.max(0, diffDays(today < end ? today : end, start) + 1);
  const totalDays = Math.max(1, diffDays(end, start) + 1);
  const timePct = Math.min(100, Math.round((elapsed / totalDays) * 100));

  if (ch.kind === 'nospend') {
    const broken = within.some((e) => (Number(e.amount) || 0) > 0);
    const state = broken ? 'broken' : today > end ? 'won' : 'active';
    return {
      state,
      pct: broken ? 100 : timePct,
      detail: broken
        ? 'A spend slipped in — restart anytime.'
        : `${elapsed}/${totalDays} days clean`,
    };
  }
  if (ch.kind === 'cap') {
    const spent = sumAmt(within);
    const cap = Number(ch.amount) || 0;
    const broken = spent > cap;
    const state = broken ? 'broken' : today >= end ? 'won' : 'active';
    return {
      state,
      pct: cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0,
      detail: `${fmt(spent)} of ${fmt(cap)} cap`,
    };
  }
  if (ch.kind === 'save') {
    const saved = setAsideThisMonth(money);
    const target = Number(ch.amount) || 0;
    const pct = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;
    return {
      state: saved >= target && target > 0 ? 'won' : 'active',
      pct,
      detail: `${fmt(saved)} of ${fmt(target)} saved`,
    };
  }
  if (ch.kind === 'logdays') {
    const got = distinctLogDaysThisMonth(money);
    const target = Number(ch.days) || daysInMonth();
    const pct = Math.min(100, Math.round((got / target) * 100));
    return {
      state: got >= target ? 'won' : 'active',
      pct,
      detail: `${got} of ${target} days logged`,
    };
  }
  if (ch.kind === 'reduce') {
    const cc = byCategory(inRange(money.expenses, thisMonthPrefix() + '-01', today), money);
    const lc = byCategory(
      inRange(money.expenses, lastMonthPrefix() + '-01', lastMonthPrefix() + '-31'),
      money
    );
    const goal = Math.round((lc[ch.scope] || 0) * (1 - (Number(ch.pct) || 0) / 100));
    const now = cc[ch.scope] || 0;
    const ok = now <= goal;
    return {
      state: today > end && ok ? 'won' : !ok && today > end ? 'broken' : 'active',
      pct: goal > 0 ? Math.min(100, Math.round((now / goal) * 100)) : 0,
      detail: `${fmt(now)} now · aim ≤ ${fmt(goal)}`,
    };
  }
  return { state: 'active', pct: 0, detail: '' };
}

/* 11b — personalized challenge suggestions. Heuristics over the money doc:
   target the user's biggest / fastest-growing spend, and nudge saving/logging
   when those are weak. Falls back to common challenges when there isn't enough
   signal yet. ponytail: same heuristic engine as the other insights, not an LLM.
   Each suggestion carries a `reason` (why it was picked) and a `personalized`
   flag so the UI can mark "for you" vs "popular". */
const COMMON_CHALLENGES = [
  {
    label: 'No online shopping · 7 days',
    kind: 'nospend',
    scope: 'shopping',
    days: 7,
    reason: 'A classic reset for impulse buys.',
  },
  {
    label: 'No food delivery · this week',
    kind: 'nospend',
    scope: 'food',
    days: 7,
    reason: 'Cook in and watch the savings add up.',
  },
  {
    label: 'Spend under ₹500 today',
    kind: 'cap',
    scope: 'all',
    amount: 500,
    days: 1,
    reason: 'A simple one-day money detox.',
  },
  {
    label: 'Save ₹1,000 this month',
    kind: 'save',
    amount: 1000,
    reason: 'Pay your future self first.',
  },
  {
    label: 'Log every expense · 30 days',
    kind: 'logdays',
    days: 30,
    reason: 'Awareness is the first step.',
  },
];

const roundTo = (n, step) => Math.max(step, Math.round(n / step) * step);

function suggestChallenges(money) {
  const today = todayKey();
  const mExp = inRange(money.expenses, thisMonthPrefix() + '-01', today);
  // Not enough signal yet → keep it common (the requirement's fallback).
  if (mExp.length < 6) {
    return COMMON_CHALLENGES.map((c) => Object.assign({ personalized: false }, c));
  }
  const cc = byCategory(mExp, money);
  const lc = byCategory(
    inRange(money.expenses, lastMonthPrefix() + '-01', lastMonthPrefix() + '-31'),
    money
  );
  const cats = mergedCats(money);
  const out = [];
  const usedScope = new Set();

  // 1 — biggest spend category → trim it 15%.
  const ranked = cats
    .map((c) => ({ c, v: cc[c.key] || 0 }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);
  const top = ranked[0];
  if (top) {
    out.push({
      label: 'Cut ' + top.c.label + ' 15% this month',
      kind: 'reduce',
      scope: top.c.key,
      pct: 15,
      reason: top.c.label + ' is your biggest spend this month (' + fmt(top.v) + ').',
      personalized: true,
    });
    usedScope.add(top.c.key);
  }

  // 2 — fastest-rising category vs last month → pause it (discretionary) or trim.
  let rising = null;
  cats.forEach((c) => {
    if (lc[c.key] > 0 && cc[c.key] > 0) {
      const ch = pctChange(cc[c.key], lc[c.key]);
      if (ch >= 25 && (!rising || ch > rising.ch)) rising = { c, ch };
    }
  });
  if (rising && !usedScope.has(rising.c.key)) {
    if (['shopping', 'entertainment', 'food'].includes(rising.c.key)) {
      out.push({
        label: 'No ' + rising.c.label.toLowerCase() + ' · 7 days',
        kind: 'nospend',
        scope: rising.c.key,
        days: 7,
        reason: rising.c.label + ' is up ' + rising.ch + '% from last month — hit pause.',
        personalized: true,
      });
    } else {
      out.push({
        label: 'Cut ' + rising.c.label + ' 20% this month',
        kind: 'reduce',
        scope: rising.c.key,
        pct: 20,
        reason: rising.c.label + ' jumped ' + rising.ch + '% from last month.',
        personalized: true,
      });
    }
    usedScope.add(rising.c.key);
  }

  // 3 — nothing set aside yet → a savings challenge sized to ~10% of spend.
  if (setAsideThisMonth(money) === 0) {
    const target = roundTo(sumAmt(mExp) * 0.1, 500);
    out.push({
      label: 'Save ' + fmt(target) + ' this month',
      kind: 'save',
      amount: target,
      reason: "You haven't set anything aside yet this month.",
      personalized: true,
    });
  }

  // 4 — sparse logging → a log-streak challenge.
  const elapsed = new Date().getDate();
  const logged = distinctLogDaysThisMonth(money);
  if (elapsed >= 7 && logged < elapsed * 0.6) {
    out.push({
      label: 'Log every expense · 14 days',
      kind: 'logdays',
      days: 14,
      reason: "You've logged " + logged + ' of the last ' + elapsed + " days — let's tighten that.",
      personalized: true,
    });
  }

  // 5 — a daily cap ~20% under the recent average.
  const avgDaily = sumAmt(mExp) / Math.max(1, elapsed);
  if (avgDaily > 100) {
    const cap = roundTo(avgDaily * 0.8, 50);
    out.push({
      label: 'Spend under ' + fmt(cap) + ' today',
      kind: 'cap',
      scope: 'all',
      amount: cap,
      days: 1,
      reason: 'About 20% under your ' + fmt(avgDaily) + '/day average.',
      personalized: true,
    });
  }

  // Top up with common challenges that don't duplicate a suggested kind+scope.
  for (const c of COMMON_CHALLENGES) {
    if (out.length >= 5) break;
    if (!out.some((o) => o.kind === c.kind && (o.scope || 'all') === (c.scope || 'all'))) {
      out.push(Object.assign({ personalized: false }, c));
    }
  }
  return out.slice(0, 6);
}

/* 13 — one personalized tip per day (deterministic by day-of-month). */
function dailyTip(money) {
  const tips = [];
  const cc = byCategory(inRange(money.expenses, thisMonthPrefix() + '-01', todayKey()), money);
  if (cc.food > 0)
    tips.push(
      `Cooking at home twice this week could save around ${fmt(Math.round(cc.food * 0.15))}.`
    );
  const st = budgetStatus(money).filter((s) => s.base > 0);
  const under = st.find((s) => s.pct < 60);
  if (under) tips.push(`Your ${under.cat.label} spending is well under budget.`);
  const over = st.find((s) => s.pct > 90);
  if (over) tips.push(`${over.cat.label} is nearly maxed — a no-spend day there would help.`);
  if (setAsideThisMonth(money) === 0 && money.goals.length)
    tips.push(`Move even ${fmt(100)} to a goal today — small, steady beats big and rare.`);
  tips.push('Logging every expense for a week reveals where money quietly leaks.');
  tips.push('Pay your future self first: set aside before you spend, not after.');
  tips.push('A 24-hour pause turns most impulse buys into easy skips.');
  return tips[new Date().getDate() % tips.length];
}

/* 14 — financial health score (0–100) with component breakdown. */
function financialHealth(money) {
  const parts = [];
  const mExp = inRange(money.expenses, thisMonthPrefix() + '-01', todayKey());
  const st = budgetStatus(money).filter((s) => s.base > 0);
  // No budgets set => nothing to adhere to yet (the note says as much). Earlier
  // this defaulted to 12, inflating the score with points the user hadn't earned.
  // An unlogged month is not adherence either: every category sits at 0% spent,
  // which scored a perfect 25/25 and got announced as the user's strongest area
  // right next to "0/14 recent days logged".
  let adherence = 0;
  if (st.length && mExp.length) {
    adherence = Math.round((st.filter((s) => s.pct <= 100).length / st.length) * 25);
  }
  // `fix` names the one action that moves a part off zero; the card turns it into a
  // button, so the score says what to do instead of sending you to find it.
  parts.push({
    label: 'Budget adherence',
    score: adherence,
    max: 25,
    fix: !st.length ? 'budgets' : !mExp.length ? 'log' : null,
    note: !st.length
      ? 'Set budgets to score this'
      : mExp.length
        ? `${st.filter((s) => s.pct <= 100).length}/${st.length} within budget`
        : 'Log an expense to score this',
  });
  const recentSave = setAsideInRange(money, dkey(addDays(new Date(), -28)), todayKey());
  const sav = money.goals.length
    ? Math.min(20, Math.round((recentSave > 0 ? 12 : 0) + Math.min(8, money.goals.length * 4)))
    : 0;
  parts.push({
    label: 'Savings consistency',
    score: sav,
    max: 20,
    fix: money.goals.length ? null : 'goal',
    note: recentSave > 0 ? `${fmt(recentSave)} set aside lately` : 'Add to a goal to build this',
  });
  const logged14 = new Set(
    inRange(money.expenses, dkey(addDays(new Date(), -13)), todayKey()).map((e) => e.date)
  ).size;
  parts.push({
    label: 'Expense logging',
    score: Math.round((Math.min(14, logged14) / 14) * 20),
    max: 20,
    fix: logged14 ? null : 'log',
    note: `${logged14}/14 recent days logged`,
  });
  const cc = byCategory(mExp, money);
  const tot = sumAmt(mExp) || 1;
  const wantShare = ((cc.shopping || 0) + (cc.entertainment || 0)) / tot;
  parts.push({
    label: 'Spending habits',
    // No expenses this month => can't assess habits yet (no phantom 8 points).
    score: mExp.length ? Math.round((1 - Math.min(1, wantShare / 0.6)) * 15) : 0,
    max: 15,
    fix: mExp.length ? null : 'log',
    note: mExp.length ? `${Math.round(wantShare * 100)}% on wants` : 'Log to assess',
  });
  const gp = money.goals.length
    ? Math.round(
        (money.goals.reduce((a, g) => a + goalPlan(g).pct, 0) / money.goals.length / 100) * 20
      )
    : 0;
  parts.push({
    label: 'Goal progress',
    score: gp,
    max: 20,
    fix: money.goals.length ? null : 'goal',
    note: money.goals.length
      ? `avg ${Math.round(money.goals.reduce((a, g) => a + goalPlan(g).pct, 0) / money.goals.length)}% to target`
      : 'Create a goal to score this',
  });
  const score = parts.reduce((a, p) => a + p.score, 0);
  const weakest = parts.slice().sort((a, b) => a.score / a.max - b.score / b.max)[0];
  const strongest = parts.slice().sort((a, b) => b.score / b.max - a.score / a.max)[0];
  return { score, parts, weakest, strongest };
}

/* 16 — natural-language expense search (heuristic parser).
   ponytail: keyword/regex parsing, not real NLU. Swap for an LLM if you want
   free-form questions. */
function searchExpenses(money, query) {
  const q = String(query || '').toLowerCase();
  if (!q.trim())
    return {
      answer: 'Ask me about your spending — try "how much on food last month".',
      results: [],
    };
  let from = money.expenses.reduce((m, e) => (e.date < m ? e.date : m), todayKey());
  let to = todayKey();
  // Not "all time": the app holds the last ~13 months (the server's load window),
  // so the honest scope is "since" the earliest month actually loaded.
  const allLoaded = 'since ' + parseKey(from).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  let label = allLoaded;
  if (q.includes('today')) {
    from = to = todayKey();
    label = 'today';
  } else if (q.includes('last month')) {
    from = lastMonthPrefix() + '-01';
    to = lastMonthPrefix() + '-31';
    label = 'last month';
  } else if (q.includes('this month') || q.includes('month')) {
    from = thisMonthPrefix() + '-01';
    label = 'this month';
  } else if (q.includes('week')) {
    from = weekStartKey();
    label = 'this week';
  }
  if (
    q.includes('which category') ||
    (q.includes('category') && (q.includes('increase') || q.includes('most') || q.includes('rise')))
  ) {
    const cc = byCategory(inRange(money.expenses, thisMonthPrefix() + '-01', to), money);
    const lc = byCategory(
      inRange(money.expenses, lastMonthPrefix() + '-01', lastMonthPrefix() + '-31'),
      money
    );
    let best = null;
    mergedCats(money).forEach((c) => {
      const ch = pctChange(cc[c.key], lc[c.key]);
      if (cc[c.key] > 0 && (!best || ch > best.ch)) best = { c, ch, v: cc[c.key] };
    });
    return best
      ? {
          answer: `${best.c.label} increased the most this month (${best.ch >= 0 ? '+' : ''}${best.ch}%, now ${fmt(best.v)}).`,
          results: [],
        }
      : { answer: 'Not enough data yet to compare months.', results: [] };
  }
  // "What could I skip?" — the same rule as the day summary: a spend rated 2/5 or
  // less, or a want bought on impulse that you didn't then rate 4/5 or more (an
  // impulse buy you loved is not one to skip). Loose on spelling ("skkiped").
  // "What is NOT skippable?" / "what shouldn't I skip?" / "what was worth it?" is
  // the opposite question, and it used to fall into the skip branch below: the
  // matcher saw "skip" and answered with 183 things to cut. A negation BEFORE
  // "skip" flips it; "not worth it" stays a skip question.
  const negatedSkip =
    /(\bnot\b|n't\b|\bnever\b|\bcannot\b)[^?.!]{0,24}(sk+i+p|avoid|cut)/.test(q) ||
    /\b(un|non-?)(sk+i+p|avoid)/.test(q);
  // "Unavoidable" / "essential" asks for NEEDS, a different list from "worth it":
  // everything outside the wants. "unnecessary" never matches \bnecessar.
  const essentials =
    /\b(un|non-?)avoid|essential|\bnecessar|must.?(have|pay)|fixed (cost|spend)/.test(q);
  const worthIt = /worth (it|keeping|the money)|good spends?/.test(q) && !/not worth|n't worth/.test(q);
  if (essentials) {
    const WANTS = ['shopping', 'entertainment'];
    const needs = inRange(money.expenses, from, to)
      .filter((e) => !WANTS.includes(e.category))
      .map((e) => Object.assign({}, e, { why: 'a need' }))
      .sort((a, b) => b.amount - a.amount);
    const cats = [...new Set(needs.map((e) => catOf(e.category, money).label.toLowerCase()))];
    return needs.length
      ? {
          answer: `${needs.length} essential ${needs.length === 1 ? 'spend' : 'spends'} ${label}, ${fmt(sumAmt(needs))} in all: ${cats.join(', ')}. These are the needs, not the wants.`,
          results: needs.slice(0, 40),
        }
      : { answer: `No essential spends ${label}: everything logged was shopping or entertainment.`, results: [] };
  }
  if (negatedSkip || worthIt) {
    const keep = inRange(money.expenses, from, to)
      .map((e) => {
        const r = e.reflection || {};
        const sat = Number(r.satisfaction) || 0;
        const why = sat >= 4 ? 'rated ' + sat + '/5' : !sat && r.planned === true ? 'planned' : null;
        return why ? Object.assign({}, e, { why }) : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.amount - a.amount);
    if (!keep.length) {
      const rated = money.expenses.some((e) => e.reflection);
      return {
        answer: rated
          ? `Nothing ${label} stands out as worth it yet: nothing you rated 4/5 or more.`
          : 'Rate how a spend felt right after you add it, and I can tell you which ones were worth it.',
        results: [],
      };
    }
    return {
      answer: `${keep.length} ${keep.length === 1 ? 'spend' : 'spends'} ${label} worth keeping, ${fmt(sumAmt(keep))} in all. You rated them 4/5 or more, or planned them.`,
      results: keep.slice(0, 40),
    };
  }
  if (/\bsk+i+p+|avoid|cut (back|down)|unnecessar|wast(e|ed|ing)\b|regret|not worth/.test(q)) {
    const WANTS = ['shopping', 'entertainment'];
    const skip = inRange(money.expenses, from, to)
      .map((e) => {
        const r = e.reflection || {};
        const sat = Number(r.satisfaction) || 0;
        const why =
          sat >= 1 && sat <= 2
            ? 'rated ' + sat + '/5'
            : WANTS.includes(e.category) && r.planned === false && sat < 4
              ? 'unplanned ' + catOf(e.category, money).label.toLowerCase()
              : null;
        return why ? Object.assign({}, e, { why }) : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.amount - a.amount);
    if (!skip.length) {
      const rated = money.expenses.some((e) => e.reflection);
      return {
        answer: rated
          ? `Nothing ${label} stands out to skip: nothing you rated 2/5 or less, and no unplanned shopping or entertainment.`
          : 'Rate how a spend felt right after you add it, and I can point out what was worth skipping.',
        results: [],
      };
    }
    return {
      answer: `${skip.length} ${skip.length === 1 ? 'spend' : 'spends'} ${label} you could skip next time, ${fmt(sumAmt(skip))} in all. They felt low-value or were impulse wants.`,
      results: skip.slice(0, 40),
    };
  }
  let min = 0;
  let max = Infinity;
  const above = q.match(/(above|over|more than|greater than|>)\s*₹?\s*(\d[\d,]*)/);
  const below = q.match(/(below|under|less than|<)\s*₹?\s*(\d[\d,]*)/);
  if (above) min = Number(above[2].replace(/,/g, ''));
  if (below) max = Number(below[2].replace(/,/g, ''));
  const cat = mergedCats(money).find((c) => q.includes(c.label.toLowerCase()) || q.includes(c.key));
  const onMatch = q.match(
    /\bon\s+([a-z][a-z ]*?)(?:\s+(?:last|this|today|above|over|under|below|more|less)\b|\?|$)/
  );
  const term = onMatch ? onMatch[1].trim() : null;
  // Nothing in the question narrowed anything: no period, tag, amount or "on X".
  // Matching every expense and calling them "matching" answered a question nobody
  // asked. Try its meaningful words against notes and tags; failing that, say so.
  const understood = label !== allLoaded || cat || min > 0 || max < Infinity || term;
  let words = [];
  if (!understood) {
    const STOP = new Set(
      'what which where when who how much many did does do i my me the a an on in of for to is was were can could be been spend spent spending expense expenses money buy bought about show tell all any'.split(' ')
    );
    words = q.split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP.has(w));
    if (!words.length)
      return {
        answer:
          'I didn\'t catch that. Try "how much on food this month", "expenses over ₹500", or "what could I skip".',
        results: [],
      };
  }
  let results = inRange(money.expenses, from, to).filter((e) => {
    if (words.length) {
      const hay = ((e.note || '') + ' ' + catOf(e.category, money).label).toLowerCase();
      if (!words.some((w) => hay.includes(w))) return false;
    }
    const amt = Number(e.amount) || 0;
    if (amt < min || amt > max) return false;
    if (cat && e.category !== cat.key) return false;
    if (
      term &&
      !(
        (e.note || '').toLowerCase().includes(term) ||
        catOf(e.category, money).label.toLowerCase().includes(term)
      )
    )
      return false;
    return true;
  });
  results.sort((a, b) => (b.date < a.date ? -1 : 1));
  const total = sumAmt(results);
  const what = term ? `"${term}"` : cat ? cat.label : words.length ? `"${words.join(' ')}"` : 'matching expenses';
  const answer = results.length
    ? `You spent ${fmt(total)} on ${what} ${label} (${results.length} expense${results.length === 1 ? '' : 's'}).`
    : words.length
      ? `Nothing matches ${what}. Try "how much on food this month", "expenses over ₹500", or "what could I skip".`
      : `No ${what} found ${label}.`;
  return { answer, results: results.slice(0, 40) };
}

/* 19 — achievement timeline. */
function achievementTimeline(money) {
  const ev = [];
  const sorted = money.expenses.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (sorted.length)
    ev.push({
      date: sorted[0].date,
      icon: 'wallet',
      title: 'First expense logged',
      desc: 'Your money journey began.',
    });
  const best = bestStreak(money.expenses);
  if (best >= 3)
    ev.push({
      date: todayKey(),
      icon: 'flame',
      title: `${best}-day logging streak`,
      desc: 'Longest run so far.',
    });
  money.goals.forEach((g) => {
    if (goalPlan(g).done) {
      const last = (g.contribs || [])
        .map((c) => c.date)
        .sort()
        .pop();
      if (last)
        ev.push({
          date: last,
          icon: 'trophy',
          title: `Reached "${g.name}"`,
          desc: `Saved ${fmt(g.target)}.`,
        });
    }
  });
  const byMonth = {};
  money.goals.forEach((g) =>
    (g.contribs || []).forEach(
      (c) =>
        (byMonth[c.date.slice(0, 7)] = (byMonth[c.date.slice(0, 7)] || 0) + (Number(c.amount) || 0))
    )
  );
  const topMonth = Object.keys(byMonth).sort((a, b) => byMonth[b] - byMonth[a])[0];
  if (topMonth)
    ev.push({
      date: topMonth + '-15',
      icon: 'piggy-bank',
      title: `Best saving month: ${fmt(byMonth[topMonth])}`,
      desc: parseKey(topMonth + '-01').toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      }),
    });
  return ev.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/* 20 — budget recovery plan (a plan, not just a warning). */
function recoveryPlan(money) {
  const st = budgetStatus(money);
  const over = st.filter((s) => s.base > 0 && s.pct > 100);
  if (!over.length) return null;
  const totalOver = over.reduce((a, s) => a + (s.spent - s.budget), 0);
  const room = st
    .filter((s) => s.budget > 0 && s.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);
  const steps = [];
  let need = totalOver;
  over.forEach((s) =>
    steps.push({
      cat: s.cat,
      cut: s.spent - s.budget,
      text: `You're ${fmt(s.spent - s.budget)} over on ${s.cat.label}. Pause it where you can.`,
    })
  );
  for (const r of room) {
    if (need <= 0) break;
    const cut = Math.min(need, Math.round(r.remaining * 0.5));
    if (cut <= 0) continue;
    steps.push({
      cat: r.cat,
      cut,
      text: `Trim ${fmt(cut)} from ${r.cat.label} over two weeks (you have room there).`,
    });
    need -= cut;
  }
  return {
    totalOver,
    steps,
    summary: `You're ${fmt(totalOver)} over budget. Here's a gentle two-week plan to recover.`,
  };
}

/* 21 — personalized coach tips from patterns. */
function coachTips(money) {
  const out = [];
  const recent = inRange(money.expenses, dkey(addDays(new Date(), -27)), todayKey());
  if (recent.length >= 6) {
    let wkndDays = 0;
    let wdDays = 0;
    let wknd = 0;
    let wd = 0;
    const seen = {};
    recent.forEach((e) => {
      const dow = parseKey(e.date).getDay();
      const weekend = dow === 0 || dow === 6;
      if (weekend) wknd += Number(e.amount) || 0;
      else wd += Number(e.amount) || 0;
      if (!seen[e.date]) {
        seen[e.date] = 1;
        if (weekend) wkndDays++;
        else wdDays++;
      }
    });
    const wkndAvg = wkndDays ? wknd / wkndDays : 0;
    const wdAvg = wdDays ? wd / wdDays : 0;
    if (wkndAvg > wdAvg * 1.3 && wkndAvg > 0)
      out.push(
        `You often spend more on weekends (${fmt(wkndAvg)}/day vs ${fmt(wdAvg)} on weekdays). A weekend limit could help.`
      );
  }
  const st = budgetStatus(money).filter((s) => s.base > 0);
  if (st.length && st.every((s) => s.pct <= 100))
    out.push(`You've stayed within budget this month — keep it up!`);
  const cc = byCategory(inRange(money.expenses, thisMonthPrefix() + '-01', todayKey()), money);
  const lc = byCategory(
    inRange(money.expenses, lastMonthPrefix() + '-01', lastMonthPrefix() + '-31'),
    money
  );
  mergedCats(money).forEach((c) => {
    const ch = pctChange(cc[c.key], lc[c.key]);
    if (lc[c.key] > 0 && ch >= 30 && out.length < 3)
      out.push(`${c.label} is up ${ch}% from last month — worth a look.`);
  });
  if (!out.length)
    out.push(`Log a couple of weeks of spending and your insights will get more specific.`);
  return out.slice(0, 3);
}

/* 23 — goal simulator: project savings for a what-if. */
function goalSimulate(money, scenario) {
  const months = Math.max(1, Math.min(24, Number(scenario.months) || 6));
  const weeks = Math.round(months * 4.345);
  let perWeek = 0;
  let label = '';
  if (scenario.kind === 'perDay') {
    perWeek = (Number(scenario.perDay) || 0) * 7;
    label = `Saving ${fmt(scenario.perDay)}/day`;
  } else {
    const cc = byCategory(inRange(money.expenses, thisMonthPrefix() + '-01', todayKey()), money);
    const day = new Date().getDate();
    const monthlyProj = Math.round(((cc[scenario.cat] || 0) / day) * daysInMonth());
    const monthlySave = Math.round((monthlyProj * (Number(scenario.pct) || 0)) / 100);
    perWeek = Math.round(monthlySave / 4.345);
    label = `Cutting ${catOf(scenario.cat, money).label} by ${scenario.pct}%`;
  }
  const series = [];
  const stepEvery = Math.max(1, Math.ceil(weeks / 8));
  for (let w = 1; w <= weeks; w++)
    if (w % stepEvery === 0 || w === weeks) series.push({ label: 'wk ' + w, value: perWeek * w });
  return { series, total: perWeek * weeks, perWeek, months, label };
}

/* 24 — subscriptions: monthly total + what's due soon. */
function subsMonthlyTotal(money) {
  return (money.subscriptions || []).reduce((a, s) => a + (Number(s.amount) || 0), 0);
}
// One use of a subscription, from the uses a month the user told us. null = not told.
function costPerUse(sub) {
  const uses = Number(sub.usesPerMonth);
  return uses > 0 ? (Number(sub.amount) || 0) / uses : null;
}
/* A bill split evenly. Returns what each other person owes you, to the paisa
   (a loan's amount keeps paise, like readAmount's), and the odd paise go to
   them rather than to you, so the shares plus your own add up to the bill
   exactly. Worked in whole paise: float rupees would drift. */
export function splitShares(total, parties, includeMe) {
  const n = parties.length + (includeMe ? 1 : 0);
  if (!parties.length || !(total > 0)) return [];
  const paise = Math.round(total * 100);
  const base = Math.floor(paise / n);
  let extra = paise - base * n;
  return parties.map((party) => ({ party, amount: (base + (extra-- > 0 ? 1 : 0)) / 100 }));
}
/* Bills to show: due in the next 7 days, or overdue — this month's due day has
   passed and it isn't marked paid. An overdue bill used to roll to next month's
   occurrence (and, 3+ weeks out, drop off the list), so a missed payment
   silently disappeared. `month` is what "Mark as paid" stamps as paidFor;
   paid is forward-only, as on the server (SubscriptionDueScheduler.dueToday). */
function upcomingSubs(money) {
  const now = new Date();
  const today = now.getDate();
  const dim = daysInMonth();
  const thisMonth = dkey(now).slice(0, 7);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = dkey(next).slice(0, 7);
  const nextDim = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  return (
    (money.subscriptions || [])
      .map((s) => {
        const day = Number(s.dueDay) || 1;
        const due = Math.min(day, dim);
        const paid = (m) => (s.paidFor || '') >= m;
        if (due >= today || !paid(thisMonth)) {
          const inDays = due - today;
          return { sub: s, due, inDays, month: thisMonth, overdue: inDays < 0 };
        }
        // This month's is paid and behind us: the next one.
        const nextDue = Math.min(day, nextDim);
        return { sub: s, due: nextDue, inDays: dim - today + nextDue, month: nextMonth, overdue: false };
      })
      .filter((x) => x.inDays <= 7 && (x.sub.paidFor || '') < x.month)
      .sort((a, b) => a.inDays - b.inDays)
  );
}

/* 12 — reflection insights (triggers / satisfaction patterns). */
function reflectionInsights(money) {
  const withR = money.expenses.filter((e) => e.reflection && Number(e.reflection.satisfaction));
  if (withR.length < 3) return null;
  const avg = withR.reduce((a, e) => a + Number(e.reflection.satisfaction), 0) / withR.length;
  const unplanned = withR.filter((e) => e.reflection.planned === false);
  const unplannedAvg = unplanned.length
    ? unplanned.reduce((a, e) => a + Number(e.reflection.satisfaction), 0) / unplanned.length
    : null;
  const lowSat = withR.filter((e) => Number(e.reflection.satisfaction) <= 2);
  const catCount = {};
  lowSat.forEach((e) => (catCount[e.category] = (catCount[e.category] || 0) + 1));
  const trigger = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a])[0];
  const lines = [
    `Across ${withR.length} reflected buys, your average satisfaction is ${avg.toFixed(1)}/5.`,
  ];
  if (unplannedAvg != null)
    lines.push(
      `Unplanned buys average ${unplannedAvg.toFixed(1)}/5${unplannedAvg < avg ? ' — lower than planned ones.' : '.'}`
    );
  if (trigger)
    lines.push(
      `Low-satisfaction spends cluster in ${catOf(trigger, money).label}. A pause there could pay off.`
    );
  return lines;
}

/* =====================================================================
   Charts
   ===================================================================== */
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, String(attrs[k]));
  return e;
}
function donut(segments, centerLabel, centerSub) {
  const size = 168;
  const stroke = 20;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0);
  const svg = svgEl('svg', {
    width: size,
    height: size,
    viewBox: '0 0 ' + size + ' ' + size,
    class: 'gb-money-donut',
    role: 'img',
    'aria-label': 'Spending by category',
  });
  svg.appendChild(
    svgEl('circle', {
      cx: size / 2,
      cy: size / 2,
      r,
      fill: 'none',
      stroke: 'var(--surface-3)',
      'stroke-width': stroke,
    })
  );
  if (total > 0) {
    let offset = 0;
    segments.forEach((s) => {
      const len = (s.value / total) * c;
      if (len <= 0) return;
      svg.appendChild(
        svgEl('circle', {
          cx: size / 2,
          cy: size / 2,
          r,
          fill: 'none',
          stroke: s.color,
          'stroke-width': stroke,
          'stroke-linecap': 'round',
          'stroke-dasharray': Math.max(0, len - 2) + ' ' + (c - Math.max(0, len - 2)),
          'stroke-dashoffset': -offset,
          transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')',
        })
      );
      offset += len;
    });
  }
  const inner = h(
    'div',
    { class: 'gb-money-donut-center' },
    h('div', { class: 'gb-money-donut-val' }, centerLabel),
    centerSub ? h('div', { class: 'gb-money-donut-sub' }, centerSub) : null
  );
  return h('div', { class: 'gb-money-donut-wrap' }, svg, inner);
}
/* ₹1.2k / ₹3.4L: a label that fits over a 40px bar. */
function fmtCompact(n) {
  const v = Math.round(Number(n) || 0);
  if (v >= 100000)
    return cur + (v / 100000).toFixed(v >= 1000000 ? 0 : 1).replace(/\.0$/, '') + 'L';
  if (v >= 1000) return cur + (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return cur + v;
}

/* Seven days, each a button: the amount sits above its bar (a hover tooltip
   never shows on a phone), the weekday and date below it, and a tap opens that
   day's summary. */
/* An empty day is a "No log" day — worked out, not stored: the absence of any
   entry IS the record, and a row per empty day would go stale the moment a late
   expense is logged. A day marked no-spend on purpose says so instead. */
function weekBars(expenses, { selected, onPick, noSpendDays = [] } = {}) {
  const days = lastNDays(7);
  const sums = days.map((k) => sumAmt(expenses.filter((e) => e.date === k)));
  // One rent day would flatten the other six into slivers. When the biggest day
  // is over 3x the next, the scale stops at 1.5x the next and that bar is drawn
  // cut off (its label still says the real amount), so the ordinary days stay readable.
  const sorted = sums.slice().sort((a, b) => b - a);
  const scale = sorted[0] > sorted[1] * 3 && sorted[1] > 0 ? sorted[1] * 1.5 : Math.max(1, sorted[0]);
  const today = todayKey();
  return h(
    'div',
    { class: 'gb-money-bars', role: 'group', 'aria-label': 'Spending, last 7 days' },
    days.map((k, i) => {
      const d = parseKey(k);
      return h(
        'button',
        {
          type: 'button',
          class:
            'gb-money-bar-col' +
            (k === today ? ' is-today' : '') +
            (k === selected ? ' is-selected' : '') +
            (sums[i] ? '' : ' is-zero') +
            (!sums[i] && noSpendDays.includes(k) ? ' is-nospend' : '') +
            (sums[i] > scale ? ' is-clipped' : ''),
          'aria-pressed': String(k === selected),
          'aria-label':
            d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) +
            ', ' +
            (sums[i] ? fmt(sums[i]) : noSpendDays.includes(k) ? 'no-spend day' : 'no log') +
            '. Show summary',
          onclick: onPick ? () => onPick(k) : undefined,
        },
        h(
          'span',
          { class: 'gb-money-bar-amt' },
          sums[i] ? fmtCompact(sums[i]) : noSpendDays.includes(k) ? 'No spend' : 'No log'
        ),
        h(
          'span',
          { class: 'gb-money-bar-track' },
          h('span', {
            class: 'gb-money-bar-fill',
            style: { height: Math.max(3, Math.min(100, Math.round((sums[i] / scale) * 100))) + '%' },
          })
        ),
        h(
          'span',
          { class: 'gb-money-bar-day' },
          k === today ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })
        ),
        h('span', { class: 'gb-money-bar-date' }, String(d.getDate()))
      );
    })
  );
}
function lineChart(series, color) {
  const W = 320;
  const H = 90;
  const PX = 6;
  const PY = 10;
  if (series.length < 2)
    return h('div', { class: 'gb-money-empty' }, 'Adjust the numbers to see a projection.');
  const max = Math.max(...series.map((s) => s.value)) || 1;
  const x = (i) => PX + (i / (series.length - 1)) * (W - 2 * PX);
  const y = (v) => PY + (1 - v / max) * (H - 2 * PY);
  const svg = svgEl('svg', {
    viewBox: '0 0 ' + W + ' ' + H,
    class: 'gb-money-line',
    role: 'img',
    'aria-hidden': 'true',
  });
  const area =
    'M ' +
    x(0).toFixed(1) +
    ' ' +
    (H - PY) +
    ' ' +
    series.map((s, i) => 'L ' + x(i).toFixed(1) + ' ' + y(s.value).toFixed(1)).join(' ') +
    ' L ' +
    x(series.length - 1).toFixed(1) +
    ' ' +
    (H - PY) +
    ' Z';
  svg.appendChild(svgEl('path', { d: area, fill: color, 'fill-opacity': '0.12' }));
  svg.appendChild(
    svgEl('polyline', {
      points: series.map((s, i) => x(i).toFixed(1) + ',' + y(s.value).toFixed(1)).join(' '),
      fill: 'none',
      stroke: color,
      'stroke-width': '2.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    })
  );
  return svg;
}

/* =====================================================================
   Local modal + segmented
   ===================================================================== */
/* Money's dialogs are the shared one; only the wording of a failed save is
   this module's. Returns `{ close }` because that is what the call sites here
   destructure. */
/* ---- Accounts: where the money physically is ---- */
const ACCOUNT_ICON = { cash: 'banknote', bank: 'landmark', card: 'credit-card', wallet: 'wallet' };
const ACCOUNT_KIND_LABEL = { cash: 'Cash', bank: 'Bank', card: 'Card', wallet: 'UPI / wallet' };
function activeAccounts(money) {
  return (money.accounts || []).filter((a) => !a.archived);
}
function accountOf(money, id) {
  return (money.accounts || []).find((a) => a.id === id) || null;
}
/* "Paid from" / "Received in". Null node when there are no accounts yet (offline
   first run): an entry without one still saves, it just isn't counted in a balance. */
function accountPicker(money, initial, onChange) {
  const list = activeAccounts(money);
  // An entry booked to an archived account keeps it: falling back to list[0]
  // would silently move (and re-currency) the entry on an unrelated edit.
  const held = !list.some((a) => a.id === initial) && accountOf(money, initial);
  if (held) list.push(held);
  if (!list.length) return { node: null, get: () => null, set() {}, disable() {} };
  const start = list.some((a) => a.id === initial) ? initial : list[0].id;
  const seg = segmented(
    list.map((a) => ({ value: a.id, label: a.name })),
    start,
    onChange
  );
  const btns = [...seg.node.children];
  return {
    node: seg.node,
    get: seg.get,
    set: (id) => {
      const i = list.findIndex((a) => a.id === id);
      if (i >= 0) btns[i].click();
    },
    // One account can't be both ends of a move: its button is off in the other picker.
    disable: (id) =>
      btns.forEach((b, i) => {
        b.disabled = list[i].id === id;
      }),
  };
}
/* A loan's money through your accounts, as transfers with one side only (never
   spending, never income; the ledger takes a transfer with just `from` or just `to`):
   - the loan itself, id `loan-<id>`, on its date, when it names an account: lent =
     out of `accountId` (no "to"), borrowed = into it (no "from");
   - each repayment `loan-<id>-r<i>`, on the day it came back / was paid, through its
     own account (`repaid[i].accountId`, else the loan's): lent = back in, borrowed =
     out. A repayment with no account moves nothing;
   - a loan settled before repayments were recorded (no `final` repayment) gets
     `loan-<id>-s` for the rest, through the loan's account on the loan's date, so its
     balance comes out where it always did.
   `gone` (the loan was deleted) removes every move. Rebuilt whole on each call, so
   calling it twice is the same as once. */
function loanMove(m, loan, gone) {
  if (!loan) return;
  const id = 'loan-' + loan.id;
  m.transfers = (m.transfers || []).filter((t) => t.id !== id && !String(t.id).startsWith(id + '-'));
  if (gone) return;
  const lent = loan.direction === 'given';
  const moves = [];
  const move = (tid, amount, accountId, date, note, back) => {
    if (!accountId || !(amount > 0)) return;
    // Out of the account when lending or paying back; into it when borrowing or repaid.
    const out = lent !== back;
    moves.push({ id: tid, amount, ...(out ? { from: accountId } : { to: accountId }), date, note });
  };
  move(id, Number(loan.amount) || 0, loan.accountId, loan.date, (lent ? 'Lent to ' : 'Borrowed from ') + loan.party, false);
  const repaid = Array.isArray(loan.repaid) ? loan.repaid : [];
  repaid.forEach((r, i) =>
    move(
      id + '-r' + i,
      Math.round((Number(r.amount) || 0) * 100) / 100,
      r.accountId || loan.accountId,
      r.date || loan.date,
      (lent ? 'Repaid by ' : 'Repaid to ') + loan.party,
      true
    )
  );
  if (loan.settled && !repaid.some((r) => r.final)) {
    const back = repaid.reduce((a, r) => a + Math.round((Number(r.amount) || 0) * 100), 0);
    const rest = Math.max(0, Math.round((Number(loan.amount) || 0) * 100) - back) / 100;
    move(id + '-s', rest, loan.accountId, loan.date, 'Settled with ' + loan.party, true);
  }
  m.transfers = moves.concat(m.transfers);
}
/* A transfer between two of your accounts, as opposed to a loan's one-sided move. */
const isMove = (t) => !!(t && t.from && t.to);
function firstOfKind(money, kinds) {
  const a = activeAccounts(money).find((x) => kinds.includes(x.kind));
  return a ? a.id : null;
}

function openMoneyModal(opts) {
  return { close: openModal(opts) };
}

// Module level (not inside ScreenMoney) so the customise pane's tag manager uses it too.
function confirmDelete(title, body, onConfirm) {
  openMoneyModal({
    title,
    body: h('div', { class: 'gb-note-hint' }, body),
    primary: 'Delete',
    destructive: true,
    onPrimary: onConfirm,
  });
}

function segmented(options, initial, onChange) {
  let selected = initial;
  const segs = {};
  const wrap = h('div', { class: 'gb-segmented', role: 'radiogroup' });
  options.forEach((opt) => {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'gb-seg' + (opt.value === selected ? ' is-on' : ''),
        role: 'radio',
        'aria-checked': String(opt.value === selected),
        onclick: () => {
          selected = opt.value;
          for (const k in segs) {
            const on = k === opt.value;
            segs[k].classList.toggle('is-on', on);
            segs[k].setAttribute('aria-checked', String(on));
          }
          if (onChange) onChange(opt.value);
        },
      },
      opt.label
    );
    segs[opt.value] = btn;
    wrap.appendChild(btn);
  });
  return { node: wrap, get: () => selected };
}

/* Wrapping tag chip picker — replaces the overflowing segmented control for the
   variable-length (and user-extendable) tag list. allowCreate adds an inline
   "+ New" tag affordance so categories can be customized right from the picker. */
function tagPicker(money, save, opts) {
  opts = opts || {};
  const all = mergedCats(money);
  let selected = opts.initial && all.some((c) => c.key === opts.initial) ? opts.initial : 'others';
  const wrap = h('div', { class: 'gb-money-tagpick' });
  const chips = h('div', {
    class: 'gb-money-tagpick-chips',
    role: 'radiogroup',
    'aria-label': 'Tag',
  });
  const createBox = h('div', { class: 'gb-money-tagpick-create', style: { display: 'none' } });
  let pick = 0;

  function applySelect(key) {
    selected = key;
    chips.querySelectorAll('.gb-money-tagchip').forEach((b) => {
      const on = b.dataset.key === key;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  function chip(c) {
    return h(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': String(c.key === selected),
        'data-key': c.key,
        class: 'gb-money-tagchip' + (c.key === selected ? ' is-on' : ''),
        onclick: () => {
          applySelect(c.key);
          if (opts.onPick) opts.onPick(c.key);
        },
      },
      h('span', { class: 'gb-money-tagchip-dot', style: { background: c.color } }),
      c.label
    );
  }
  function buildCreate() {
    const name = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '24',
      placeholder: 'New tag name',
    });
    const sw = h(
      'div',
      { class: 'gb-money-swatches' },
      PALETTE.map((p, i) =>
        h('button', {
          type: 'button',
          class: 'gb-money-swatch' + (i === 0 ? ' is-on' : ''),
          style: { background: p.color },
          'aria-label': 'Color ' + (i + 1),
          onclick: (e) => {
            e.preventDefault();
            pick = i;
            sw.querySelectorAll('.gb-money-swatch').forEach((b, j) =>
              b.classList.toggle('is-on', j === i)
            );
          },
        })
      )
    );
    const add = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--soft gb-btn--compact',
        onclick: () => {
          const label = name.value.trim();
          if (!label) return;
          const key = slug(label);
          if (!key || mergedCats(money).some((c) => c.key === key)) {
            toast.error({ message: 'That tag already exists.' }, 'That tag already exists.');
            return;
          }
          const p = PALETTE[pick];
          const cat = { key, label, icon: 'tag', color: p.color, soft: p.soft, fg: p.fg };
          money.customCategories = (money.customCategories || []).concat(cat);
          commitOn(
            money,
            save,
            (m) => (m.customCategories = (m.customCategories || []).concat(cat))
          );
          renderChips();
          applySelect(key);
          if (opts.onPick) opts.onPick(key);
          createBox.style.display = 'none';
          toast.success('Tag added.');
        },
      },
      'Add'
    );
    const cancel = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--ghost gb-btn--compact',
        onclick: () => (createBox.style.display = 'none'),
      },
      'Cancel'
    );
    createBox.replaceChildren(
      name,
      sw,
      h('div', { class: 'gb-money-tagpick-create-row' }, add, cancel)
    );
    setTimeout(() => name.focus(), 40);
  }
  function renderChips() {
    const items = mergedCats(money).map(chip);
    if (opts.allowCreate)
      items.push(
        h(
          'button',
          {
            type: 'button',
            class: 'gb-money-tagchip gb-money-tagchip--add',
            onclick: () => {
              if (createBox.style.display === 'none') {
                buildCreate();
                createBox.style.display = '';
              } else createBox.style.display = 'none';
            },
          },
          Icon('plus', { size: 13, sw: 2.6 }),
          'New'
        )
      );
    chips.replaceChildren(...items);
    refreshIcons();
  }
  renderChips();
  wrap.append(chips, createBox);
  return { node: wrap, get: () => selected, set: applySelect };
}

/* Money personalization — custom tags, currency and prompts. Rendered as a pane
   inside the app's Customise modal (see app.js). Changes save automatically, so
   there's no explicit save button, matching the modal's other tabs. */
export function MoneyCustomisePane(money, save) {
  const commit = (mutator) => commitOn(money, save, mutator);
  // Keep the local `money` in sync with each commit so successive auto-saves
  // build on each other instead of cloning a stale doc.
  const setPref = (patch) => {
    money.settings = Object.assign({}, money.settings, patch);
    commit((m) => (m.settings = Object.assign({}, m.settings, patch)));
  };

  const list = h('div', { class: 'gb-money-tag-list' });
  const nameInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '24',
    placeholder: 'e.g. Health, Pets, Travel',
  });
  let pick = 0;
  const swatches = h(
    'div',
    { class: 'gb-money-swatches' },
    PALETTE.map((p, i) =>
      h('button', {
        type: 'button',
        class: 'gb-money-swatch' + (i === 0 ? ' is-on' : ''),
        style: { background: p.color },
        'aria-label': 'Color ' + (i + 1),
        onclick: (ev) => {
          ev.preventDefault();
          pick = i;
          swatches
            .querySelectorAll('.gb-money-swatch')
            .forEach((b, j) => b.classList.toggle('is-on', j === i));
        },
      })
    )
  );
  function renderList() {
    const custom = money.customCategories || [];
    list.replaceChildren(
      ...(custom.length
        ? custom.map((c) =>
            h(
              'div',
              { class: 'gb-money-tag-row' },
              h(
                'span',
                { class: 'gb-money-cat-ic', style: { background: c.soft, color: c.fg } },
                Icon(c.icon || 'tag', { size: 14, sw: 2.2 })
              ),
              h('span', { class: 'gb-money-tag-name' }, c.label),
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-icon-btn',
                  'aria-label': 'Remove tag',
                  onclick: () =>
                    confirmDelete('Remove tag', 'Remove the "' + c.label + '" tag?', () => {
                      money.customCategories = (money.customCategories || []).filter(
                        (x) => x.key !== c.key
                      );
                      commit(
                        (m) =>
                          (m.customCategories = (m.customCategories || []).filter(
                            (x) => x.key !== c.key
                          ))
                      );
                      renderList();
                    }),
                },
                Icon('trash-2', { size: 15, sw: 2.4 })
              )
            )
          )
        : [h('div', { class: 'gb-note-hint' }, 'No custom tags yet. Built-in tags always stay.')])
    );
    refreshIcons();
  }
  renderList();
  const addBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--soft gb-btn--compact',
      onclick: () => {
        const label = nameInput.value.trim();
        if (!label) return;
        const key = slug(label);
        if (!key || mergedCats(money).some((c) => c.key === key)) {
          toast.error({ message: 'That tag already exists.' }, 'That tag already exists.');
          return;
        }
        const p = PALETTE[pick];
        const cat = { key, label, icon: 'tag', color: p.color, soft: p.soft, fg: p.fg };
        money.customCategories = (money.customCategories || []).concat(cat);
        commit((m) => (m.customCategories = (m.customCategories || []).concat(cat)));
        nameInput.value = '';
        renderList();
        toast.success('Tag added.');
      },
    },
    Icon('plus', { size: 14, sw: 2.6 }),
    'Add tag'
  );

  const currencyInput = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '3',
    value: money.settings.currency || CUR,
    placeholder: '₹',
    onchange: () => {
      const sym = currencyInput.value.trim().slice(0, 3) || CUR;
      currencyInput.value = sym;
      setPref({ currency: sym });
      applyCurrency(money);
    },
  });
  const thresholdInput = h('input', {
    type: 'number',
    class: 'gb-input',
    inputmode: 'numeric',
    min: '0',
    step: '1',
    value: String(money.settings.reflectThreshold || 0),
    placeholder: '1000',
    onchange: () => {
      const thr = Math.max(0, Math.round(Number(thresholdInput.value) || 0));
      thresholdInput.value = String(thr);
      setPref({ reflectThreshold: thr });
    },
  });
  const defaultPicker = tagPicker(money, save, {
    initial: money.settings.defaultTag || 'others',
    onPick: (key) => setPref({ defaultTag: key }),
  });

  /* Other currencies: a rate table typed by the person (no network FX) and which
     account holds which. See toHomeAmount for how an entry is booked. */
  const fxBox = h('div', { class: 'gb-money-fx' });
  function renderFx() {
    const fx = Object.assign({}, money.settings.fx);
    const ac = Object.assign({}, money.settings.accountCurrency);
    const home = homeCur(money);
    const syms = Object.keys(fx).filter((k) => fxRate(money, k) && k !== home);
    const badRate = () => toast.error({ message: 'Enter a rate above zero.' }, 'Enter a rate above zero.');
    const rateRow = (sym) =>
      h(
        'div',
        { class: 'gb-money-fx-row' },
        h('span', { class: 'gb-money-fx-sym' }, '1 ' + sym + ' ='),
        h('input', {
          type: 'number',
          class: 'gb-input',
          inputmode: 'decimal',
          min: '0',
          step: 'any',
          value: String(fx[sym]),
          'aria-label': 'Rate for ' + sym + ' in ' + home,
          onchange: (e) => {
            const r = Number(e.currentTarget.value);
            if (!(r > 0)) {
              e.currentTarget.value = String(fx[sym]);
              return badRate();
            }
            setPref({ fx: Object.assign({}, fx, { [sym]: r }) });
          },
        }),
        h('span', { class: 'gb-money-fx-home' }, home),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-icon-btn',
            'aria-label': 'Remove ' + sym,
            onclick: () =>
              confirmDelete(
                'Remove ' + sym,
                'Remove ' + sym + '? Accounts in it go back to ' + home + '. Entries already booked keep their amounts.',
                () => {
                  delete fx[sym];
                  for (const k of Object.keys(ac)) if (ac[k] === sym) ac[k] = null;
                  setPref({ fx, accountCurrency: ac });
                  renderFx();
                }
              ),
          },
          Icon('trash-2', { size: 15, sw: 2.4 })
        )
      );
    const newSym = h('input', { type: 'text', class: 'gb-input', maxlength: '3', placeholder: '$', 'aria-label': 'Currency symbol' });
    const newRate = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'decimal',
      min: '0',
      step: 'any',
      placeholder: 'e.g. 83.2',
      'aria-label': 'Its rate in ' + home,
    });
    const add = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--soft gb-btn--compact',
        onclick: () => {
          const sym = newSym.value.trim().slice(0, 3);
          const r = Number(newRate.value);
          if (!sym || sym === home) {
            newSym.focus();
            return toast.error({ message: 'Use a symbol other than ' + home + '.' }, 'Use a symbol other than ' + home + '.');
          }
          if (!(r > 0)) return badRate();
          setPref({ fx: Object.assign({}, fx, { [sym]: r }) });
          renderFx();
        },
      },
      Icon('plus', { size: 14, sw: 2.6 }),
      'Add currency'
    );
    const accts = activeAccounts(money);
    // replaceChildren would print a null (or a 0) as text, so the optional part is filtered.
    const parts = [
      ...Object.keys(fx).filter((k) => k !== home).map(rateRow),
      h('div', { class: 'gb-money-fx-row gb-money-fx-new' }, newSym, newRate, add),
      syms.length > 0 && accts.length > 0
        ? h(
            'div',
            { class: 'gb-money-fx-accounts' },
            accts.map((a) =>
              h(
                'label',
                { class: 'gb-money-fx-acc' },
                h('span', null, a.name),
                h(
                  'select',
                  {
                    class: 'gb-input',
                    onchange: (e) => {
                      const v = e.currentTarget.value;
                      setPref({ accountCurrency: Object.assign({}, ac, { [a.id]: v === home ? null : v }) });
                    },
                  },
                  [home].concat(syms).map((c) => h('option', { value: c, selected: (ac[a.id] || home) === c }, c))
                )
              )
            )
          )
        : null,
    ].filter(Boolean);
    fxBox.replaceChildren(...parts);
    refreshIcons();
  }
  renderFx();

  return h(
    'div',
    { class: 'gb-form' },
    h('div', { class: 'gb-money-custom-head' }, Icon('tag', { size: 14, sw: 2.2 }), 'Your tags'),
    list,
    h('div', { class: 'gb-field-label' }, 'New tag'),
    nameInput,
    h('div', { class: 'gb-field-label' }, 'Color'),
    swatches,
    addBtn,
    h(
      'div',
      { class: 'gb-money-custom-head', style: { marginTop: '8px' } },
      Icon('settings', { size: 14, sw: 2.2 }),
      'Preferences'
    ),
    h('div', { class: 'gb-field-label' }, 'Currency symbol'),
    currencyInput,
    h('div', { class: 'gb-field-label' }, 'Ask me to reflect on buys of at least (' + cur + ', whole amounts, 0 = off)'),
    thresholdInput,
    h('div', { class: 'gb-note-hint', style: { marginTop: '2px' } }, 'Set to 0 to never prompt.'),
    h('div', { class: 'gb-field-label' }, 'Default tag for new expenses'),
    defaultPicker.node,
    h(
      'div',
      { class: 'gb-money-custom-head', style: { marginTop: '8px' } },
      Icon('coins', { size: 14, sw: 2.2 }),
      'Other currencies'
    ),
    h(
      'div',
      { class: 'gb-note-hint' },
      'For an account in another currency. Type the rate yourself; an entry is counted in ' +
        homeCur(money) +
        ' at the rate on the day you log it, and its row shows what you paid.'
    ),
    fxBox
  );
}

/* =====================================================================
   Module-scope modals (shared by screen + home widget)
   ===================================================================== */
function commitOn(money, save, mutator) {
  const next = clone(money);
  mutator(next);
  save(next, money);
}

/* Five stars instead of a 1–5 number strip: same { node, get() } contract as
   segmented(), so the caller can't tell which control it got.

   The caption is not decoration — it is the accessible half of the rating.
   Amber-on-grey alone never says what a 2 means, and the old label had to
   spell out "1 = regret, 5 = glad I bought it" for exactly that reason. */
const SAT_WORDS = {
  1: 'Regret it',
  2: 'Could have skipped it',
  3: 'It’s fine',
  4: 'Glad I bought it',
  5: 'Worth every bit',
};

function starRating(initial) {
  let value = Number(initial) || 4;
  const caption = h('div', { class: 'gb-stars-caption', 'aria-live': 'polite' });
  const stars = [];
  const row = h('div', {
    class: 'gb-stars',
    role: 'radiogroup',
    'aria-label': 'How satisfied, 1 to 5',
  });

  function paint(picked) {
    stars.forEach((btn, i) => {
      const on = i < value;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', String(i + 1 === value));
      // Light up left to right, 40ms a star — all five popping at once reads
      // as a flicker rather than a fill.
      btn.style.setProperty('--gb-star-delay', picked && on ? i * 40 + 'ms' : '0ms');
    });
    caption.textContent = SAT_WORDS[value];
    caption.dataset.level = value <= 2 ? 'low' : value >= 4 ? 'high' : 'mid';
    if (!picked) return;
    // Re-tapping the same rating has to replay the pop, so restart the
    // animations by hand instead of relying on the class changing.
    row.classList.remove('just-picked');
    caption.classList.remove('just-swapped');
    void row.offsetWidth;
    row.classList.toggle('is-full', value === 5);
    row.classList.add('just-picked');
    caption.classList.add('just-swapped');
  }

  [1, 2, 3, 4, 5].forEach((n) => {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'gb-star',
        role: 'radio',
        'aria-label': n + ' out of 5 — ' + SAT_WORDS[n],
        onclick: () => {
          value = n;
          paint(true);
        },
      },
      Icon('star', { size: 28, sw: 2 })
    );
    stars.push(btn);
    row.appendChild(btn);
  });
  paint(false);

  return {
    node: h('div', { class: 'gb-stars-wrap' }, row, caption),
    get: () => String(value),
  };
}

function openReflection(money, save, expenseId) {
  const reason = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '160',
    placeholder: 'e.g. Felt stressed, treated myself',
  });
  const planned = segmented(
    [
      { value: 'yes', label: 'Planned' },
      { value: 'no', label: 'Impulse' },
    ],
    'yes'
  );
  const sat = starRating(4);
  openMoneyModal({
    title: 'Quick reflection',
    sub: 'A quick note on why you bought it. Helps you spot patterns later.',
    body: h(
      'div',
      { class: 'gb-form' },
      h('div', { class: 'gb-field-label' }, 'Why did you buy this?'),
      reason,
      h('div', { class: 'gb-field-label' }, 'Planned buy or impulse?'),
      planned.node,
      h('div', { class: 'gb-field-label' }, 'How do you feel about it?'),
      sat.node
    ),
    primary: 'Save reflection',
    onPrimary: async () => {
      commitOn(money, save, (m) => {
        const e = m.expenses.find((x) => x.id === expenseId);
        if (e)
          e.reflection = {
            reason: reason.value.trim(),
            planned: planned.get() === 'yes',
            satisfaction: Number(sat.get()),
          };
      });
    },
  });
}

/* Mark today as a no-spend day — a positive log for a day you kept your wallet
   shut. Blocked once anything is spent today, so the two can't contradict. */
function logNoSpendDay(money, save) {
  money = normalizeMoney(money);
  const today = todayKey();
  const spentToday = money.expenses.some((e) => e.date === today && Number(e.amount) > 0);
  if (spentToday) {
    toast.error(null, 'You’ve logged spending today, so it isn’t a no-spend day.');
    return;
  }
  if ((money.noSpendDays || []).includes(today)) {
    toast.success('Today is already marked no-spend. Keep it going.');
    return;
  }
  const next = clone(money);
  next.noSpendDays = [...(next.noSpendDays || []), today];
  save(next, money);
  toast.success('No-spend day logged — that’s money kept.');
}

/* Add, or — with `existing` — edit in place. Editing keeps the id (so the ledger
   updates the same row), the reflection and createdAt; only what the form shows changes. */
function openExpenseModal(money, save, prefillDate, existing) {
  money = normalizeMoney(money);
  applyCurrency(money);
  const ex = existing || null;
  const amount = h('input', {
    type: 'number',
    class: 'gb-input',
    inputmode: 'decimal',
    min: '1',
    max: '10000000',
    placeholder: 'e.g. 250',
    // Booked in another currency: edit what was actually paid, not the converted figure.
    value: ex ? String(ex.orig ? ex.orig.amount : ex.amount) : '',
  });
  const note = h('input', {
    type: 'text',
    class: 'gb-input',
    maxlength: '120',
    placeholder: 'e.g. Lunch with team',
    value: ex ? ex.note || '' : '',
  });
  const date = h('input', {
    type: 'date',
    class: 'gb-input',
    value: (ex && ex.date) || prefillDate || todayKey(),
  });
  const hint = h('div', { class: 'gb-note-hint', style: { marginTop: '6px' } }, '');
  let userPicked = !!ex; // an existing tag was chosen on purpose; don't re-guess it
  const picker = tagPicker(money, save, {
    initial: (ex && ex.category) || money.settings.defaultTag || 'others',
    allowCreate: true,
    onPick: () => (userPicked = true),
  });
  note.addEventListener('input', () => {
    if (userPicked) return;
    const guess = suggestCategory(note.value, money);
    if (guess) {
      picker.set(guess);
      hint.textContent = 'Suggested tag: ' + catOf(guess, money).label;
    }
  });
  // Whatever you paid from last time is the best guess for this time.
  const amountLabel = h('div', { class: 'gb-field-label' }, '');
  const labelFor = (accId) => {
    const c = accCurrency(money, accId);
    amountLabel.textContent = c
      ? 'Amount (' + c + (fxRate(money, c) ? ', 1 ' + c + ' = ' + fmtIn(fxRate(money, c), cur) : ', no rate set') + ')'
      : 'Amount (' + cur + ')';
  };
  const paidFrom = accountPicker(
    money,
    (ex && ex.accountId) || money.settings.lastAccountId || firstOfKind(money, ['cash']),
    labelFor
  );
  labelFor(paidFrom.get());
  openMoneyModal({
    title: ex ? 'Edit expense' : 'Add expense',
    sub: ex
      ? 'Fix the amount, tag, account or date.'
      : "Add what you spent. I'll suggest a tag from your note.",
    body: h(
      'div',
      { class: 'gb-form' },
      amountLabel,
      amount,
      h('div', { class: 'gb-field-label' }, 'Note (optional)'),
      note,
      hint,
      h('div', { class: 'gb-field-label' }, 'Tag'),
      picker.node,
      paidFrom.node ? h('div', { class: 'gb-field-label' }, 'Paid from') : null,
      paidFrom.node,
      h('div', { class: 'gb-field-label' }, 'Date'),
      date
    ),
    primary: ex ? 'Save changes' : 'Add expense',
    danger: ex
      ? {
          label: 'Delete expense',
          onClick: () => {
            const next = clone(money);
            next.expenses = next.expenses.filter((x) => x.id !== ex.id);
            save(next, money);
            toast.success('Expense deleted.');
          },
        }
      : null,
    onPrimary: async () => {
      const amt = readAmount(amount);
      // `max` on a number input is never checked without a <form> submit; the
      // server refuses past it too (MoneyService.applyLedger).
      const bad = !Number.isFinite(amt) || amt <= 0
        ? 'Enter an amount greater than zero.'
        : amt > Number(amount.max)
          ? 'An expense can be at most ' + fmt(Number(amount.max)) + '.'
          : '';
      amount.setAttribute('aria-invalid', bad ? 'true' : 'false');
      if (bad) {
        amount.focus();
        throw new Error(bad);
      }
      const cat = picker.get();
      const next = clone(money);
      const accountId = paidFrom.get();
      // Another currency's account: stored converted, with what was paid kept as `orig`.
      const home = ex ? editedHomeAmount(money, ex, accountId, amt) : toHomeAmount(money, accountId, amt);
      const fields = {
        amount: home.amount,
        orig: home.orig,
        category: cat,
        date: date.value || todayKey(),
        note: note.value.trim(),
      };
      if (ex) {
        next.expenses = next.expenses.map((x) => {
          if (x.id !== ex.id) return x;
          const edited = Object.assign({}, x, fields);
          if (!edited.orig) delete edited.orig;
          if (accountId) edited.accountId = accountId;
          return edited;
        });
        save(next, money);
        toast.success('Expense updated.');
        return;
      }
      const id = uid();
      if (!fields.orig) delete fields.orig;
      next.expenses.unshift({
        id,
        ...fields,
        createdAt: Date.now(),
        ...(accountId ? { accountId } : {}),
      });
      if (accountId) next.settings.lastAccountId = accountId;
      save(next, money);
      toast.success('Expense added.');
      // A quick "why" reflection for buys at or above the user's threshold (Customise;
      // 0 turns it off). It used to open for every expense: the setting was never read.
      // Operate on `next` so the new expense id resolves regardless of re-render timing.
      const thr = Number(money.settings.reflectThreshold) || 0;
      if (thr > 0 && amt >= thr) setTimeout(() => openReflection(next, save, id), 220);
    },
  });
  setTimeout(() => amount.focus(), 60);
}

/* =====================================================================
   Screen
   ===================================================================== */
let activeTab = 'overview';
let spendFilter = 'all';
let lastSearch = ''; // what is in the search box, run or not
let searchAsked = ''; // the last query actually run
let filterScroll = 0; // the tag filter strip's scrollLeft
// View state that has to survive a repaint. Every Money save makes app.js call
// ScreenMoney again, so state declared inside it reset on each save: the open day
// panel closed, "Show all" income collapsed, the month tape replayed. These reset
// on a fresh visit instead (see `moneyRoot` in ScreenMoney).
const EXP_PAGE = 60;
let pickedDay = null;
let showAllIncome = false;
let tapeShown = false; // the tape's fill-in plays on a visit's first paint only
let expShown = EXP_PAGE; // rows of "This month" revealed by Show more
let expMonth = null; // 'YYYY-MM' the expense list shows; null = this month
let loanOrder = null; // loan ids as last shown, so Settle/Undo doesn't move a row
let moneyRoot = null;
let recurPosting = false; // a repeat post is queued; one at a time
/* History older than the 400-day load, fetched a page at a time by "Load older"
   (GET /api/money/tx?before=). View-only: it lives here, never in the document, so
   a save neither re-sends it nor reads its absence as deletes. Its rows can't be
   edited or deleted from the list. */
let older = null; // {expenses, income, transfers, more} once a page has come
let olderBusy = false;
const daySummaries = new Map();

/* The loaded ledger (~13 months: the server sends the last 400 days, plus any
   page "Load older" fetched) as CSV, newest first. Client-side from what's on
   screen, so it works offline and needs no endpoint of its own. Exported for
   money-calc.test.mjs. Text cells are quoted, and a leading = + - @ is
   defused with a ' so a spreadsheet doesn't run a note as a formula. */
export function ledgerCsv(money) {
  const accName = new Map((money.accounts || []).map((a) => [a.id, a.name]));
  const cell = (v) => {
    if (typeof v === 'number') return String(v);
    let t = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(t)) t = "'" + t;
    return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const rows = [];
  // What was actually paid, for an entry booked from another currency's account.
  const orig = (x) => (x.orig && x.orig.currency ? x.orig.amount + ' ' + x.orig.currency : '');
  for (const e of money.expenses || [])
    rows.push([e.date, 'expense', -Number(e.amount) || 0, e.category || '', e.note || '', accName.get(e.accountId) || '', orig(e)]);
  for (const i of money.income || [])
    rows.push([i.date, 'income', Number(i.amount) || 0, i.source || '', i.label || '', accName.get(i.accountId) || '', orig(i)]);
  for (const t of money.transfers || [])
    rows.push([
      t.date,
      'transfer',
      Number(t.amount) || 0,
      '',
      t.note || '',
      (t.from ? accName.get(t.from) || '' : 'in') + ' → ' + (t.to ? accName.get(t.to) || '' : 'out'),
      '',
    ]);
  rows.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  return [['date', 'type', 'amount', 'category', 'note', 'account', 'original']]
    .concat(rows)
    .map((r) => r.map(cell).join(','))
    .join('\r\n');
}
function downloadLedgerCsv(money) {
  const name = 'growth-buddy-money-' + todayKey() + '.csv';
  // BOM: Excel reads a BOM-less CSV as ANSI and mangles ₹ and names.
  const blob = new Blob(['\uFEFF' + ledgerCsv(money)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast.success('Your money CSV is downloading.');
}

function ScreenMoney({
  money,
  onSaveMoney,
  requestAdvice,
  requestReceiptScan,
  accountRequest,
  requestDaySummary,
  requestOlderTx,
}) {
  money = normalizeMoney(money);
  applyCurrency(money);
  const root = h('div', { class: 'gb-money gb-rise' });
  // app.js builds the new screen before swapping it in, so the previous root is
  // still in the document on a repaint and detached on a fresh visit.
  if (!(moneyRoot && moneyRoot.isConnected)) {
    pickedDay = null;
    showAllIncome = false;
    tapeShown = false;
    expShown = EXP_PAGE;
    expMonth = null;
    loanOrder = null;
    older = null;
    daySummaries.clear();
  }
  moneyRoot = root;
  const save = (next, base) => onSaveMoney(next, base);
  const commit = (mutator) => commitOn(money, save, mutator);
  // Repeats whose day has come are posted on the visit (ids `rec-<id>-<month>`, so a
  // second device posting the same month upserts the same row). After this render,
  // not during it: a save repaints the screen synchronously.
  if (!recurPosting && recurringDue(money).length) {
    recurPosting = true;
    setTimeout(() => {
      recurPosting = false;
      let n = 0;
      commit((m) => (n = materialiseRecurring(m)));
      if (n) toast.success(n === 1 ? 'Logged 1 monthly repeat.' : 'Logged ' + n + ' monthly repeats.');
    }, 0);
  }

  /* ---- Accounts card: where the money is, right under "what did I spend" ---- */
  function accountsCard() {
    const list = activeAccounts(money);
    if (!list.length) return null;
    const total = list.reduce((a, x) => a + (Number(x.balance) || 0), 0);
    // Nothing tells us what was in the purse before the app, so ask once. Any
    // non-zero balance, or any entry booked to an account, means it was answered.
    const needsSetup =
      !money.settings.accountsSetUp &&
      list.every((a) => !Number(a.openingBalance)) &&
      !money.expenses.concat(money.income).some((e) => e.accountId);
    return Card({
      className: 'gb-money-card',
      children: [
        h(
          'div',
          { class: 'gb-sectiontitle' },
          h('h3', null, 'Where your money is'),
          h(
            'div',
            { class: 'gb-money-head-actions' },
            list.length > 1
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-btn gb-btn--ghost gb-btn--compact',
                    onclick: () => openTransfer(),
                  },
                  Icon('arrow-left-right', { size: 14, sw: 2.4 }),
                  'Move money'
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--soft gb-btn--compact',
                onclick: openAddAccount,
              },
              Icon('plus', { size: 14, sw: 2.6 }),
              'Account'
            )
          )
        ),
        needsSetup
          ? coachCard('wallet', 'How much is in each right now?', [
              h(
                'p',
                { class: 'gb-money-coach-text' },
                'Tell me once and every expense after that keeps your cash and bank balances right.'
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--soft gb-btn--compact',
                  onclick: openSetBalances,
                },
                Icon('pencil', { size: 14, sw: 2.4 }),
                'Set balances'
              ),
            ])
          : null,
        h(
          'div',
          { class: 'gb-money-accounts' },
          list.map((a) =>
            h(
              'button',
              {
                type: 'button',
                class: 'gb-money-account' + (Number(a.balance) < 0 ? ' is-negative' : ''),
                onclick: () => openEditAccount(a),
                'aria-label': a.name + ', ' + fmtBalance(money, a) + '. Edit',
              },
              h(
                'span',
                { class: 'gb-money-account-ic' },
                Icon(ACCOUNT_ICON[a.kind] || 'wallet', { size: 17, sw: 2.2 })
              ),
              h(
                'span',
                { class: 'gb-money-account-main' },
                h('span', { class: 'gb-money-account-name' }, a.name),
// "Cash / Cash" says nothing twice; the type shows only when the name doesn't.
                a.name.toLowerCase() === (ACCOUNT_KIND_LABEL[a.kind] || '').toLowerCase()
                  ? null
                  : h('span', { class: 'gb-money-account-kind' }, ACCOUNT_KIND_LABEL[a.kind] || a.kind)
              ),
              h(
                'span',
                { class: 'gb-money-account-bal' },
                fmtBalance(money, a),
                accCurrency(money, a.id) && fxRate(money, accCurrency(money, a.id))
                  ? h('span', { class: 'gb-money-account-home' }, fmt(a.balance))
                  : null
              )
            )
          )
        ),
        list.some((a) => Number(a.balance) < 0)
          ? h(
              'p',
              { class: 'gb-money-intro' },
              "A balance below zero usually means some money came in that isn't logged. Tap the account to set what it really holds."
            )
          : null,
        list.length > 1
          ? h(
              'div',
              { class: 'gb-money-accounts-total' },
              'Total ' + fmt(total) + ' across ' + list.length + ' accounts'
            )
          : null,
        // A transfer is in no spending view (it isn't spending), so this is the
        // one place it can be seen and taken back.
        money.transfers.some(isMove)
          ? h(
              'div',
              { class: 'gb-money-moves' },
              h('div', { class: 'gb-money-day-sub' }, 'Recent moves'),
              money.transfers.filter(isMove).slice(0, 3).map((t) =>
                h(
                  'div',
                  { class: 'gb-money-exp-row' },
                  h(
                    'span',
                    { class: 'gb-money-cat-ic gb-money-move-ic' },
                    Icon('arrow-left-right', { size: 15, sw: 2.2 })
                  ),
                  h(
                    'div',
                    { class: 'gb-money-exp-main' },
                    h(
                      'div',
                      { class: 'gb-money-exp-note' },
                      ((accountOf(money, t.from) || {}).name || 'Account') +
                        ' → ' +
                        ((accountOf(money, t.to) || {}).name || 'Account')
                    ),
                    h(
                      'div',
                      { class: 'gb-money-exp-meta' },
                      [t.note, fmtDateShort(t.date)].filter(Boolean).join(' · ')
                    )
                  ),
                  h('div', { class: 'gb-money-exp-amt' }, fmt(t.amount)),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'gb-icon-btn',
                      'aria-label': 'Undo this move',
                      onclick: () =>
                        confirmDelete('Undo move', 'Undo moving ' + fmt(t.amount) + '?', async () => {
                          commit((m) => (m.transfers = m.transfers.filter((x) => x.id !== t.id)));
                          toast.success('Move undone.');
                        }),
                    },
                    Icon('trash-2', { size: 15, sw: 2.4 })
                  )
                )
              )
            )
          : null,
      ],
    });
  }

  /* Account writes go to the server (balances are computed there) and come back
     as the whole list; app.js orders them after any expense still being saved. */
  async function accountWrite(method, path, body, done) {
    try {
      await accountRequest(method, path, body);
      if (done) toast.success(done);
    } catch (err) {
      throw new Error((err && err.message) || 'Could not update the account.');
    }
  }

  function kindPicker(initial) {
    return segmented(
      Object.keys(ACCOUNT_KIND_LABEL).map((k) => ({ value: k, label: ACCOUNT_KIND_LABEL[k] })),
      initial
    );
  }

  function openAddAccount() {
    const name = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '40',
      placeholder: 'e.g. HDFC savings',
    });
    const kind = kindPicker('bank');
    const bal = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'decimal',
      placeholder: 'e.g. 12000',
    });
    openMoneyModal({
      title: 'Add account',
      sub: 'A bank account, a card, a UPI wallet, or a second purse.',
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Name'),
        name,
        h('div', { class: 'gb-field-label' }, 'Type'),
        kind.node,
        h('div', { class: 'gb-field-label' }, 'In it right now (' + cur + ')'),
        bal
      ),
      primary: 'Add account',
      onPrimary: async () => {
        if (!name.value.trim()) {
          name.focus();
          throw new Error('Give the account a name.');
        }
        await accountWrite(
          'POST',
          '',
          { name: name.value.trim(), kind: kind.get(), balance: readAmount(bal) || 0 },
          'Account added.'
        );
      },
    });
    setTimeout(() => name.focus(), 60);
  }

  function openEditAccount(a) {
    const name = h('input', { type: 'text', class: 'gb-input', maxlength: '40', value: a.name });
    const kind = kindPicker(a.kind);
    // Another currency's account is set in that currency and stored converted.
    const ac = accCurrency(money, a.id);
    const rate = ac ? fxRate(money, ac) : 0;
    const shown = rate ? Math.round(((Number(a.balance) || 0) / rate) * 100) / 100 : Number(a.balance) || 0;
    const bal = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'decimal',
      value: String(shown),
    });
    openMoneyModal({
      title: a.name,
      sub: 'Change the name, or set what it holds right now. Logged history stays as it is.',
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Name'),
        name,
        h('div', { class: 'gb-field-label' }, 'Type'),
        kind.node,
        h('div', { class: 'gb-field-label' }, 'In it right now (' + (rate ? ac : cur) + ')'),
        bal,
        h(
          'div',
          { class: 'gb-note-hint' },
          'Removing an account with expenses archives it, so its history keeps its name.'
        )
      ),
      primary: 'Save',
      danger: {
        label: 'Remove account',
        onClick: () =>
          confirmDelete(
            'Remove ' + a.name,
            'Remove "' + a.name + '"? Its logged expenses stay.',
            () => accountWrite('DELETE', '/' + a.id, null, a.name + ' removed.')
          ),
      },
      onPrimary: async () => {
        if (!name.value.trim()) {
          name.focus();
          throw new Error('Give the account a name.');
        }
        const body = { name: name.value.trim(), kind: kind.get() };
        const v = readAmount(bal);
        if (bal.value !== '' && v !== shown) body.balance = rate ? Math.round(v * rate * 100) / 100 : v;
        await accountWrite('PUT', '/' + a.id, body, 'Saved.');
      },
    });
  }

  function openSetBalances() {
    const list = activeAccounts(money);
    const inputs = list.map((a) =>
      h('input', {
        type: 'number',
        class: 'gb-input',
        inputmode: 'decimal',
        placeholder: '0',
        id: 'bal-' + a.id,
      })
    );
    openMoneyModal({
      title: 'What you have right now',
      sub: 'Count the purse, check the bank app. Rough is fine; you can correct it any time.',
      body: h(
        'div',
        { class: 'gb-form' },
        list.flatMap((a, i) => [
          h('div', { class: 'gb-field-label' }, a.name + ' (' + (accCurrency(money, a.id) || cur) + ')'),
          inputs[i],
        ])
      ),
      primary: 'Save balances',
      onPrimary: async () => {
        // Read every field first: a bad one found halfway used to leave the
        // accounts before it saved and the rest not.
        const vals = inputs.map((inp) =>
          inp.value === '' && !inp.validity.badInput ? null : readAmount(inp)
        );
        // Converted up front too: an account with no rate refuses before any saves.
        const home = vals.map((v, i) => (v === null ? null : toHomeAmount(money, list[i].id, v).amount));
        for (let i = 0; i < list.length; i++) {
          if (home[i] !== null) await accountRequest('PUT', '/' + list[i].id, { balance: home[i] });
        }
        commit((m) => (m.settings.accountsSetUp = true));
        toast.success('Balances saved.');
      },
    });
    setTimeout(() => inputs[0] && inputs[0].focus(), 60);
  }

  /* Moving money is not spending it: an ATM withdrawal is bank → cash, and
     counting it as an expense would double every cash purchase after it. */
  function openTransfer() {
    const list = activeAccounts(money);
    const holds = h('div', { class: 'gb-note-hint' });
    const showHolds = (id) => {
      const a = accountOf(money, id);
      holds.textContent = a ? a.name + ' has ' + fmt(a.balance) + ' now.' : '';
    };
    // To can never equal From: picking From turns that account off in To, and
    // moves To elsewhere if it was sitting on it.
    const onFrom = (id) => {
      showHolds(id);
      to.disable(id);
      if (to.get() === id) to.set((list.find((a) => a.id !== id) || {}).id);
    };
    const from = accountPicker(money, firstOfKind(money, ['bank']), (id) => onFrom(id));
    const to = accountPicker(
      money,
      firstOfKind(money, ['cash']) || (list.find((a) => a.id !== from.get()) || {}).id
    );
    onFrom(from.get());
    const swap = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--ghost gb-btn--compact gb-money-swap',
        onclick: () => {
          const f = from.get();
          const t = to.get();
          to.disable(null);
          to.set(f);
          from.set(t);
        },
      },
      Icon('arrow-left-right', { size: 14, sw: 2.4 }),
      'Swap'
    );
    const amount = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'decimal',
      min: '1',
      placeholder: 'e.g. 2000',
    });
    // ATM withdrawals are almost always one of these.
    const quick = h(
      'div',
      { class: 'gb-money-quick' },
      [500, 1000, 2000, 5000].map((v) =>
        h(
          'button',
          {
            type: 'button',
            class: 'gb-money-quick-amt',
            onclick: () => {
              amount.value = String(v);
              amount.focus();
            },
          },
          fmt(v)
        )
      )
    );
    const note = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '120',
      placeholder: 'e.g. ATM withdrawal',
    });
    const date = h('input', { type: 'date', class: 'gb-input', value: todayKey() });
    openMoneyModal({
      title: 'Move money',
      sub: 'Withdrawing cash, topping up a wallet, paying off a card. Not counted as spending.',
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-money-move-head' }, h('div', { class: 'gb-field-label' }, 'From'), swap),
        from.node,
        holds,
        h('div', { class: 'gb-field-label' }, 'To'),
        to.node,
        h('div', { class: 'gb-field-label' }, 'Amount (' + cur + ')'),
        amount,
        quick,
        h('div', { class: 'gb-field-label' }, 'Note (optional)'),
        note,
        h('div', { class: 'gb-field-label' }, 'Date'),
        date
      ),
      primary: 'Move money',
      onPrimary: async () => {
        const v = readAmount(amount);
        if (!Number.isFinite(v) || v <= 0) {
          amount.focus();
          throw new Error('Enter an amount greater than zero.');
        }
        if (from.get() === to.get()) throw new Error('Pick two different accounts.');
        commit((m) =>
          m.transfers.unshift({
            id: uid(),
            amount: v,
            from: from.get(),
            to: to.get(),
            date: date.value || todayKey(),
            note: note.value.trim(),
            createdAt: Date.now(),
          })
        );
        toast.success('Moved ' + fmt(v) + '.');
      },
    });
    setTimeout(() => amount.focus(), 60);
  }


  function coachCard(icon, title, children, variant) {
    return h(
      'div',
      { class: 'gb-money-coach' + (variant ? ' is-' + variant : '') },
      h('span', { class: 'gb-money-coach-ic' }, Icon(icon, { size: 18, sw: 2.2 })),
      h(
        'div',
        { class: 'gb-money-coach-body' },
        h('div', { class: 'gb-money-coach-title' }, title),
        children
      )
    );
  }
  function stat(label, value) {
    return h(
      'div',
      { class: 'gb-money-stat' },
      h('div', { class: 'gb-money-stat-val' }, value),
      h('div', { class: 'gb-money-stat-lbl' }, label)
    );
  }
  function emptyHint(icon, text) {
    return h(
      'div',
      { class: 'gb-money-empty' },
      Icon(icon, { size: 22, color: 'var(--fg3)', sw: 2 }),
      h('span', null, text)
    );
  }

  const openAddExpense = (prefillDate) => openExpenseModal(money, save, prefillDate);
  const openEditExpense = (e) => openExpenseModal(money, save, null, e);

  /* ---- MODALS ---- */
  function openReceiptScan() {
    const file = h('input', {
      type: 'file',
      class: 'gb-input',
      accept: 'image/*',
      capture: 'environment',
    });
    const preview = h('div', { class: 'gb-money-receipt-preview' });
    const rowsWrap = h('div', { class: 'gb-money-receipt-rows' });
    const totalEl = h('div', { class: 'gb-money-receipt-total' }, 'Total: ' + fmt(0));
    let rows = [];
    const recompute = () =>
      (totalEl.textContent =
        'Total: ' + fmt(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)));
    function renderRows() {
      rowsWrap.replaceChildren(
        ...rows.map((r, i) => {
          const name = h('input', {
            type: 'text',
            class: 'gb-input gb-input--inline',
            value: r.name,
            placeholder: 'Item',
            style: { flex: '1' },
          });
          const amt = h('input', {
            type: 'number',
            class: 'gb-input gb-input--inline',
            inputmode: 'decimal',
            value: r.amount || '',
            placeholder: cur,
            min: '0',
            style: { width: '84px' },
          });
          name.addEventListener('input', () => {
            r.name = name.value;
            r.category = suggestCategory(name.value, money) || 'others';
          });
          amt.addEventListener('input', () => {
            r.amount = Math.round((Number(amt.value) || 0) * 100) / 100;
            recompute();
          });
          const del = h(
            'button',
            {
              type: 'button',
              class: 'gb-icon-btn',
              'aria-label': 'Remove item',
              onclick: () => {
                rows.splice(i, 1);
                renderRows();
                recompute();
              },
            },
            Icon('trash-2', { size: 15, sw: 2.4 })
          );
          return h('div', { class: 'gb-money-receipt-row' }, name, amt, del);
        })
      );
    }
    const addRowBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--soft gb-btn--compact',
        onclick: () => {
          rows.push({ name: '', amount: 0, category: 'others' });
          renderRows();
        },
      },
      Icon('plus', { size: 14, sw: 2.6 }),
      'Add item'
    );
    const date = h('input', { type: 'date', class: 'gb-input', value: todayKey(), max: todayKey() });
    const status = h('div', { class: 'gb-note-hint', 'aria-live': 'polite' });
    let scanSeq = 0; // a second photo picked mid-scan wins; the first answer is dropped
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        preview.style.backgroundImage = 'url(' + reader.result + ')';
        preview.classList.add('has-img');
      };
      reader.readAsDataURL(f);
      if (typeof requestReceiptScan !== 'function') return;
      const seq = ++scanSeq;
      status.replaceChildren(
        Thinking('Reading your receipt', ['Reading the receipt', 'Finding each item', 'Tagging them'])
      );
      let res = null;
      try {
        res = await requestReceiptScan(f);
      } catch (_) {
        /* offline, rate-limited or an unreadable photo: same as no AI */
      }
      if (seq !== scanSeq) return;
      const items = (res && res.configured && res.items) || [];
      if (!items.length) {
        status.textContent = "Couldn't read items from this photo. Add them below.";
        if (!rows.length) {
          rows = [{ name: '', amount: 0, category: 'others' }];
          renderRows();
        }
        return;
      }
      const scanned = items.map((it) => ({
        name: it.name,
        amount: Number(it.amount) || 0,
        category: suggestCategory(it.name, money) || 'others',
      }));
      // Rows the user already filled in stay; empty ones make way for the scan.
      rows = rows.filter((r) => (Number(r.amount) || 0) > 0).concat(scanned);
      if (res.date && res.date <= todayKey()) date.value = res.date;
      renderRows();
      recompute();
      status.textContent =
        'Read ' +
        items.length +
        ' item' +
        (items.length === 1 ? '' : 's') +
        (res.merchant ? ' from ' + res.merchant : '') +
        '. Check the amounts before saving.';
    });
    openMoneyModal({
      title: 'Scan a receipt',
      // The AI reads the items (MoneyService.scanReceipt); nothing is saved until
      // the user confirms them. Without AI the photo is only a reference.
      sub: "Snap your receipt and I'll read the items. Check them, then save.",
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Receipt photo'),
        file,
        preview,
        status,
        h('div', { class: 'gb-field-label' }, 'Date'),
        date,
        h('div', { class: 'gb-field-label' }, 'Items'),
        rowsWrap,
        addRowBtn,
        totalEl,
        h(
          'div',
          { class: 'gb-note-hint', style: { marginTop: '8px' } },
          'Each item is saved as a dated expense in your history.'
        )
      ),
      primary: 'Save items',
      onPrimary: async () => {
        const valid = rows.filter((r) => (Number(r.amount) || 0) > 0);
        if (!valid.length) throw new Error('Add at least one item with an amount.');
        commit((m) =>
          valid.forEach((r) =>
            m.expenses.unshift({
              id: uid(),
              amount: r.amount,
              category: catOf(r.category, money).key,
              date: date.value && date.value <= todayKey() ? date.value : todayKey(),
              note: r.name.trim() || 'Receipt item',
              createdAt: Date.now(),
            })
          )
        );
        toast.success(valid.length + ' item' + (valid.length === 1 ? '' : 's') + ' saved.');
      },
    });
  }

  function openSetBudgets() {
    const inputs = mergedCats(money).map((c) => ({
      c,
      inp: h('input', {
        type: 'number',
        class: 'gb-input',
        inputmode: 'numeric',
        min: '0',
        step: '1',
        max: '10000000',
        placeholder: '0',
        value: money.budgets[c.key] ? String(money.budgets[c.key]) : '',
      }),
      roll: h('input', {
        type: 'checkbox',
        class: 'gb-money-roll-check',
        checked: typeof (money.rollover || {})[c.key] === 'string',
        'aria-label': 'Roll ' + c.label + ' over to next month',
      }),
    }));
    openMoneyModal({
      title: 'Monthly budgets',
      sub: 'Set what feels realistic, in whole amounts. Leave blank to skip a tag.',
      body: h(
        'div',
        { class: 'gb-form' },
        inputs.map(({ c, inp, roll }) =>
          h(
            'div',
            { class: 'gb-money-budget-field' },
            h(
              'span',
              { class: 'gb-money-budget-field-ic', style: { background: c.soft, color: c.fg } },
              Icon(c.icon, { size: 16, sw: 2.2 })
            ),
            h('span', { class: 'gb-money-budget-field-label' }, c.label),
            h('label', { class: 'gb-money-roll', title: 'Carry what is left (or over) into next month' }, roll, 'Roll over'),
            inp
          )
        ),
        h(
          'div',
          { class: 'gb-note-hint' },
          'Roll over: what a month leaves unspent is added to the next one, and going over takes it off. It starts from the month after you turn it on.'
        )
      ),
      primary: 'Save budgets',
      onPrimary: async () => {
        // Read every field before committing, so a refused one saves nothing.
        const vals = inputs.map(({ c, inp, roll }) => [c.key, readWhole(inp) || 0, roll.checked]);
        commit((m) => {
          m.budgets = {};
          const was = m.rollover || {};
          m.rollover = {};
          vals.forEach(([k, v, r]) => {
            if (v > 0) m.budgets[k] = v;
            // Kept as the month it was switched on; off is null (not deleted), so a
            // merge with another device's copy can't switch it back on.
            if (r && v > 0) m.rollover[k] = typeof was[k] === 'string' ? was[k] : thisMonthPrefix();
            else if (was[k] !== undefined) m.rollover[k] = null;
          });
        });
        toast.success('Budgets saved.');
      },
    });
  }

  function openPurchaseAdvisor() {
    const item = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '80',
      placeholder: 'e.g. Wireless earbuds',
    });
    const price = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'decimal',
      min: '1',
      placeholder: 'e.g. 2999',
    });
    const reason = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '160',
      placeholder: 'Why do you want it?',
    });
    const result = h('div', { class: 'gb-money-advice' });
    let adviceSeq = 0;
    // Compact, factual context for the AI — the same facts the heuristic reasons
    // over, so the model grounds its judgement instead of guessing.
    const adviceContext = (a, p) => {
      const st = budgetStatus(money).find((s) => s.cat.key === a.cat);
      const goal = (money.goals || [])
        .filter((g) => goalSaved(g) < (g.target || 0))
        .sort((x, y) => goalSaved(y) - goalSaved(x))[0];
      const parts = ['Category: ' + catOf(a.cat, money).label];
      if (st && st.base > 0)
        parts.push(
          a.fits
            ? `Fits the ${st.cat.label} budget — ${fmt(st.remaining)} free this month`
            : `${fmt(p - st.remaining)} over the ${st.cat.label} budget this month`
        );
      else parts.push('No budget set for this category');
      if (goal)
        parts.push(
          `Top savings goal "${goal.name}", ${fmt(Math.max(0, (goal.target || 0) - goalSaved(goal)))} left`
        );
      return parts.join('. ') + '.';
    };
    const renderHeuristic = (a) => {
      result.replaceChildren(
        h(
          'div',
          { class: 'gb-money-advice-verdict is-' + a.tone },
          Icon(a.tone === 'good' ? 'check-circle-2' : 'lightbulb', { size: 18, sw: 2.2 }),
          a.verdict
        ),
        h(
          'ul',
          { class: 'gb-money-advice-list' },
          a.reasons.map((r) => h('li', null, r))
        ),
        h('div', { class: 'gb-money-advice-closer' }, a.closer)
      );
      refreshIcons();
    };
    let asking = false;
    const setAsking = (on) => {
      asking = on;
      askBtn.disabled = on;
      askBtn.setAttribute('aria-busy', String(on));
    };
    const evaluate = () => {
      // A double tap (or Enter then tap) sent the same question to the AI twice.
      if (asking) return;
      const seq = ++adviceSeq;
      const p = Number(price.value);
      if (!item.value.trim() || !Number.isFinite(p) || p <= 0) {
        result.replaceChildren(
          h(
            'div',
            { class: 'gb-note-hint' },
            "Add an item and price, and I'll think it through with you."
          )
        );
        return;
      }
      const a = advise(money, item.value.trim(), p, reason.value.trim());
      renderHeuristic(a);
      // Upgrade to a real, tailored opinion when the AI is available; the
      // heuristic above stays as the instant + offline fallback.
      if (typeof requestAdvice !== 'function') return;
      const loading = Thinking('Asking Buddy for a closer look', [
        'Looking at your budget',
        'Weighing the price against your goals',
        'Writing a closer look',
      ]);
      result.appendChild(loading);
      setAsking(true);
      requestAdvice({
        item: item.value.trim(),
        price: Math.round(p),
        reason: reason.value.trim(),
        context: adviceContext(a, Math.round(p)),
      })
        .then((res) => {
          if (seq !== adviceSeq) return; // a newer evaluate() superseded this
          if (!res || !res.configured || !res.advice) {
            loading.remove();
            return;
          }
          result.replaceChildren(
            h(
              'div',
              { class: 'gb-money-advice-verdict is-info' },
              Icon('sparkles', { size: 18, sw: 2.2 }),
              "Buddy's take"
            ),
            h('p', { class: 'gb-money-coach-text', style: { marginTop: 'var(--space-2)' } }, res.advice)
          );
          refreshIcons();
        })
        .catch(() => {
          if (seq === adviceSeq) loading.remove();
        })
        .finally(() => setAsking(false));
    };
    const askBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--soft',
        style: { marginTop: '4px' },
        onclick: evaluate,
      },
      Icon('sparkles', { size: 15, sw: 2.2 }),
      'Ask the buddy'
    );
    [price, reason].forEach((el) =>
      el.addEventListener('keydown', (e) => e.key === 'Enter' && evaluate())
    );
    openMoneyModal({
      title: 'Should I buy this?',
      sub: 'No judgement — just an honest, friendly second opinion.',
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Item'),
        item,
        h('div', { class: 'gb-field-label' }, 'Price (' + cur + ')'),
        price,
        h('div', { class: 'gb-field-label' }, 'Reason for buying'),
        reason,
        askBtn,
        result
      ),
      primary: null,
    });
    setTimeout(() => item.focus(), 60);
  }

  function openAddGoal(planMode) {
    const name = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '60',
      placeholder: planMode ? 'e.g. New laptop' : 'e.g. New phone',
    });
    const target = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'decimal',
      min: '1',
      placeholder: 'e.g. 40000',
    });
    const due = h('input', { type: 'date', class: 'gb-input' });
    const suggestions = planMode
      ? ['Laptop', 'Phone', 'Headphones', 'Bike']
      : ['New Phone', 'Laptop', 'Emergency Fund', 'Vacation'];
    const chips = h(
      'div',
      { class: 'gb-money-goal-chips' },
      suggestions.map((s) =>
        h(
          'button',
          { type: 'button', class: 'gb-pill gb-money-chip', onclick: () => (name.value = s) },
          s
        )
      )
    );
    openMoneyModal({
      title: planMode ? 'Plan a purchase' : 'New savings goal',
      sub: planMode
        ? "Set a target date and I'll work out the weekly pace."
        : "Name it and set a target. I'll suggest a realistic pace.",
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, planMode ? 'Item' : 'Goal'),
        name,
        chips,
        h('div', { class: 'gb-field-label' }, 'Target amount (' + cur + ')'),
        target,
        h(
          'div',
          { class: 'gb-field-label' },
          planMode ? 'Desired purchase date' : 'Target date (optional)'
        ),
        due
      ),
      primary: planMode ? 'Plan it' : 'Create goal',
      onPrimary: async () => {
        const t = readAmount(target);
        if (!name.value.trim()) {
          name.focus();
          throw new Error('Give it a name.');
        }
        if (!Number.isFinite(t) || t <= 0) {
          target.focus();
          throw new Error('Set a target amount greater than zero.');
        }
        commit((m) =>
          m.goals.unshift({
            id: uid(),
            name: name.value.trim(),
            target: t,
            dueDate: due.value || null,
            createdAt: Date.now(),
            contribs: [],
          })
        );
        toast.success(planMode ? 'Purchase planned.' : 'Goal created.');
      },
    });
    setTimeout(() => name.focus(), 60);
  }

  function openContribute(goal) {
    const amt = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'decimal',
      min: '1',
      placeholder: 'e.g. 500',
    });
    const p = goalPlan(goal);
    openMoneyModal({
      title: 'Add to "' + goal.name + '"',
      sub:
        p.suggestedWeekly > 0
          ? 'A pace of ' +
            fmt(p.weeklyRate > 0 ? p.weeklyRate : p.suggestedWeekly) +
            '/week reaches it' +
            (p.etaKey ? ' by ' + fmtDateShort(p.etaKey) : '') +
            '.'
          : 'Every bit counts.',
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Amount to set aside (' + cur + ')'),
        amt
      ),
      primary: 'Add to goal',
      onPrimary: async () => {
        const v = readAmount(amt);
        if (!Number.isFinite(v) || v <= 0) {
          amt.focus();
          throw new Error('Enter an amount greater than zero.');
        }
        commit((m) => {
          const g = m.goals.find((x) => x.id === goal.id);
          if (g) (g.contribs = g.contribs || []).push({ date: todayKey(), amount: v });
        });
        toast.success('Nice — ' + fmt(v) + ' set aside.');
      },
    });
    setTimeout(() => amt.focus(), 60);
  }

  function openAddSubscription() {
    const name = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '40',
      placeholder: 'e.g. Netflix',
    });
    // Whole rupees: the server's WhatsApp path rounds a subscription's amount
    // and shares its expense id (`sub-<id>-<month>`), so paise here would split them.
    const amount = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'numeric',
      min: '1',
      step: '1',
      placeholder: 'e.g. 199',
    });
    const day = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'numeric',
      min: '1',
      max: '31',
      placeholder: 'Due day (1–31)',
    });
    const uses = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'numeric',
      min: '1',
      placeholder: 'Optional, e.g. 8',
    });
    const catSeg = tagPicker(money, save, { initial: 'entertainment' });
    openMoneyModal({
      title: 'Add subscription',
      sub: 'Recurring bills show up in reminders and your monthly forecast.',
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Name'),
        name,
        h('div', { class: 'gb-field-label' }, 'Amount / month (' + cur + ', whole amounts)'),
        amount,
        h('div', { class: 'gb-field-label' }, 'Due day of month'),
        day,
        h('div', { class: 'gb-field-label' }, 'Times you use it a month'),
        uses,
        h('div', { class: 'gb-field-label' }, 'Tag'),
        catSeg.node
      ),
      primary: 'Add subscription',
      onPrimary: async () => {
        const a = readWhole(amount);
        const d = Math.round(Number(day.value));
        if (!name.value.trim()) {
          name.focus();
          throw new Error('Name is required.');
        }
        if (!Number.isFinite(a) || a <= 0) {
          amount.focus();
          throw new Error('Enter a monthly amount.');
        }
        if (!Number.isFinite(d) || d < 1 || d > 31) {
          day.focus();
          throw new Error('Due day must be 1–31.');
        }
        commit((m) =>
          m.subscriptions.unshift({
            id: uid(),
            name: name.value.trim(),
            amount: a,
            dueDay: d,
            category: catSeg.get(),
            ...(Number(uses.value) > 0 ? { usesPerMonth: Math.round(Number(uses.value)) } : {}),
            createdAt: Date.now(),
          })
        );
        toast.success('Subscription added.');
      },
    });
    setTimeout(() => name.focus(), 60);
  }

  function openSubscriptionUses(sub) {
    const uses = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'numeric',
      min: '0',
      placeholder: 'e.g. 8',
      value: sub.usesPerMonth || '',
    });
    openMoneyModal({
      title: sub.name,
      sub: fmt(sub.amount) + ' a month, ' + fmt(sub.amount * 12) + ' a year.',
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Times you use it a month'),
        uses,
        h('div', { class: 'gb-note-hint' }, 'Leave empty if you would rather not count.')
      ),
      primary: 'Save',
      onPrimary: async () => {
        const v = Math.round(Number(uses.value));
        commit((m) => {
          const x = m.subscriptions.find((y) => y.id === sub.id);
          if (!x) return;
          if (v > 0) x.usesPerMonth = v;
          else delete x.usesPerMonth;
        });
      },
    });
    setTimeout(() => uses.focus(), 60);
  }

  function openAddWishlist() {
    const name = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '60',
      placeholder: 'e.g. Mechanical keyboard',
    });
    const price = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'decimal',
      min: '1',
      placeholder: 'e.g. 4500',
    });
    openMoneyModal({
      title: 'Add to wishlist',
      sub: "Park it here instead of buying now. I'll nudge you after a few days.",
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Item'),
        name,
        h('div', { class: 'gb-field-label' }, 'Price (' + cur + ')'),
        price
      ),
      primary: 'Add to wishlist',
      onPrimary: async () => {
        const p = readAmount(price);
        if (!name.value.trim()) {
          name.focus();
          throw new Error('Give the item a name.');
        }
        if (!Number.isFinite(p) || p <= 0) {
          price.focus();
          throw new Error('Enter a price.');
        }
        commit((m) =>
          m.wishlist.unshift({
            id: uid(),
            name: name.value.trim(),
            price: p,
            addedAt: todayKey(),
            status: 'waiting',
          })
        );
        toast.success('Added to wishlist — give it a few days.');
      },
    });
    setTimeout(() => name.focus(), 60);
  }

  function openChallenge() {
    // Tailored to this user's spending; common challenges when data is thin.
    const presets = suggestChallenges(money);
    const anyPersonalized = presets.some((p) => p.personalized);
    let dialog;
    const make = (p) => {
      const today = todayKey();
      const end =
        p.kind === 'save' || p.kind === 'logdays' || p.kind === 'reduce'
          ? thisMonthPrefix() + '-' + pad2(daysInMonth())
          : dkey(addDays(new Date(), (p.days || 1) - 1));
      commit((m) =>
        m.challenges.unshift({
          id: uid(),
          kind: p.kind,
          title: p.label,
          scope: p.scope || 'all',
          amount: p.amount || 0,
          pct: p.pct || 0,
          days: p.days || 0,
          start: today,
          end,
          createdAt: Date.now(),
        })
      );
      toast.success('Challenge started.');
      if (dialog) dialog.close();
    };
    dialog = openMoneyModal({
      title: 'Start a challenge',
      sub: anyPersonalized
        ? 'Picked from your spending. Small wins build big habits.'
        : 'Pick one. Small wins build big habits.',
      body: h(
        'div',
        { class: 'gb-money-preset-list' },
        presets.map((p) =>
          h(
            'button',
            { type: 'button', class: 'gb-money-preset', onclick: () => make(p) },
            Icon(p.personalized ? 'sparkles' : 'shield-check', { size: 16, sw: 2.2 }),
            h(
              'div',
              { class: 'gb-money-preset-main' },
              h('div', { class: 'gb-money-preset-label' }, p.label),
              p.reason ? h('div', { class: 'gb-money-preset-sub' }, p.reason) : null
            )
          )
        )
      ),
      primary: null,
    });
  }

  function openSimulator() {
    const kind = segmented(
      [
        { value: 'perDay', label: 'Save each day' },
        { value: 'reduce', label: 'Spend less on a tag' },
      ],
      'perDay'
    );
    const perDay = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'decimal',
      min: '1',
      placeholder: 'e.g. 100',
      value: '100',
    });
    const catSeg = tagPicker(money, save, { initial: 'shopping' });
    const pct = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'numeric',
      min: '1',
      max: '100',
      placeholder: 'e.g. 20',
      value: '20',
    });
    const months = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'numeric',
      min: '1',
      max: '24',
      value: '6',
    });
    const out = h('div', { class: 'gb-money-sim-out' });
    const perDayWrap = h(
      'div',
      null,
      h('div', { class: 'gb-field-label' }, 'Amount / day (' + cur + ')'),
      perDay
    );
    const reduceWrap = h(
      'div',
      { style: { display: 'none' } },
      h('div', { class: 'gb-field-label' }, 'Tag to cut'),
      catSeg.node,
      h('div', { class: 'gb-field-label' }, 'Reduce by (%)'),
      pct
    );
    kind.node.addEventListener('click', () => {
      const k = kind.get();
      perDayWrap.style.display = k === 'perDay' ? '' : 'none';
      reduceWrap.style.display = k === 'reduce' ? '' : 'none';
    });
    const run = () => {
      const sc =
        kind.get() === 'perDay'
          ? { kind: 'perDay', perDay: Number(perDay.value) || 0, months: Number(months.value) }
          : {
              kind: 'reduce',
              cat: catSeg.get(),
              pct: Number(pct.value) || 0,
              months: Number(months.value),
            };
      const r = goalSimulate(money, sc);
      out.replaceChildren(
        h(
          'div',
          { class: 'gb-money-sim-total' },
          h('span', null, r.label + ' for ' + r.months + ' months →'),
          h('strong', null, fmt(r.total))
        ),
        lineChart(r.series, 'var(--leaf-600)'),
        h('div', { class: 'gb-note-hint' }, '≈ ' + fmt(r.perWeek) + '/week set aside.')
      );
      refreshIcons();
    };
    openMoneyModal({
      title: 'Plan your savings',
      sub: 'See where small changes could take you.',
      body: h(
        'div',
        { class: 'gb-form' },
        kind.node,
        perDayWrap,
        reduceWrap,
        h('div', { class: 'gb-field-label' }, 'Over how many months?'),
        months,
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--soft',
            style: { marginTop: '4px' },
            onclick: run,
          },
          Icon('sparkles', { size: 15, sw: 2.2 }),
          'Show projection'
        ),
        out
      ),
      primary: null,
    });
    setTimeout(run, 60);
  }

  // 22 — share the week as a 9:16 image (story-shaped), text as the fallback.
  function summaryText() {
    const hsc = financialHealth(money).score;
    const r = weeklyReview(money);
    return `My Money Buddy week\n• Spent: ${fmt(r.total)}\n• Set aside: ${fmt(r.setAside)}\n• Logging streak: ${logStreak(money.expenses)} days\n• Financial health: ${hsc}/100\n${r.motivation}`;
  }

  function shareSummaryText() {
    const text = summaryText();
    if (navigator.share) navigator.share({ title: 'My Money Buddy', text }).catch(() => {});
    else if (navigator.clipboard)
      navigator.clipboard
        .writeText(text)
        .then(() => toast.success('Summary copied to clipboard.'))
        .catch(() => toast.error({ message: 'Could not copy.' }, 'Could not copy.'));
    else toast.error({ message: 'Sharing not supported here.' }, 'Sharing not supported here.');
  }

  async function shareSummary() {
    const r = weeklyReview(money);
    const streak = logStreak(money.expenses);
    try {
      const result = await shareStoryCard(
        {
          eyebrow: 'My money week',
          headline: fmt(r.total),
          sub: 'spent this week',
          stats: [
            { label: 'Set aside', value: fmt(r.setAside) },
            { label: 'Logging streak', value: streak + (streak === 1 ? ' day' : ' days') },
            { label: 'Financial health', value: financialHealth(money).score + '/100' },
          ],
          note: r.motivation,
          footer: 'Tracked with Growth Buddy',
        },
        { filename: 'money-week.png', title: 'My Money Buddy week' }
      );
      if (result === 'saved') toast.success('Image saved — add it to your story.');
      if (result === 'unsupported') shareSummaryText();
    } catch (err) {
      // Canvas or Blob unavailable (old WebView, a locked-down browser). The
      // text share has been the behaviour since day one; keep it as the floor.
      console.warn('Story card failed, sharing text instead:', err);
      shareSummaryText();
    }
  }

  /* =================================================================
     TAB: OVERVIEW
     ================================================================= */
  /* ---- Day summary under the Last 7 days bars ---- */
  // daySummaries (module level, cleared per visit) is keyed on the day's entries:
  // an expense added or edited that day changes the key, so a stale summary is
  // never shown (the server drops its cached one on the same change).

  function dayPanel(day) {
    const entries = money.expenses.filter((e) => e.date === day);
    const key = day + '|' + stable(entries);
    const got = daySummaries.get(key);
    const label = parseKey(day).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    const head = h(
      'div',
      { class: 'gb-money-day-head' },
      h('div', { class: 'gb-money-day-title' }, label),
      h(
        'div',
        { class: 'gb-money-day-total' },
        fmt(sumAmt(entries)) +
          ' · ' +
          entries.length +
          (entries.length === 1 ? ' expense' : ' expenses')
      )
    );
    if (!entries.length) {
      const noSpend = money.noSpendDays.includes(day);
      return h(
        'div',
        { class: 'gb-money-day', 'aria-live': 'polite' },
        head,
        h(
          'p',
          { class: 'gb-money-day-text' },
          noSpend
            ? 'You marked this a no-spend day. A win worth noticing.'
            : 'No log for this day. Did you spend anything?'
        ),
        noSpend
          ? null
          : h(
              'div',
              { class: 'gb-money-day-actions' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--soft gb-btn--compact',
                  onclick: () => openAddExpense(day),
                },
                Icon('plus', { size: 14, sw: 2.6 }),
                'Add an expense'
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--ghost gb-btn--compact',
                  onclick: () => {
                    commit((m) => (m.noSpendDays = [...new Set(m.noSpendDays.concat(day))]));
                    toast.success('Marked as a no-spend day.');
                  },
                },
                Icon('check', { size: 14, sw: 2.6 }),
                'I spent nothing'
              )
            )
      );
    }
    if (!got && requestDaySummary) {
      daySummaries.set(key, { loading: true });
      requestDaySummary(day)
        .then((r) => daySummaries.set(key, { data: r }))
        .catch((err) =>
          daySummaries.set(key, { error: (err && err.message) || 'Could not load it.' })
        )
        .then(() => {
          if (pickedDay === day) paint();
        });
    }
    const st = daySummaries.get(key) || {};
    const d = st.data;
    // The facts come from the phone's own copy, so they show at once; only the
    // coach's paragraph waits for the server.
    const cc = byCategory(entries, money);
    const cats = mergedCats(money)
      .filter((c) => cc[c.key] > 0)
      .sort((a, b) => cc[b.key] - cc[a.key]);
    const ent = d && d.entertainment;
    return h(
      'div',
      { class: 'gb-money-day', 'aria-live': 'polite' },
      head,
      h(
        'div',
        { class: 'gb-money-day-cats' },
        cats.map((c) =>
          h(
            'span',
            { class: 'gb-money-day-cat', style: { background: c.soft, color: c.fg } },
            Icon(c.icon, { size: 13, sw: 2.4 }),
            c.label + ' ' + fmt(cc[c.key])
          )
        )
      ),
      ent && ent.count
        ? h(
            'div',
            { class: 'gb-money-day-row' },
            h('span', null, 'Entertainment felt'),
            h(
              'strong',
              null,
              ent.avgSatisfaction != null
                ? ent.avgSatisfaction + ' / 5' + (ent.rated > 1 ? ' avg of ' + ent.rated : '')
                : 'not rated yet'
            )
          )
        : null,
      d && d.avoidable && d.avoidable.length
        ? h(
            'div',
            { class: 'gb-money-day-skip' },
            h('div', { class: 'gb-money-day-sub' }, 'Could skip next time'),
            d.avoidable.map((a) =>
              h(
                'div',
                { class: 'gb-money-day-row' },
                h('span', null, a.note, h('span', { class: 'gb-money-day-why' }, ' · ' + a.reason)),
                h('strong', null, fmt(a.amount))
              )
            )
          )
        : null,
      st.loading
        ? Thinking('Buddy is reading your day', ['Reading your day', 'Sorting what you spent', 'Writing a note'])
        : st.error
          ? h(
              'p',
              { class: 'gb-money-day-text' },
              st.error + ' ',
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-money-day-retry',
                  onclick: () => {
                    daySummaries.delete(key);
                    paint();
                  },
                },
                'Try again'
              )
            )
          : d
            ? h(
                'p',
                { class: 'gb-money-day-text' },
                d.source === 'ai' ? h('span', { class: 'gb-money-day-by' }, 'Buddy · ') : null,
                d.summary
              )
            : null
    );
  }

  /* One cell per day of the month. Past days are coloured against a flat daily
     share of the budget (or, with no budget, by how much was spent); a day with
     nothing logged is hollow, a no-spend day ringed, today outlined, the rest
     waiting. */
  function monthTape({ byDay, hasBudget, totalBudget, dim, dayNum, prefix, today }) {
    const flat = hasBudget ? totalBudget / dim : 0;
    const max = Math.max(1, ...Object.values(byDay));
    const cells = [];
    for (let d = 1; d <= dim; d++) {
      const key = prefix + '-' + String(d).padStart(2, '0');
      const spent = byDay[key] || 0;
      let state;
      if (d > dayNum) state = 'is-future';
      else if (!spent) state = money.noSpendDays.includes(key) ? 'is-nospend' : key === today ? 'is-empty' : 'is-nolog';
      else if (hasBudget) state = spent <= flat ? 'is-under' : spent <= flat * 1.5 ? 'is-near' : 'is-over';
      else state = 'lv-' + Math.min(4, Math.ceil((spent / max) * 4));
      const date = parseKey(key);
      const words =
        date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) +
        (d > dayNum
          ? ''
          : ', ' +
            (spent ? fmt(spent) : money.noSpendDays.includes(key) ? 'no-spend day' : 'nothing logged'));
      // Display only: a cell is ~8px wide on a phone, far under a 44px target.
      // Opening a day lives on the Spending tab's 7-day graph, whose columns are big.
      cells.push(
        h('span', {
          class: 'gb-money-tape-day ' + state + (key === today ? ' is-today' : ''),
          style: { '--i': String(d) },
          role: 'img',
          'aria-label': words,
          title: words,
        })
      );
    }
    const entering = !tapeShown;
    tapeShown = true;
    return h(
      'div',
      { class: 'gb-money-tape-wrap' },
      h(
        'div',
        {
          class: 'gb-money-tape' + (entering ? ' is-entering' : ''),
          role: 'group',
          'aria-label': 'Your month, day by day',
        },
        cells
      ),
      h(
        'div',
        { class: 'gb-money-tape-key' },
        h('span', null, '1'),
        hasBudget
          ? h(
              'span',
              { class: 'gb-money-tape-legend' },
              h('i', { class: 'is-under' }),
              'under',
              h('i', { class: 'is-near' }),
              'close',
              h('i', { class: 'is-over' }),
              'over its share'
            )
          : h('span', { class: 'gb-money-tape-legend' }, 'Darker days, more spent'),
        h('span', null, String(dim))
      )
    );
  }

  /* The hero answers the question people open Money with: how much can I spend
     today? Under it, the whole month as a tape of days, each coloured by how it
     went against its share, so the month reads at a glance. */
  function tabOverview() {
    const st = budgetStatus(money);
    const totalBudget = st.reduce((a, s) => a + s.budget, 0);
    const hasBudget = totalBudget > 0;
    const today = todayKey();
    const dim = daysInMonth();
    const dayNum = new Date().getDate();
    const prefix = thisMonthPrefix();
    const byDay = {};
    for (const e of inRange(money.expenses, prefix + '-01', today))
      byDay[e.date] = (byDay[e.date] || 0) + (Number(e.amount) || 0);
    const spentMonth = Object.values(byDay).reduce((a, v) => a + v, 0);
    const spentToday = byDay[today] || 0;
    const daysLeft = dim - dayNum + 1;
    // Today's share: what is left of the month's budget before today, spread
    // over the days still to come (today included).
    const share = hasBudget ? (totalBudget - (spentMonth - spentToday)) / daysLeft : 0;
    const left = share - spentToday;

    let figure, label, meta, tone;
    if (!hasBudget) {
      figure = fmt(spentToday);
      label = 'spent today';
      meta = fmt(spentMonth) + ' so far this month';
      tone = '';
    } else if (left >= 0) {
      figure = fmt(left);
      label = 'left for today';
      meta = fmt(Math.max(0, totalBudget - spentMonth)) + ' left this month · ' + daysLeft + (daysLeft === 1 ? ' day' : ' days') + ' to go';
      tone = 'is-under';
    } else if (daysLeft > 1) {
      // Past today's share: the useful number is the next one, not the overshoot.
      // Money is framed as growth here, so the headline is forward-looking and calm.
      figure = fmt(Math.max(0, (totalBudget - spentMonth) / (daysLeft - 1)));
      label = 'a day from tomorrow';
      meta = 'Today went ' + fmt(-left) + " past its share, so the rest of the month has adjusted.";
      tone = '';
    } else {
      figure = fmt(Math.max(0, totalBudget - spentMonth));
      label = 'left this month';
      meta = 'Last day of the month. A new share starts tomorrow.';
      tone = '';
    }

    const hero = h(
      'div',
      { class: 'gb-money-hero gb-money-today ' + tone },
      h(
        'div',
        { class: 'gb-money-today-top' },
        h(
          'div',
          { class: 'gb-money-today-read' },
          h(
            'div',
            { class: 'gb-money-hero-eyebrow' },
            Icon('wallet', { size: 14, sw: 2.4 }),
            parseKey(today).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
          ),
          h(
            'div',
            { class: 'gb-money-today-fig' },
            h('span', { class: 'gb-money-today-num' }, figure),
            h('span', { class: 'gb-money-today-label' }, label)
          ),
          h('div', { class: 'gb-money-today-meta' }, meta)
        ),
        h(
          'div',
          { class: 'gb-money-hero-actions' },
          h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--primary gb-btn--compact', onclick: () => openAddExpense() },
            Icon('plus', { size: 15, sw: 2.6 }),
            'Add expense'
          ),
          h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--secondary gb-btn--compact', onclick: openPurchaseAdvisor },
            Icon('sparkles', { size: 15, sw: 2.2 }),
            'Should I buy this?'
          )
        )
      ),
      monthTape({ byDay, hasBudget, totalBudget, dim, dayNum, prefix, today }),
      h('p', { class: 'gb-money-today-say' }, buddyLine())
    );
    // Overview stays a glance: where you stand, your health, where the money
    // goes, and where the month is heading. Spending/Coach own the detail.
    return [
      hero,
      accountsCard(),
      healthCard(),
      ...budgetsSection(),
      ...goalsSection(),
      donutCard(),
      forecastCard(),
    ];
  }

  function donutCard() {
    const mExp = inRange(money.expenses, thisMonthPrefix() + '-01', todayKey());
    if (!mExp.length) return null;
    const cc = byCategory(mExp, money);
    const segs = mergedCats(money)
      .map((c) => ({ label: c.label, color: c.color, value: cc[c.key] }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    return Card({
      className: 'gb-money-card',
      children: [
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'This month')),
        h(
          'div',
          { class: 'gb-money-donut-row' },
          donut(segs, fmt(sumAmt(mExp)), 'spent'),
          h(
            'div',
            { class: 'gb-money-legend' },
            segs.map((s) =>
              h(
                'div',
                { class: 'gb-money-legend-row' },
                h('span', { class: 'gb-money-legend-dot', style: { background: s.color } }),
                h('span', { class: 'gb-money-legend-label' }, s.label),
                h('span', { class: 'gb-money-legend-val' }, fmt(s.value))
              )
            )
          )
        ),
      ],
    });
  }

  function buddyLine() {
    const st = budgetStatus(money).filter((s) => s.base > 0);
    const over = st.filter((s) => s.pct > 100);
    const near = st.filter((s) => s.pct >= 80 && s.pct <= 100);
    const streak = logStreak(money.expenses);
    if (!money.expenses.length)
      return "Let's start small. Add your first expense and I'll take it from here.";
    if (over.length)
      return `Heads up — you've passed your ${over[0].cat.label} budget. Let's ease off there and rebalance.`;
    if (near.length)
      return `You're close on ${near[0].cat.label} (${near[0].pct}% used), but there's room elsewhere.`;
    if (streak >= 3)
      return `${streak}-day logging streak — this is exactly how clarity is built. Keep going!`;
    if (st.length) return `Looking good — your budgets have breathing room this month.`;
    return `Set a budget or two and I can help you stay on track, gently.`;
  }

  const TEXT_TONE = {
    'var(--success)': 'var(--success-soft-fg)',
    'var(--warning)': 'var(--warning-soft-fg)',
    'var(--brand)': 'var(--brand-soft-fg)',
  };
  function healthCard() {
    const hs = financialHealth(money);
    const color =
      hs.score >= 70 ? 'var(--success)' : hs.score >= 45 ? 'var(--warning)' : 'var(--brand)';
    const FIX = {
      budgets: { label: 'Set budgets', icon: 'target', run: openSetBudgets },
      goal: { label: 'Create a goal', icon: 'sprout', run: () => openAddGoal(false) },
      log: { label: 'Add expense', icon: 'plus', run: () => openAddExpense() },
    };
    // Two parts can share one fix (no goals zeroes both goal parts): one button each.
    const fixes = [...new Set(hs.parts.map((p) => p.fix).filter(Boolean))];
    const verdict =
      hs.score >= 70
        ? 'In great shape.'
        : hs.score >= 45
          ? 'Steady, with room to grow.'
          : hs.score > 0
            ? 'A good start.'
            : 'Nothing scored yet.';
    const firstOf = new Set();
    return Card({
      className: 'gb-money-card',
      children: [
        h(
          'div',
          { class: 'gb-money-health-head' },
          ProgressRing({
            value: hs.score,
            size: 84,
            stroke: 9,
            color,
            children: [
              // The ring takes the colour; the number takes its darker text tone, so
              // a 22px figure clears 3:1 (raw coral on white is 2.8:1).
              h(
                'div',
                { class: 'gb-money-health-score', style: { color: TEXT_TONE[color] || color } },
                String(hs.score)
              ),
              h('div', { class: 'gb-money-ring-lbl' }, '/ 100'),
            ],
          }),
          h(
            'div',
            null,
            h('h3', { class: 'gb-money-health-title' }, 'Financial health'),
            h(
              'p',
              { class: 'gb-money-health-verdict' },
              verdict +
                (fixes.length
                  ? ' ' +
                    fixes.length +
                    (fixes.length === 1 ? ' step' : ' steps') +
                    ' below will raise it.'
                  : '')
            )
          )
        ),
        h(
          'div',
          { class: 'gb-money-health-parts' },
          hs.parts.map((p) => {
            const fix = p.fix && !firstOf.has(p.fix) ? FIX[p.fix] : null;
            if (p.fix) firstOf.add(p.fix);
            return h(
              'div',
              { class: 'gb-money-health-part' + (p.score === 0 ? ' is-empty' : '') },
              h(
                'div',
                { class: 'gb-money-health-part-top' },
                h('span', null, p.label),
                h('span', { class: 'gb-money-health-part-val' }, p.score + ' / ' + p.max)
              ),
              h(
                'div',
                { class: 'gb-money-health-track' },
                h('div', {
                  class: 'gb-money-health-fill',
                  style: { width: Math.round((p.score / p.max) * 100) + '%' },
                })
              ),
              h(
                'div',
                { class: 'gb-money-health-foot' },
                h('span', { class: 'gb-money-health-note' }, p.note),
                fix
                  ? h(
                      'button',
                      { type: 'button', class: 'gb-money-health-fix', onclick: fix.run },
                      Icon(fix.icon, { size: 13, sw: 2.4 }),
                      fix.label
                    )
                  : null
              )
            );
          })
        ),
        // Once nothing is at zero, the buttons are gone; the one tip left is the
        // weakest area, so the card still ends on a next step.
        fixes.length
          ? null
          : coachCard(
              'lightbulb',
              'Next step',
              h(
                'p',
                { class: 'gb-money-coach-text' },
                `Your weakest area is ${hs.weakest.label.toLowerCase()}: ${hs.weakest.note.toLowerCase()}.`
              )
            ),
      ],
    });
  }

  function dailyTipCard() {
    return h(
      'div',
      { class: 'gb-money-tip' },
      h('span', { class: 'gb-money-tip-ic' }, Icon('lightbulb', { size: 18, sw: 2.2 })),
      h(
        'div',
        null,
        h('div', { class: 'gb-money-tip-label' }, 'Tip of the day'),
        h('div', { class: 'gb-money-tip-text' }, dailyTip(money))
      )
    );
  }

  function insightCard() {
    const insights = buildInsights(money);
    const tips = coachTips(money);
    const TONE_IC = {
      up: 'trending-up',
      down: 'trending-down',
      flat: 'activity',
      info: 'lightbulb',
    };
    return Card({
      className: 'gb-money-card',
      children: [
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'Insights & coaching')),
        h(
          'div',
          { class: 'gb-money-insights' },
          insights.map((i) =>
            h(
              'div',
              { class: 'gb-money-insight is-' + i.tone },
              h(
                'span',
                { class: 'gb-money-insight-ic' },
                Icon(TONE_IC[i.tone] || 'lightbulb', { size: 16, sw: 2.2 })
              ),
              h('span', null, i.text)
            )
          )
        ),
        tips.length
          ? h(
              'div',
              { class: 'gb-money-insights' },
              tips.map((t) =>
                h(
                  'div',
                  { class: 'gb-money-insight is-info' },
                  h(
                    'span',
                    { class: 'gb-money-insight-ic' },
                    Icon('sparkles', { size: 16, sw: 2.2 })
                  ),
                  h('span', null, t)
                )
              )
            )
          : null,
      ],
    });
  }

  function gamificationStrip() {
    const lvl = levelInfo(money);
    const streak = logStreak(money.expenses);
    return Card({
      className: 'gb-money-card',
      children: [
        h(
          'div',
          { class: 'gb-money-game-head' },
          h(
            'div',
            { class: 'gb-money-level' },
            h('span', { class: 'gb-money-level-badge' }, 'Lv ' + lvl.level),
            h(
              'div',
              { class: 'gb-money-level-bar' },
              h('div', {
                class: 'gb-money-level-fill',
                style: { width: Math.max(4, lvl.pct) + '%' },
              })
            )
          ),
          h(
            'div',
            { class: 'gb-money-streak' },
            Icon('flame', {
              size: 16,
              sw: 2.2,
              color: streak > 0 ? 'var(--coral-500)' : 'var(--fg3)',
            }),
            h('span', null, streak + '-day streak')
          )
        ),
        h(
          'div',
          { class: 'gb-money-badges' },
          badges(money).map((b) =>
            h(
              'div',
              { class: 'gb-money-badge' + (b.earned ? ' is-earned' : ''), title: b.desc },
              h('span', { class: 'gb-money-badge-ic' }, Icon(b.icon, { size: 18, sw: 2.2 })),
              h('span', { class: 'gb-money-badge-lbl' }, b.label),
              b.progress && !b.earned
                ? h('span', { class: 'gb-money-badge-prog' }, b.progress)
                : b.earned
                  ? Icon('check-circle-2', { size: 13, sw: 2.4, color: 'var(--success)' })
                  : null
            )
          )
        ),
      ],
    });
  }

  function weeklyReviewCard() {
    const r = weeklyReview(money);
    return Card({
      className: 'gb-money-card',
      children: [
        h(
          'div',
          { class: 'gb-sectiontitle' },
          h('h3', null, 'Weekly review'),
          h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: shareSummary },
            Icon('share-2', { size: 14, sw: 2.2 }),
            'Share summary'
          )
        ),
        h(
          'div',
          { class: 'gb-money-review-stats' },
          stat('Spent', fmt(r.total)),
          stat('Set aside', fmt(r.setAside)),
          stat('Top tag', r.topCat ? r.topCat.label : '—'),
          stat('Biggest treat', r.biggest ? fmt(r.biggest.amount) : '—')
        ),
        coachCard(
          'heart',
          'This week',
          h('p', { class: 'gb-money-coach-text' }, r.motivation),
          'good'
        ),
        coachCard(
          'sprout',
          'One gentle nudge',
          h('p', { class: 'gb-money-coach-text' }, r.improvement)
        ),
      ],
    });
  }

  function forecastCard() {
    const f = forecast(money);
    if (!f.hasData) return null;
    return Card({
      className: 'gb-money-card',
      children: [
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'Month forecast')),
        h(
          'div',
          { class: 'gb-money-forecast-top' },
          h(
            'div',
            null,
            h('div', { class: 'gb-money-forecast-num' }, fmt(f.projected)),
            h(
              'div',
              { class: 'gb-money-forecast-lbl' },
              'projected total · ' +
                fmt(f.spent) +
                ' so far' +
                (f.bills ? ' · ' + fmt(f.bills) + ' in bills to come' : '') +
                (f.recurringOut ? ' · ' + fmt(f.recurringOut) + ' in repeats to come' : '')
            ),
            f.expectedIncome
              ? h(
                  'div',
                  { class: 'gb-money-forecast-lbl gb-money-forecast-in' },
                  fmt(f.expectedIncome) + ' expected in before the month ends'
                )
              : null
          ),
          f.potential > 0
            ? h(
                'div',
                { class: 'gb-money-forecast-save' },
                h(
                  'div',
                  { class: 'gb-money-forecast-num', style: { color: 'var(--success)' } },
                  fmt(f.potential)
                ),
                h('div', { class: 'gb-money-forecast-lbl' }, 'savable / month')
              )
            : null
        ),
        f.willExceed.length
          ? h(
              'div',
              { class: 'gb-money-forecast-warn' },
              Icon('lightbulb', { size: 15, sw: 2.2 }),
              h(
                'span',
                null,
                'On track to exceed: ' + f.willExceed.map((w) => w.cat.label).join(', ') + '.'
              )
            )
          : h(
              'div',
              { class: 'gb-money-forecast-ok' },
              Icon('check-circle-2', { size: 15, sw: 2.2 }),
              h('span', null, 'No budgets projected to overflow. Nicely paced.')
            ),
        f.topDisc && f.potential > 0
          ? h(
              'div',
              { class: 'gb-note-hint' },
              `Trimming ${f.topDisc.label} ~20% could free about ${fmt(f.potential)} this month.`
            )
          : null,
      ],
    });
  }

  function personalityCard() {
    const p = personality(money);
    return Card({
      className: 'gb-money-card',
      children: [
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'Your money personality')),
        p
          ? h(
              'div',
              { class: 'gb-money-personality' },
              h(
                'div',
                { class: 'gb-money-personality-head' },
                h(
                  'span',
                  { class: 'gb-money-personality-ic' },
                  Icon(p.icon, { size: 22, sw: 2.2 })
                ),
                h(
                  'div',
                  null,
                  h('div', { class: 'gb-money-personality-type' }, p.label),
                  h('div', { class: 'gb-money-personality-blurb' }, p.blurb)
                )
              ),
              h(
                'ul',
                { class: 'gb-money-personality-tips' },
                p.tips.map((t) => h('li', null, t))
              )
            )
          : emptyHint('brain', "Log around 8 expenses and I'll reveal your spending personality."),
      ],
    });
  }

  function recoveryCard() {
    const plan = recoveryPlan(money);
    if (!plan) return null;
    return Card({
      className: 'gb-money-card',
      children: [
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'Recovery plan')),
        h(
          'div',
          { class: 'gb-money-recovery-sum' },
          Icon('shield-check', { size: 16, sw: 2.2 }),
          h('span', null, plan.summary)
        ),
        h(
          'ol',
          { class: 'gb-money-recovery-steps' },
          plan.steps.map((s) => h('li', null, s.text))
        ),
      ],
    });
  }

  /* =================================================================
     TAB: SPENDING
     ================================================================= */
  function tabSpending() {
    const actions = h(
      'div',
      { class: 'gb-money-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary gb-btn--compact',
          onclick: () => openAddExpense(),
        },
        Icon('plus', { size: 15, sw: 2.6 }),
        'Add expense'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--secondary gb-btn--compact',
          onclick: openReceiptScan,
        },
        Icon('receipt', { size: 15, sw: 2.2 }),
        'Scan receipt'
      ),
      (() => {
        const noSpendToday = (money.noSpendDays || []).includes(todayKey());
        return h(
          'button',
          {
            type: 'button',
            class:
              'gb-btn gb-btn--compact ' + (noSpendToday ? 'gb-btn--success' : 'gb-btn--soft'),
            onclick: () => logNoSpendDay(money, save),
          },
          Icon('circle-check', { size: 15, sw: 2.4 }),
          noSpendToday ? 'Logged: no spend' : 'No-spend day'
        );
      })()
    );

    const searchInput = h('input', {
      type: 'search',
      class: 'gb-input',
      placeholder: 'e.g. what could I skip?',
      value: lastSearch,
      // Kept as typed, so a save's repaint doesn't wipe a half-typed question.
      oninput: () => (lastSearch = searchInput.value),
    });
    const searchOut = h('div', { class: 'gb-money-search-out' });
    const runSearch = (q = searchInput.value) => {
      searchAsked = q;
      const r = searchExpenses(money, q);
      // replaceChildren is native DOM: a null child stringifies into the literal
      // text "null" under the answer. Drop it instead.
      searchOut.replaceChildren(
        ...[
          h('div', { class: 'gb-money-search-answer' }, r.answer),
          r.results.length
            ? h(
                'div',
                { class: 'gb-money-exp-list' },
                r.results.slice(0, 12).map((e) => expRow(e))
              )
            : null,
        ].filter(Boolean)
      );
      refreshIcons();
    };
    searchInput.addEventListener('keydown', (e) => e.key === 'Enter' && runSearch());
    if (searchAsked) runSearch(searchAsked);
    const searchCard = Card({
      className: 'gb-money-card',
      children: [
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'Ask about your spending')),
        h(
          'div',
          { class: 'gb-money-searchbar' },
          Icon('search', { size: 16, sw: 2.2 }),
          searchInput,
          h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: () => runSearch() },
            'Search'
          )
        ),
        searchOut,
      ],
    });

    const weekTotal = sumAmt(inRange(money.expenses, lastNDays(7)[0], todayKey()));
    const weekCard = Card({
      className: 'gb-money-card',
      children: [
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'Last 7 days')),
        h(
          'div',
          { class: 'gb-money-week-total' },
          fmt(weekTotal),
          h('span', { class: 'gb-money-week-avg' }, 'spent · ' + fmt(weekTotal / 7) + ' a day on average')
        ),
        weekBars(money.expenses, {
          noSpendDays: money.noSpendDays,
          selected: pickedDay,
          onPick: (k) => {
            pickedDay = pickedDay === k ? null : k;
            paint();
          },
        }),
        pickedDay
          ? dayPanel(pickedDay)
          : h('p', { class: 'gb-money-week-hint' }, 'Tap a day to see where it went.'),
      ],
    });

    const mExp = inRange(money.expenses, thisMonthPrefix() + '-01', todayKey());
    const cc = byCategory(mExp, money);
    const maxCat = Math.max(1, ...mergedCats(money).map((c) => cc[c.key]));
    const breakdown = Card({
      className: 'gb-money-card',
      children: [
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'By tag')),
        h(
          'div',
          { class: 'gb-money-catlist' },
          mergedCats(money)
            .filter((c) => cc[c.key] > 0)
            .sort((a, b) => cc[b.key] - cc[a.key])
            .map((c) =>
              h(
                'div',
                { class: 'gb-money-catrow' },
                h(
                  'span',
                  { class: 'gb-money-cat-ic', style: { background: c.soft, color: c.fg } },
                  Icon(c.icon, { size: 15, sw: 2.2 })
                ),
                h(
                  'div',
                  { class: 'gb-money-cat-main' },
                  h(
                    'div',
                    { class: 'gb-money-cat-top' },
                    h('span', null, c.label),
                    h('span', { class: 'gb-money-cat-amt' }, fmt(cc[c.key]))
                  ),
                  h(
                    'div',
                    { class: 'gb-money-cat-track' },
                    h('div', {
                      class: 'gb-money-cat-fill',
                      style: {
                        width: Math.round((cc[c.key] / maxCat) * 100) + '%',
                        background: c.color,
                      },
                    })
                  )
                )
              )
            )
        ),
        mExp.length ? null : emptyHint('shapes', 'No spending logged this month yet.'),
      ],
    });

    const filterSeg = segmented(
      [{ value: 'all', label: 'All' }].concat(
        mergedCats(money).map((c) => ({ value: c.key, label: c.label }))
      ),
      spendFilter,
      (v) => {
        spendFilter = v;
        expShown = EXP_PAGE;
        paint();
      }
    );
    // The strip scrolls sideways; a repaint rebuilt it at scrollLeft 0, so a
    // picked tag far down the list looked like it had snapped back to All.
    const filterStrip = h(
      'div',
      { class: 'gb-money-filter', onscroll: (e) => (filterScroll = e.currentTarget.scrollLeft) },
      filterSeg.node
    );
    requestAnimationFrame(() => (filterStrip.scrollLeft = filterScroll));
    // Any loaded month (the server sends ~13); a fresh visit is back on this one.
    const olderIds = new Set(older ? older.expenses.map((e) => e.id) : []);
    const allExp = withOlder(money).expenses;
    const months = Array.from(
      new Set([thisMonthPrefix()].concat(allExp.map((e) => (e.date || '').slice(0, 7))))
    )
      .filter((k) => /^\d{4}-\d{2}$/.test(k))
      .sort()
      .reverse();
    const shownMonth = expMonth && months.includes(expMonth) ? expMonth : thisMonthPrefix();
    const isThisMonth = shownMonth === thisMonthPrefix();
    const monthLabel = (k) =>
      parseKey(k + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const monthPick =
      months.length > 1
        ? h(
            'select',
            {
              class: 'gb-input gb-money-month-pick',
              'aria-label': 'Month to show',
              onchange: (e) => {
                expMonth = e.currentTarget.value;
                expShown = EXP_PAGE;
                paint();
              },
            },
            months.map((k) =>
              h('option', { value: k, selected: k === shownMonth }, k === thisMonthPrefix() ? 'This month' : monthLabel(k))
            )
          )
        : null;
    let list = (isThisMonth ? mExp : inRange(allExp, shownMonth + '-01', shownMonth + '-31'))
      .slice()
      .sort((a, b) =>
        b.date < a.date ? -1 : b.date > a.date ? 1 : (b.createdAt || 0) - (a.createdAt || 0)
      );
    if (spendFilter !== 'all') list = list.filter((e) => e.category === spendFilter);
    const recent = Card({
      className: 'gb-money-card',
      children: [
        h(
          'div',
          { class: 'gb-sectiontitle' },
          h('h3', null, isThisMonth ? 'This month' : monthLabel(shownMonth)),
          h(
            'div',
            { class: 'gb-money-list-tools' },
            monthPick,
            money.expenses.length || money.income.length
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-btn gb-btn--ghost gb-btn--compact',
                    title: 'Everything loaded: about the last 13 months',
                    onclick: () => downloadLedgerCsv(withOlder(money)),
                  },
                  Icon('file', { size: 14, sw: 2.4 }),
                  'CSV'
                )
              : null
          )
        ),
        filterStrip,
        list.length
          ? h(
              'div',
              { class: 'gb-money-exp-list' },
              // An older page's rows are view-only: they aren't in the document.
              list.slice(0, expShown).map((e) => expRow(e, !olderIds.has(e.id)))
            )
          : emptyHint(
              'wallet',
              spendFilter === 'all'
                ? isThisMonth
                  ? 'Nothing logged this month yet. Add your first above.'
                  : 'Nothing logged in ' + monthLabel(shownMonth) + '.'
                : 'Nothing in ' + catOf(spendFilter, money).label + (isThisMonth ? ' this month.' : ' in ' + monthLabel(shownMonth) + '.')
            ),
        list.length > expShown
          ? h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--ghost gb-btn--compact gb-money-showall',
                onclick: () => {
                  expShown += EXP_PAGE;
                  paint();
                },
              },
              'Show more (' + (list.length - expShown) + ' left)'
            )
          : null,
        typeof requestOlderTx === 'function' && (!older || older.more)
          ? h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--ghost gb-btn--compact gb-money-showall gb-money-older',
                disabled: olderBusy,
                title: 'The app loads about 13 months; this fetches the 200 or so entries before that',
                onclick: loadOlder,
              },
              Icon('history', { size: 14, sw: 2.4 }),
              olderBusy ? 'Loading…' : 'Load older'
            )
          : null,
      ],
    });

    return [
      actions,
      searchCard,
      weekCard,
      breakdown,
      weeklyReviewCard(),
      subscriptionsCard(),
      recent,
    ];
  }

  /* The loaded document plus any older pages, for the expense list and the CSV. */
  function withOlder(m) {
    if (!older) return m;
    const out = Object.assign({}, m);
    for (const k of Object.keys(LEDGER_ARRAYS)) {
      const have = new Set((m[k] || []).map((x) => x.id));
      out[k] = (m[k] || []).concat((older[k] || []).filter((x) => !have.has(x.id)));
    }
    return out;
  }
  async function loadOlder() {
    if (olderBusy || typeof requestOlderTx !== 'function') return;
    const all = withOlder(money);
    let before = todayKey();
    for (const k of Object.keys(LEDGER_ARRAYS))
      for (const x of all[k] || []) if (x.date && x.date < before) before = x.date;
    olderBusy = true;
    paint();
    try {
      const page = await requestOlderTx(before);
      const prev = older || { expenses: [], income: [], transfers: [] };
      older = { more: !!(page && page.more) };
      for (const k of Object.keys(LEDGER_ARRAYS))
        older[k] = prev[k].concat(Array.isArray(page && page[k]) ? page[k] : []);
      const newest = ((page && page.expenses) || [])[0];
      if (newest && newest.date) {
        expMonth = newest.date.slice(0, 7);
        expShown = EXP_PAGE;
      } else if (!older.more) toast.success('That is everything: nothing older is logged.');
    } catch (err) {
      toast.error(err, 'Could not load older entries. Try again.');
    } finally {
      olderBusy = false;
      paint();
    }
  }

  function expRow(e, withDelete) {
    const c = catOf(e.category, money);
    return h(
      'div',
      { class: 'gb-money-exp-row' },
      h(
        'span',
        { class: 'gb-money-cat-ic', style: { background: c.soft, color: c.fg } },
        Icon(c.icon, { size: 15, sw: 2.2 })
      ),
      h(
        withDelete ? 'button' : 'div',
        withDelete
          ? {
              type: 'button',
              class: 'gb-money-exp-main gb-money-exp-edit',
              'aria-label': 'Edit ' + (e.note || c.label) + ', ' + fmt(e.amount),
              onclick: () => openEditExpense(e),
            }
          : { class: 'gb-money-exp-main' },
        h(
          'div',
          { class: 'gb-money-exp-note' },
          e.note || c.label,
          e.reflection
            ? h(
                'span',
                {
                  class: 'gb-money-reflect-dot',
                  title: 'Reflected · ' + e.reflection.satisfaction + '/5',
                },
                Icon('heart', { size: 11, sw: 2.4 })
              )
            : null
        ),
        h(
          'div',
          { class: 'gb-money-exp-meta' },
          [c.label, fmtDateShort(e.date), (accountOf(money, e.accountId) || {}).name, e.why]
            .filter(Boolean)
            .join(' · ')
        )
      ),
      h(
        'div',
        { class: 'gb-money-exp-amt' },
        fmt(e.amount),
        // Paid in another currency: what it was, under what it counts as.
        e.orig && e.orig.currency
          ? h('div', { class: 'gb-money-exp-meta gb-money-exp-orig' }, fmtIn(e.orig.amount, e.orig.currency))
          : null
      ),
      withDelete
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-icon-btn',
              'aria-label': 'Delete expense',
              onclick: () =>
                confirmDelete(
                  'Delete expense',
                  'Delete "' + (e.note || c.label) + '" (' + fmt(e.amount) + ')?',
                  async () => {
                    commit((m) => (m.expenses = m.expenses.filter((x) => x.id !== e.id)));
                    toast.success('Expense deleted.');
                  }
                ),
            },
            Icon('trash-2', { size: 15, sw: 2.4 })
          )
        : null
    );
  }

  function subscriptionsCard() {
    const subs = money.subscriptions || [];
    const upcoming = upcomingSubs(money);
    return Card({
      className: 'gb-money-card',
      children: [
        h(
          'div',
          { class: 'gb-sectiontitle' },
          h('h3', null, 'Subscriptions'),
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft gb-btn--compact',
              onclick: openAddSubscription,
            },
            Icon('plus', { size: 14, sw: 2.6 }),
            'Add subscription'
          )
        ),
        subs.length
          ? h(
              'div',
              { class: 'gb-money-sub-total' },
              fmt(subsMonthlyTotal(money)) +
                ' / month · ' +
                fmt(subsMonthlyTotal(money) * 12) +
                ' / year across ' +
                subs.length +
                ' subscription' +
                (subs.length === 1 ? '' : 's')
            )
          : null,
        upcoming.length
          ? upcoming.map((u) =>
              coachCard(
                'bell',
                u.sub.name +
                  (u.overdue
                    ? ' overdue · was due ' +
                      (-u.inDays === 1 ? 'yesterday' : -u.inDays + ' days ago')
                    : ' due ' +
                      (u.inDays === 0
                        ? 'today'
                        : 'in ' + u.inDays + ' day' + (u.inDays === 1 ? '' : 's'))),
                [
                  h(
                    'p',
                    { class: 'gb-money-coach-text' },
                    fmt(u.sub.amount) + ' · day ' + u.due + ' of the month.'
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'gb-btn gb-btn--soft gb-btn--compact',
                      onclick: () => {
                        // Same rule as the server's applyPaid: no amount, nothing to book.
                        if (!(Number(u.sub.amount) > 0)) {
                          toast.error(null, 'Add an amount to ' + u.sub.name + ' first.');
                          return;
                        }
                        commit((m) => {
                          const sub = m.subscriptions.find((x) => x.id === u.sub.id);
                          if (!sub || (sub.paidFor || '') >= u.month) return;
                          sub.paidFor = u.month;
                          // Same id the WhatsApp button uses, so a tap on both logs one expense.
                          // Same account rule as the WhatsApp button: a bill is paid
                          // from the bank unless the subscription says otherwise.
                          const accountId = sub.accountId || firstOfKind(m, ['bank', 'card']);
                          m.expenses.unshift({
                            id: 'sub-' + sub.id + '-' + u.month,
                            amount: sub.amount,
                            category: sub.category || 'others',
                            note: sub.name,
                            date: todayKey(),
                            createdAt: Date.now(),
                            ...(accountId ? { accountId } : {}),
                          });
                        });
                        toast.success(u.sub.name + ' marked as paid.');
                      },
                    },
                    Icon('check', { size: 14, sw: 2.6 }),
                    'Mark as paid'
                  ),
                ],
                'warn'
              )
            )
          : null,
        subs.length
          ? h(
              'div',
              { class: 'gb-money-sub-list' },
              subs.map((s) =>
                h(
                  'div',
                  { class: 'gb-money-exp-row' },
                  h(
                    'span',
                    {
                      class: 'gb-money-cat-ic',
                      style: {
                        background: catOf(s.category, money).soft,
                        color: catOf(s.category, money).fg,
                      },
                    },
                    Icon(catOf(s.category, money).icon, { size: 15, sw: 2.2 })
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'gb-money-exp-main gb-money-exp-edit',
                      'aria-label': 'Set how often you use ' + s.name,
                      onclick: () => openSubscriptionUses(s),
                    },
                    h('div', { class: 'gb-money-exp-note' }, s.name),
                    h(
                      'div',
                      { class: 'gb-money-exp-meta' },
                      'Day ' +
                        s.dueDay +
                        ' · ' +
                        fmt(s.amount * 12) +
                        ' / year · ' +
                        (costPerUse(s) != null
                          ? fmt(costPerUse(s)) + ' per use'
                          : 'tap to add uses')
                    )
                  ),
                  h('div', { class: 'gb-money-exp-amt' }, fmt(s.amount)),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'gb-icon-btn',
                      'aria-label': 'Delete subscription',
                      onclick: () =>
                        confirmDelete('Delete subscription', 'Delete "' + s.name + '"?', () => {
                          commit((m) => removeDocItem(m, 'subscriptions', s.id));
                          toast.success('Subscription deleted.');
                        }),
                    },
                    Icon('trash-2', { size: 15, sw: 2.4 })
                  )
                )
              )
            )
          : emptyHint(
              'bell',
              'Add recurring bills like Netflix or rent to see reminders and forecasts.'
            ),
      ],
    });
  }

  /* =================================================================
     TAB: BUDGETS
     ================================================================= */
  /* Budgets and goals live on Overview, right under the health score that tells
     you to set them: as their own tabs, "Set budgets to score this" pointed at a
     screen you had to go and find. One card each, so the page stays scannable. */
  function budgetsSection() {
    const st = budgetStatus(money);
    const anySet = st.some((s) => s.base > 0);
    // Empty, it only repeats the health card's "Set budgets" as a tall blank card.
    if (!anySet) return [];
    const headKids = [
      h(
        'div',
        { class: 'gb-sectiontitle' },
        h('h3', null, 'Monthly budgets'),
        h(
          'div',
          { class: 'gb-money-head-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft gb-btn--compact',
              onclick: openSetBudgets,
            },
            Icon('pencil', { size: 14, sw: 2.4 }),
            anySet ? 'Edit' : 'Set up'
          )
        )
      ),
      h(
        'div',
        { class: 'gb-money-intro' },
        "Gentle limits, not hard rules. I'll nudge you near 80% — never to make you feel bad."
      ),
    ];
    const reminders = st
      .filter((s) => s.base > 0 && s.pct >= 80)
      .map((s) =>
        coachCard(
          'lightbulb',
          s.pct > 100 ? `${s.cat.label} budget is full` : `${s.pct}% of ${s.cat.label} used`,
          h(
            'p',
            { class: 'gb-money-coach-text' },
            s.pct > 100
              ? `You're ${fmt(s.spent - s.budget)} over. The rest of the month, lean on free tags.`
              : `Only ${fmt(s.remaining)} remains in ${s.cat.label}. Easy does it.`
          ),
          'warn'
        )
      );
    const bars = anySet
      ? st
          .filter((s) => s.base > 0)
          .map((s) => {
            const over = s.pct > 100;
            return h(
              'div',
              { class: 'gb-money-bcard' },
              h(
                'div',
                { class: 'gb-money-bcard-head' },
                h(
                  'span',
                  { class: 'gb-money-cat-ic', style: { background: s.cat.soft, color: s.cat.fg } },
                  Icon(s.cat.icon, { size: 15, sw: 2.2 })
                ),
                h('span', { class: 'gb-money-bcard-name' }, s.cat.label),
                h(
                  'span',
                  {
                    class:
                      'gb-money-bcard-pct' + (over ? ' is-over' : s.pct >= 80 ? ' is-near' : ''),
                  },
                  s.pct + '%'
                )
              ),
              h(
                'div',
                { class: 'gb-money-bcard-track' },
                h('div', {
                  class:
                    'gb-money-bcard-fill' + (over ? ' is-over' : s.pct >= 80 ? ' is-near' : ''),
                  style: { width: Math.min(100, Math.max(2, s.pct)) + '%' },
                })
              ),
              h(
                'div',
                { class: 'gb-money-bcard-meta' },
                h('span', null, fmt(s.spent) + ' of ' + fmt(s.budget)),
                h(
                  'span',
                  null,
                  over ? fmt(s.spent - s.budget) + ' over' : fmt(s.remaining) + ' left'
                )
              ),
              s.carried
                ? h(
                    'div',
                    { class: 'gb-money-bcard-carry' + (s.carried < 0 ? ' is-less' : '') },
                    (s.carried > 0 ? '+' : '−') +
                      fmt(Math.abs(s.carried)) +
                      ' carried from last month · ' +
                      fmt(s.base) +
                      ' set'
                  )
                : null
            );
          })
      : [
          emptyHint(
            'target',
            'No budgets yet. Set a few to unlock gentle reminders and forecasts.'
          ),
        ];
    const totalBudget = st.reduce((a, s) => a + s.budget, 0);
    const totalSpent = st.reduce((a, s) => a + s.spent, 0);
    const summary = anySet
      ? h(
          'div',
          { class: 'gb-money-bsummary' },
          stat('Total budget', fmt(totalBudget)),
          stat('Spent', fmt(totalSpent)),
          stat('Remaining', fmt(Math.max(0, totalBudget - totalSpent)))
        )
      : null;
    return [
      Card({
        className: 'gb-money-card',
        children: [...headKids, summary, h('div', { class: 'gb-money-bcards' }, bars)],
      }),
      ...reminders,
      recoveryCard(),
    ];
  }

  function goalsSection() {
    // Same as budgets: the health card's "Create a goal" is the way in.
    if (!money.goals.length) return [];
    const headKids = [
      h(
        'div',
        { class: 'gb-sectiontitle' },
        h('h3', null, 'Savings goals'),
        h(
          'div',
          { class: 'gb-money-head-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--ghost gb-btn--compact',
              onclick: openSimulator,
            },
            Icon('trending-up', { size: 14, sw: 2.2 }),
            'Plan savings'
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft gb-btn--compact',
              onclick: () => openAddGoal(false),
            },
            Icon('plus', { size: 14, sw: 2.6 }),
            'New goal'
          )
        )
      ),
      h(
        'div',
        { class: 'gb-money-intro' },
        "Set money aside on purpose. I'll suggest a pace and estimate when you'll get there."
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--secondary gb-btn--compact',
          style: { width: 'auto' },
          onclick: () => openAddGoal(true),
        },
        Icon('calendar', { size: 14, sw: 2.2 }),
        'Plan a purchase'
      ),
    ];
    const goalCards = money.goals.length
      ? money.goals.map((g) => {
          const p = goalPlan(g);
          const planLine = p.done
            ? 'Goal reached — beautifully done!'
            : p.dueDate
              ? `Save ${fmt(p.requiredWeekly)}/week (${fmt(p.requiredDaily)}/day) to make it by ${fmtDateShort(p.dueDate)}.`
              : p.weeklyRate > 0
                ? `At ${fmt(p.weeklyRate)}/week you'll arrive${p.etaKey ? ' around ' + fmtDateShort(p.etaKey) : ''}.`
                : `Try ${fmt(p.suggestedWeekly)}/week${p.etaKey ? ' to reach it by ' + fmtDateShort(p.etaKey) : ''}.`;
          return h(
            'div',
            { class: 'gb-money-goal' + (p.done ? ' is-done' : '') },
            h(
              'div',
              { class: 'gb-money-goal-top' },
              ProgressRing({
                value: p.pct,
                size: 64,
                stroke: 8,
                color: p.done ? 'var(--success)' : 'var(--leaf-600)',
                children: [h('div', { class: 'gb-money-goal-ring-pct' }, p.pct + '%')],
              }),
              h(
                'div',
                { class: 'gb-money-goal-info' },
                h(
                  'div',
                  { class: 'gb-money-goal-name' },
                  Icon(p.dueDate ? 'calendar' : 'sprout', {
                    size: 15,
                    sw: 2.2,
                    color: 'var(--leaf-600)',
                  }),
                  g.name
                ),
                h('div', { class: 'gb-money-goal-nums' }, fmt(p.saved) + ' of ' + fmt(p.target)),
                h('div', { class: 'gb-money-goal-plan' }, planLine)
              )
            ),
            h(
              'div',
              { class: 'gb-money-goal-actions' },
              !p.done
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'gb-btn gb-btn--soft gb-btn--compact',
                      onclick: () => openContribute(g),
                    },
                    Icon('piggy-bank', { size: 14, sw: 2.2 }),
                    'Add money'
                  )
                : null,
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-icon-btn',
                  'aria-label': 'Delete goal',
                  onclick: () =>
                    confirmDelete(
                      'Delete goal',
                      'Delete "' + g.name + '"? Set-aside history will be cleared.',
                      async () => {
                        commit((m) => removeDocItem(m, 'goals', g.id));
                        toast.success('Goal deleted.');
                      }
                    ),
                },
                Icon('trash-2', { size: 15, sw: 2.4 })
              )
            )
          );
        })
      : [
          emptyHint(
            'sprout',
            'No goals yet. A phone, a trip, an emergency fund — pick one to grow toward.'
          ),
        ];
    return [
      Card({
        className: 'gb-money-card',
        children: [...headKids, h('div', { class: 'gb-money-goals' }, goalCards)],
      }),
    ];
  }

  function wishlistCard() {
    const items = money.wishlist || [];
    const waiting = items.filter((i) => i.status === 'waiting');
    return Card({
      className: 'gb-money-card',
      children: [
        h(
          'div',
          { class: 'gb-sectiontitle' },
          h('h3', null, 'Smart wishlist'),
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft gb-btn--compact',
              onclick: openAddWishlist,
            },
            Icon('plus', { size: 14, sw: 2.6 }),
            'Add item'
          )
        ),
        waiting.length
          ? h(
              'div',
              { class: 'gb-money-wish-list' },
              waiting.map((it) => {
                const days = Math.max(0, diffDays(todayKey(), it.addedAt));
                const ripe = days >= 3;
                return h(
                  'div',
                  { class: 'gb-money-wish' },
                  h(
                    'span',
                    {
                      class: 'gb-money-cat-ic',
                      style: { background: 'var(--sun-50)', color: 'var(--sun-700)' },
                    },
                    Icon('star', { size: 15, sw: 2.2 })
                  ),
                  h(
                    'div',
                    { class: 'gb-money-wish-main' },
                    h('div', { class: 'gb-money-exp-note' }, it.name + ' · ' + fmt(it.price)),
                    h(
                      'div',
                      { class: 'gb-money-exp-meta' },
                      days === 0
                        ? 'Added today'
                        : days +
                            ' day' +
                            (days === 1 ? '' : 's') +
                            ' on the list' +
                            (ripe ? ' — still want it?' : '')
                    )
                  ),
                  ripe
                    ? h(
                        'button',
                        {
                          type: 'button',
                          class: 'gb-btn gb-btn--soft gb-btn--compact',
                          onclick: () => {
                            commit((m) => {
                              const w = m.wishlist.find((x) => x.id === it.id);
                              if (w) w.status = 'bought';
                            });
                            toast.success('Marked as bought.');
                          },
                        },
                        'Mark as bought'
                      )
                    : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'gb-icon-btn',
                      'aria-label': 'Remove',
                      onclick: () =>
                        confirmDelete('Remove item', 'Remove "' + it.name + '" from your wishlist?', () => {
                          commit((m) => removeDocItem(m, 'wishlist', it.id));
                          toast.success('Removed from wishlist.');
                        }),
                    },
                    Icon('trash-2', { size: 15, sw: 2.4 })
                  )
                );
              })
            )
          : emptyHint('gift', 'Nothing waiting. Park tempting buys here and let the urge pass.'),
      ],
    });
  }

  /* =================================================================
     TAB: INCOME (salary + other inflow, loans given/received)
     ================================================================= */
  function openAddIncome() {
    const amt = h('input', { type: 'number', class: 'gb-input', inputmode: 'decimal', min: '1', placeholder: 'e.g. 45000' });
    const label = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '60',
      placeholder: 'e.g. June salary',
    });
    const date = h('input', { type: 'date', class: 'gb-input', value: todayKey() });
    const src = segmented(
      [
        { value: 'salary', label: 'Salary' },
        { value: 'other', label: 'Other' },
      ],
      'salary'
    );
    const amtLabel = h('div', { class: 'gb-field-label' }, 'Amount (' + cur + ')');
    const into = accountPicker(money, firstOfKind(money, ['bank', 'wallet']), (id) => {
      amtLabel.textContent = 'Amount (' + (accCurrency(money, id) || cur) + ')';
    });
    amtLabel.textContent = 'Amount (' + (accCurrency(money, into.get()) || cur) + ')';
    openMoneyModal({
      title: 'Add income',
      sub: 'Salary, freelance, a gift — anything that came in.',
      body: h(
        'div',
        { class: 'gb-form' },
        amtLabel,
        amt,
        h('div', { class: 'gb-field-label' }, 'Type'),
        src.node,
        into.node ? h('div', { class: 'gb-field-label' }, 'Received in') : null,
        into.node,
        h('div', { class: 'gb-field-label' }, 'Note (optional)'),
        label,
        h('div', { class: 'gb-field-label' }, 'Date'),
        date
      ),
      primary: 'Add income',
      onPrimary: async () => {
        const v = readAmount(amt);
        if (!Number.isFinite(v) || v <= 0) {
          amt.focus();
          throw new Error('Enter an amount greater than zero.');
        }
        const source = src.get();
        const home = toHomeAmount(money, into.get(), v);
        commit((m) =>
          (m.income = m.income || []).unshift({
            id: uid(),
            amount: home.amount,
            ...(home.orig ? { orig: home.orig } : {}),
            source,
            label: label.value.trim() || (source === 'salary' ? 'Salary' : 'Income'),
            date: date.value || todayKey(),
            ...(into.get() ? { accountId: into.get() } : {}),
          })
        );
        toast.success('Income added.');
      },
    });
    setTimeout(() => amt.focus(), 60);
  }

  function openAddLoan(direction) {
    const lent = direction === 'given';
    const amt = h('input', { type: 'number', class: 'gb-input', inputmode: 'decimal', min: '1', placeholder: 'e.g. 2000' });
    const party = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '60',
      placeholder: lent ? 'Who did you lend to?' : 'Who did you borrow from?',
    });
    const date = h('input', { type: 'date', class: 'gb-input', value: todayKey() });
    const note = h('input', { type: 'text', class: 'gb-input', maxlength: '80', placeholder: 'Optional note' });
    // Optional "Given from" / "Received into": '' = not said. Picked, the loan moves
    // that balance (loanMove): lent comes out of it, borrowed goes into it.
    const accts = activeAccounts(money);
    const from = accts.length
      ? segmented([{ value: '', label: 'Skip' }, ...accts.map((a) => ({ value: a.id, label: a.name }))], '')
      : null;
    openMoneyModal({
      title: lent ? 'Money I lent' : 'Money I borrowed',
      sub: lent
        ? "I'll track it as outstanding until you mark it repaid."
        : "I'll track it as owed until you mark it settled.",
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Amount (' + cur + ')'),
        amt,
        h('div', { class: 'gb-field-label' }, lent ? 'Lent to' : 'Borrowed from'),
        party,
        from ? h('div', { class: 'gb-field-label' }, lent ? 'Given from (optional)' : 'Received into (optional)') : null,
        from ? from.node : null,
        h('div', { class: 'gb-field-label' }, 'Date'),
        date,
        h('div', { class: 'gb-field-label' }, 'Note (optional)'),
        note
      ),
      primary: 'Save',
      onPrimary: async () => {
        const v = readAmount(amt);
        if (!Number.isFinite(v) || v <= 0) {
          amt.focus();
          throw new Error('Enter an amount greater than zero.');
        }
        if (!party.value.trim()) {
          party.focus();
          throw new Error(lent ? 'Who did you lend to?' : 'Who did you borrow from?');
        }
        commit((m) => {
          (m.loans = m.loans || []).unshift({
            id: uid(),
            direction,
            party: party.value.trim(),
            amount: v,
            date: date.value || todayKey(),
            note: note.value.trim(),
            settled: false,
            ...(from && from.get() ? { accountId: from.get() } : {}),
          });
          loanMove(m, m.loans[0]);
        });
        toast.success('Saved.');
      },
    });
    setTimeout(() => amt.focus(), 60);
  }

  /* Settle all of it, or record the part that came back. Nothing left = settled. */
  function openRepay(l) {
    const lent = l.direction === 'given';
    const left = loanLeft(l);
    const amt = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'decimal',
      min: '0.01',
      step: '0.01',
      value: String(left),
    });
    const date = h('input', { type: 'date', class: 'gb-input', value: todayKey() });
    // "Repaid into" / "Paid from": defaults to the loan's own account; Skip moves no balance.
    const accts = activeAccounts(money);
    const via = accts.length
      ? segmented(
          [{ value: '', label: 'Skip' }, ...accts.map((a) => ({ value: a.id, label: a.name }))],
          accts.some((a) => a.id === l.accountId) ? l.accountId : ''
        )
      : null;
    openMoneyModal({
      title: lent ? 'Money back from ' + l.party : 'Paid back to ' + l.party,
      sub: fmt(left) + ' left of ' + fmt(l.amount) + '. Part of it is fine: the rest stays outstanding.',
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Amount (' + cur + ')'),
        amt,
        via ? h('div', { class: 'gb-field-label' }, lent ? 'Repaid into' : 'Paid from') : null,
        via ? via.node : null,
        h('div', { class: 'gb-field-label' }, 'Date'),
        date
      ),
      primary: 'Save',
      onPrimary: async () => {
        const v = readAmount(amt);
        if (!Number.isFinite(v) || v <= 0) {
          amt.focus();
          throw new Error('Enter an amount greater than zero.');
        }
        if (v > left) {
          amt.focus();
          throw new Error('That is more than the ' + fmt(left) + ' left.');
        }
        const after = loanLeft(Object.assign({}, l, { repaid: (l.repaid || []).concat({ amount: v }) }));
        const accountId = via ? via.get() : '';
        commit((m) => {
          const x = m.loans.find((y) => y.id === l.id);
          if (!x) return;
          // The last part is recorded too (`final`), so its day and account are
          // known; Undo takes it off again.
          x.repaid = (Array.isArray(x.repaid) ? x.repaid : []).concat({
            amount: v,
            date: date.value || todayKey(),
            ...(accountId ? { accountId } : {}),
            ...(after <= 0 ? { final: true } : {}),
          });
          if (after <= 0) x.settled = true;
          loanMove(m, x);
        });
        toast.success(after <= 0 ? 'Marked settled.' : fmt(after) + ' still outstanding.');
      },
    });
    setTimeout(() => amt.select(), 60);
  }

  function openSplitBill() {
    const total = h('input', { type: 'number', class: 'gb-input', inputmode: 'decimal', min: '1', placeholder: 'e.g. 2400' });
    const people = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '200',
      placeholder: 'Names, separated by commas',
    });
    const me = h('input', { type: 'checkbox', checked: true });
    const note = h('input', { type: 'text', class: 'gb-input', maxlength: '80', placeholder: 'e.g. Dinner' });
    const preview = h('div', { class: 'gb-note-hint' });
    const names = () =>
      people.value
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 20);
    const shares = () =>
      splitShares(Math.round(Number(total.value) * 100) / 100, names(), me.checked);
    // Shares can carry paise; fmt() rounds to whole units, so the preview shows them exactly.
    const exact = (v) => cur + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const paint = () => {
      const sh = shares();
      preview.textContent = sh.length
        ? sh.map((x) => x.party + ' owes you ' + exact(x.amount)).join(' · ')
        : 'Each person gets an IOU you can settle later.';
    };
    [total, people].forEach((el) => el.addEventListener('input', paint));
    me.addEventListener('change', paint);
    paint();
    openMoneyModal({
      title: 'Split a bill',
      sub: 'You paid; everyone else owes you their share.',
      body: h(
        'div',
        { class: 'gb-form' },
        h('div', { class: 'gb-field-label' }, 'Total (' + cur + ')'),
        total,
        h('div', { class: 'gb-field-label' }, 'Split with'),
        people,
        h('label', { class: 'gb-money-split-me' }, me, 'Include my share'),
        h('div', { class: 'gb-field-label' }, 'Note (optional)'),
        note,
        preview
      ),
      primary: 'Save IOUs',
      onPrimary: async () => {
        if (!(readAmount(total) > 0)) {
          total.focus();
          throw new Error('Enter the bill total.');
        }
        const sh = shares();
        if (!sh.length) {
          people.focus();
          throw new Error('Who did you split it with?');
        }
        const label = note.value.trim();
        commit((m) => {
          m.loans = m.loans || [];
          sh.forEach((x) =>
            m.loans.unshift({
              id: uid(),
              direction: 'given',
              party: x.party,
              amount: x.amount,
              date: todayKey(),
              note: label ? 'Split: ' + label : 'Split bill',
              settled: false,
            })
          );
        });
        toast.success(sh.length === 1 ? 'IOU saved.' : sh.length + ' IOUs saved.');
      },
    });
    setTimeout(() => total.focus(), 60);
  }

  function tabIncome() {
    const mStart = thisMonthPrefix() + '-01';
    const today = todayKey();
    const incomeMonth = sumIncome(incomeInRange(money, mStart, today));
    const spentMonth = sumAmt(inRange(money.expenses, mStart, today));
    const net = incomeMonth - spentMonth;
    const lentOut = loanOutstanding(money, 'given');
    const borrowed = loanOutstanding(money, 'received');

    // One bar reads faster than four equal tiles: of what came in, how much was
    // spent and how much stayed. "Lent out" lives in the Loans card below.
    const spentPct = incomeMonth > 0 ? Math.min(100, Math.round((spentMonth / incomeMonth) * 100)) : 0;
    const summary = Card({
      className: 'gb-money-card',
      children: [
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'This month')),
        incomeMonth > 0
          ? h(
              'div',
              { class: 'gb-money-kept' },
              h(
                'div',
                { class: 'gb-money-kept-fig' },
                h('span', { class: 'gb-money-kept-num' + (net < 0 ? ' is-over' : '') }, fmt(Math.abs(net))),
                h('span', { class: 'gb-money-kept-label' }, net >= 0 ? 'kept' : 'more spent than came in')
              ),
              h(
                'div',
                {
                  class: 'gb-money-kept-bar',
                  role: 'img',
                  'aria-label': fmt(spentMonth) + ' spent of ' + fmt(incomeMonth) + ' that came in',
                },
                h('span', { class: 'gb-money-kept-spent', style: { width: spentPct + '%' } })
              ),
              h(
                'div',
                { class: 'gb-money-kept-key' },
                h('span', null, fmt(spentMonth) + ' spent'),
                h('span', null, fmt(incomeMonth) + ' came in')
              )
            )
          : h(
              'div',
              { class: 'gb-money-review-stats' },
              stat('Income', fmt(incomeMonth)),
              stat('Spent', fmt(spentMonth))
            ),
        // The bar already says kept vs spent; the sentence is for the no-income case.
        incomeMonth > 0
          ? null
          : h(
              'div',
              { class: 'gb-money-intro' },
              spentMonth > 0
                ? `No income logged this month yet. Add it to see what you're keeping.`
                : 'Nothing in or out yet this month.'
            ),
      ],
    });

    const incomeAll = (money.income || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    // Fourteen salary rows buried Loans; the latest six answer "did it come in?".
    const incomeList = showAllIncome ? incomeAll : incomeAll.slice(0, 6);
    const incomeCard = Card({
      className: 'gb-money-card',
      children: [
        h(
          'div',
          { class: 'gb-sectiontitle' },
          h('h3', null, 'Income'),
          h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: openAddIncome },
            Icon('plus', { size: 14, sw: 2.6 }),
            'Add income'
          )
        ),
        incomeList.length
          ? h(
              'div',
              { class: 'gb-money-exp-list' },
              incomeList.map((e) =>
                h(
                  'div',
                  { class: 'gb-money-exp-row' },
                  h(
                    'span',
                    {
                      class: 'gb-money-cat-ic',
                      style: { background: 'var(--leaf-50)', color: 'var(--leaf-700)' },
                    },
                    Icon(e.source === 'salary' ? 'briefcase' : 'coins', { size: 15, sw: 2.2 })
                  ),
                  h(
                    'div',
                    { class: 'gb-money-exp-main' },
                    h('div', { class: 'gb-money-exp-note' }, e.label),
                    h(
                      'div',
                      { class: 'gb-money-exp-meta' },
                      [fmtDateShort(e.date), (accountOf(money, e.accountId) || {}).name]
                        .filter(Boolean)
                        .join(' · ')
                    )
                  ),
                  h(
                    'div',
                    { class: 'gb-money-exp-amt', style: { color: 'var(--leaf-700)' } },
                    '+' + fmt(e.amount)
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'gb-icon-btn',
                      'aria-label': 'Delete income',
                      onclick: () =>
                        confirmDelete('Delete income', 'Delete "' + e.label + '"?', async () => {
                          commit((m) => (m.income = m.income.filter((x) => x.id !== e.id)));
                          toast.success('Income deleted.');
                        }),
                    },
                    Icon('trash-2', { size: 15, sw: 2.4 })
                  )
                )
              )
            )
          : emptyHint('coins', 'No income logged yet. Add your salary or other inflow to see your net.'),
        incomeAll.length > 6
          ? h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--ghost gb-btn--compact gb-money-showall',
                onclick: () => {
                  showAllIncome = !showAllIncome;
                  paint();
                },
              },
              showAllIncome ? 'Show latest 6' : 'Show all ' + incomeAll.length
            )
          : null,
      ],
    });

    const loanRow = (l) => {
      const lent = l.direction === 'given';
      // Signed from your side of the IOU: lent = owed to you (+), borrowed = you owe (−).
      // It was the cash-flow sign, so a split read "Asha owes you" in the dialog and −₹334 here.
      const accent = lent ? 'var(--leaf-700)' : 'var(--coral-700)';
      const soft = lent ? 'var(--leaf-50)' : 'var(--coral-50)';
      return h(
        'div',
        { class: 'gb-money-exp-row gb-money-loan-row' + (l.settled ? ' is-settled' : '') },
        h(
          'span',
          { class: 'gb-money-cat-ic', style: { background: soft, color: accent } },
          Icon(lent ? 'hand-helping' : 'piggy-bank', { size: 15, sw: 2.2 })
        ),
        h(
          'div',
          { class: 'gb-money-exp-main' },
          h(
            'div',
            { class: 'gb-money-exp-note' },
            (lent ? 'Lent to ' : 'Borrowed from ') + l.party + (l.settled ? ' · settled' : '')
          ),
          h(
            'div',
            { class: 'gb-money-exp-meta' },
            fmtDateShort(l.date) +
              (accountOf(money, l.accountId)
                ? (lent ? ' · from ' : ' · into ') + accountOf(money, l.accountId).name
                : '') +
              (l.note ? ' · ' + l.note : '')
          )
        ),
        h(
          'div',
          { class: 'gb-money-exp-amt', style: { color: l.settled ? 'var(--fg3)' : accent } },
          (lent ? '+' : '\u2212') + fmt(l.settled ? l.amount : loanLeft(l)),
          !l.settled && loanLeft(l) < Number(l.amount)
            ? h('div', { class: 'gb-money-exp-meta' }, 'of ' + fmt(l.amount))
            : null
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--ghost gb-btn--compact',
            style: { width: 'auto' },
            onclick: () => {
              if (!l.settled) return openRepay(l);
              commit((m) => {
                const x = m.loans.find((y) => y.id === l.id);
                if (!x) return;
                x.settled = false;
                x.repaid = (Array.isArray(x.repaid) ? x.repaid : []).filter((r) => !r.final);
                loanMove(m, x);
              });
              toast.success('Marked outstanding.');
            },
          },
          l.settled ? 'Undo' : 'Settle'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-icon-btn',
            'aria-label': 'Delete loan',
            onclick: () =>
              confirmDelete('Delete record', 'Remove this loan record?', async () => {
                commit((m) => {
                  removeDocItem(m, 'loans', l.id);
                  loanMove(m, l, true);
                });
                toast.success('Removed.');
              }),
          },
          Icon('trash-2', { size: 15, sw: 2.4 })
        )
      );
    };
    const natural = (money.loans || []).slice().sort((a, b) => {
      if (!!a.settled !== !!b.settled) return a.settled ? 1 : -1;
      return a.date < b.date ? 1 : -1;
    });
    // Settled rows sink to the bottom, but not while the user is tapping: Settle /
    // Undo moved the row out from under the finger. Keep the last order shown
    // (new loans first, in natural order; sort is stable) until the list re-enters.
    const pos = new Map((loanOrder || []).map((id, i) => [id, i]));
    const at = (l) => (pos.has(l.id) ? pos.get(l.id) : -1);
    const loans = loanOrder ? natural.sort((a, b) => at(a) - at(b)) : natural;
    loanOrder = loans.map((l) => l.id);
    const loansCard = Card({
      className: 'gb-money-card',
      children: [
        h(
          'div',
          { class: 'gb-sectiontitle' },
          h('h3', null, 'Loans'),
          h(
            'div',
            { class: 'gb-money-head-actions' },
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--soft gb-btn--compact',
                onclick: () => openAddLoan('given'),
              },
              Icon('hand-helping', { size: 14, sw: 2.2 }),
              'I lent'
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--soft gb-btn--compact',
                onclick: () => openAddLoan('received'),
              },
              Icon('piggy-bank', { size: 14, sw: 2.2 }),
              'I borrowed'
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--soft gb-btn--compact',
                onclick: openSplitBill,
              },
              Icon('users', { size: 14, sw: 2.2 }),
              'Split a bill'
            )
          )
        ),
        loans.length
          ? h(
              'div',
              { class: 'gb-money-bsummary' },
              stat('Lent out', fmt(lentOut)),
              stat('Borrowed', fmt(borrowed)),
              lentOut >= borrowed
                ? stat('Owed to you', fmt(lentOut - borrowed))
                : stat('You owe', fmt(borrowed - lentOut))
            )
          : null,
        loans.length
          ? h('div', { class: 'gb-money-exp-list' }, loans.map(loanRow))
          : h(
              'p',
              { class: 'gb-money-intro' },
              'Lend a friend money or borrow some? Log it here so nobody has to remember.'
            ),
      ],
    });

    return [summary, incomeCard, recurringCard(), loansCard];
  }

  /* ---- Repeats: salary, rent, SIPs — posted on their day each month ---- */
  function recurDayLabel(day) {
    if (day === 'last') return 'the last day';
    const n = Number(day) || 1;
    const sfx = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
    return 'the ' + n + sfx;
  }
  function recurringCard() {
    const rules = money.recurring || [];
    const row = (r) => {
      const isIn = r.kind === 'income';
      const c = catOf(r.category, money);
      const label = r.note || (isIn ? (r.category === 'other' ? 'Income' : 'Salary') : c.label);
      const acc = accountOf(money, r.accountId);
      return h(
        'div',
        { class: 'gb-money-exp-row gb-money-rec-row' + (r.active ? '' : ' is-paused') },
        h(
          'span',
          {
            class: 'gb-money-cat-ic',
            style: isIn
              ? { background: 'var(--leaf-50)', color: 'var(--leaf-700)' }
              : { background: c.soft, color: c.fg },
          },
          Icon('repeat', { size: 15, sw: 2.2 })
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-money-exp-main gb-money-exp-edit',
            'aria-label': 'Edit ' + label,
            onclick: () => openRecurring(r),
          },
          h('div', { class: 'gb-money-exp-note' }, label + (r.active ? '' : ' · paused')),
          h(
            'div',
            { class: 'gb-money-exp-meta' },
            ['Every month on ' + recurDayLabel(r.day), acc ? (isIn ? 'into ' : 'from ') + acc.name : null]
              .filter(Boolean)
              .join(' · ')
          )
        ),
        h(
          'div',
          { class: 'gb-money-exp-amt' + (isIn ? ' is-in' : '') },
          (isIn ? '+' : '\u2212') + fmt(r.amount)
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--ghost gb-btn--compact',
            style: { width: 'auto' },
            'aria-label': (r.active ? 'Pause ' : 'Resume ') + label,
            onclick: () => {
              commit((m) => {
                const x = (m.recurring || []).find((y) => y.id === r.id);
                if (!x) return;
                x.active = !x.active;
                // Resumed: from today on, so a day that passed while paused isn't posted late.
                if (x.active) x.start = todayKey();
              });
              toast.success(r.active ? 'Paused.' : 'Resumed.');
            },
          },
          r.active ? 'Pause' : 'Resume'
        )
      );
    };
    return Card({
      className: 'gb-money-card',
      children: [
        h(
          'div',
          { class: 'gb-sectiontitle' },
          h('h3', null, 'Every month'),
          h(
            'div',
            { class: 'gb-money-head-actions' },
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--soft gb-btn--compact',
                onclick: () => openRecurring(null),
              },
              Icon('plus', { size: 14, sw: 2.6 }),
              'Add repeat'
            )
          )
        ),
        rules.length
          ? h('div', { class: 'gb-money-exp-list' }, rules.map(row))
          : h(
              'p',
              { class: 'gb-money-intro' },
              'Salary, rent, a SIP: add it once and it is logged on its day every month, and counted in the forecast before it lands.'
            ),
      ],
    });
  }
  function openRecurring(rule) {
    const r = rule || null;
    const accLabel = h('div', { class: 'gb-field-label' }, '');
    let tagWrap = null;
    let srcWrap = null;
    function paintKind(v) {
      if (!tagWrap) return;
      tagWrap.style.display = v === 'income' ? 'none' : '';
      srcWrap.style.display = v === 'income' ? '' : 'none';
      accLabel.textContent = v === 'income' ? 'Received in' : 'Paid from';
    }
    const kind = segmented(
      [
        { value: 'expense', label: 'Money out' },
        { value: 'income', label: 'Money in' },
      ],
      r ? r.kind : 'expense',
      (v) => paintKind(v)
    );
    const amt = h('input', {
      type: 'number',
      class: 'gb-input',
      inputmode: 'decimal',
      min: '1',
      placeholder: 'e.g. 9000',
      value: r ? String(r.amount) : '',
    });
    const tag = tagPicker(money, save, {
      initial: r && r.kind !== 'income' ? r.category : money.settings.defaultTag || 'others',
    });
    const src = segmented(
      [
        { value: 'salary', label: 'Salary' },
        { value: 'other', label: 'Other' },
      ],
      r && r.kind === 'income' && r.category === 'other' ? 'other' : 'salary'
    );
    tagWrap = h('div', null, h('div', { class: 'gb-field-label' }, 'Tag'), tag.node);
    srcWrap = h('div', null, h('div', { class: 'gb-field-label' }, 'Type'), src.node);
    const acc = accountPicker(money, r ? r.accountId : firstOfKind(money, ['bank', 'card']));
    const day = h(
      'select',
      { class: 'gb-input', 'aria-label': 'Day of the month' },
      Array.from({ length: 28 }, (_, i) => String(i + 1))
        .concat('last')
        .map((d) =>
          h('option', { value: d, selected: String(r ? r.day : 1) === d }, d === 'last' ? 'Last day of the month' : d)
        )
    );
    const note = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '80',
      placeholder: 'e.g. Rent, Salary, SIP',
      value: r ? r.note || '' : '',
    });
    paintKind(kind.get());
    openMoneyModal({
      title: r ? 'Edit repeat' : 'Every month',
      sub: 'Logged for you on its day each month. Days 29 to 31 are "last day", so every month has one.',
      body: h(
        'div',
        { class: 'gb-form' },
        kind.node,
        h('div', { class: 'gb-field-label' }, 'Amount (' + cur + ')'),
        amt,
        tagWrap,
        srcWrap,
        acc.node ? accLabel : null,
        acc.node,
        h('div', { class: 'gb-field-label' }, 'On day'),
        day,
        h('div', { class: 'gb-field-label' }, 'Note (optional)'),
        note
      ),
      primary: r ? 'Save' : 'Add repeat',
      danger: r
        ? {
            label: 'Delete repeat',
            onClick: () => {
              commit((m) => removeDocItem(m, 'recurring', r.id));
              toast.success('Repeat deleted. What it already logged stays.');
            },
          }
        : null,
      onPrimary: async () => {
        const v = readAmount(amt);
        if (!Number.isFinite(v) || v <= 0) {
          amt.focus();
          throw new Error('Enter an amount greater than zero.');
        }
        const k = kind.get();
        const fields = {
          kind: k,
          amount: v,
          category: k === 'income' ? src.get() : tag.get(),
          day: day.value === 'last' ? 'last' : Number(day.value),
          note: note.value.trim(),
          ...(acc.get() ? { accountId: acc.get() } : {}),
        };
        commit((m) => {
          m.recurring = m.recurring || [];
          if (r) {
            const x = m.recurring.find((y) => y.id === r.id);
            if (x) {
              delete x.accountId;
              Object.assign(x, fields);
            }
          } else {
            m.recurring.push({ id: uid(), ...fields, active: true, start: todayKey() });
          }
        });
        toast.success(r ? 'Saved.' : 'Added. It logs itself on ' + recurDayLabel(fields.day) + '.');
      },
    });
    setTimeout(() => amt.focus(), 60);
  }

  /* =================================================================
     TAB: COACH (challenges, timeline, reflections, share)
     ================================================================= */
  function tabCoach() {
    const challenges = money.challenges || [];
    const challengeCard = Card({
      className: 'gb-money-card',
      children: [
        h(
          'div',
          { class: 'gb-sectiontitle' },
          h('h3', null, 'Challenges'),
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft gb-btn--compact',
              onclick: openChallenge,
            },
            Icon('plus', { size: 14, sw: 2.6 }),
            'New challenge'
          )
        ),
        challenges.length
          ? h(
              'div',
              { class: 'gb-money-chal-list' },
              challenges.map((ch) => {
                const pr = challengeProgress(money, ch);
                const color =
                  pr.state === 'won'
                    ? 'var(--success)'
                    : pr.state === 'broken'
                      ? 'var(--brand)'
                      : 'var(--iris-500)';
                return h(
                  'div',
                  { class: 'gb-money-chal is-' + pr.state },
                  h(
                    'div',
                    { class: 'gb-money-chal-top' },
                    h(
                      'span',
                      { class: 'gb-money-chal-ic', style: { color } },
                      Icon(
                        pr.state === 'won'
                          ? 'trophy'
                          : pr.state === 'broken'
                            ? 'rotate-ccw'
                            : 'shield-check',
                        { size: 16, sw: 2.2 }
                      )
                    ),
                    h('span', { class: 'gb-money-chal-title' }, ch.title),
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'gb-icon-btn',
                        'aria-label': 'Delete challenge',
                        onclick: () =>
                          confirmDelete('Delete challenge', 'Delete "' + ch.title + '"?', () => {
                            commit((m) => removeDocItem(m, 'challenges', ch.id));
                            toast.success('Challenge deleted.');
                          }),
                      },
                      Icon('trash-2', { size: 14, sw: 2.4 })
                    )
                  ),
                  h(
                    'div',
                    { class: 'gb-money-chal-track' },
                    h('div', {
                      class: 'gb-money-chal-fill',
                      style: { width: Math.max(3, pr.pct) + '%', background: color },
                    })
                  ),
                  h(
                    'div',
                    { class: 'gb-money-chal-detail' },
                    pr.state === 'won' ? 'Completed — reward unlocked!' : pr.detail
                  )
                );
              })
            )
          : emptyHint(
              'shield-check',
              'No challenges yet. A small "no-spend" streak is a great start.'
            ),
      ],
    });

    const tl = achievementTimeline(money);
    const timelineCard = Card({
      className: 'gb-money-card',
      children: [
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'Your journey')),
        tl.length
          ? h(
              'div',
              { class: 'gb-money-timeline' },
              tl.map((ev) =>
                h(
                  'div',
                  { class: 'gb-money-tl-row' },
                  h('span', { class: 'gb-money-tl-ic' }, Icon(ev.icon, { size: 15, sw: 2.2 })),
                  h(
                    'div',
                    { class: 'gb-money-tl-main' },
                    h('div', { class: 'gb-money-tl-title' }, ev.title),
                    h('div', { class: 'gb-money-tl-desc' }, ev.desc + ' · ' + fmtDateShort(ev.date))
                  )
                )
              )
            )
          : emptyHint(
              'history',
              'Milestones will appear here as you go — first expense, first goal, best streak.'
            ),
      ],
    });

    const ri = reflectionInsights(money);
    const reflectCard = Card({
      className: 'gb-money-card',
      children: [
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'Reflection patterns')),
        ri
          ? h(
              'div',
              { class: 'gb-money-insights' },
              ri.map((t) =>
                h(
                  'div',
                  { class: 'gb-money-insight is-info' },
                  h('span', { class: 'gb-money-insight-ic' }, Icon('heart', { size: 16, sw: 2.2 })),
                  h('span', null, t)
                )
              )
            )
          : emptyHint(
              'heart',
              "Reflect on a few larger purchases and I'll surface your spending triggers."
            ),
      ],
    });

    const shareCard = Card({
      className: 'gb-money-card',
      children: [
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'Share your progress')),
        h(
          'div',
          { class: 'gb-money-intro' },
          'Celebrate the streaks and savings — share a friendly summary card.'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--soft',
            style: { width: 'auto' },
            onclick: shareSummary,
          },
          Icon('share-2', { size: 15, sw: 2.2 }),
          'Share summary'
        ),
      ],
    });

    return [
      challengeCard,
      // The wishlist is a buying decision, so it sits with the purchase advisor.
      wishlistCard(),
      gamificationStrip(),
      timelineCard,
      insightCard(),
      personalityCard(),
      dailyTipCard(),
      reflectCard,
      shareCard,
    ];
  }

  /* ---- tab bar + paint ---- */
  const TABS = [
    { key: 'overview', label: 'Overview', icon: 'wallet' },
    { key: 'spending', label: 'Spending', icon: 'receipt' },
    { key: 'income', label: 'Income', icon: 'coins' },
    { key: 'coach', label: 'Coach', icon: 'sparkles' },
  ];
  function tabBar() {
    return h(
      'div',
      { class: 'gb-money-tabs', role: 'tablist' },
      TABS.map((t) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': String(activeTab === t.key),
            // Below 540px the label span is display:none (money.css) and the icon is
            // aria-hidden, which left every tab with no accessible name at all.
            'aria-label': t.label,
            class: 'gb-money-tab' + (activeTab === t.key ? ' is-active' : ''),
            onclick: () => {
              if (activeTab === t.key) return;
              activeTab = t.key;
              loanOrder = null; // the loan list re-enters: settled rows may sink now
              paint();
              // The old tab's scroll position carried over, usually past the bar, so
              // the new tab opened mid-page with its tabs off-screen.
              const bar = root.firstElementChild;
              const sc = root.closest('.gb-scroll');
              const top = sc ? sc.getBoundingClientRect().top : 0;
              if (bar && bar.getBoundingClientRect().top < top) bar.scrollIntoView({ block: 'start' });
            },
          },
          Icon(t.icon, { size: 16, sw: activeTab === t.key ? 2.5 : 2.1 }),
          h('span', null, t.label)
        )
      )
    );
  }
  function renderTab() {
    const nodes =
      activeTab === 'spending'
        ? tabSpending()
        : activeTab === 'income'
          ? tabIncome()
          : activeTab === 'coach'
            ? tabCoach()
            : tabOverview();
    return h('div', { class: 'gb-money-tabpanel', role: 'tabpanel' }, nodes.filter(Boolean));
  }
  function paint() {
    root.replaceChildren(tabBar(), renderTab());
    refreshIcons();
  }
  paint();
  return root;
}

/* =====================================================================
   Dev self-check (Vite dev only).
   ===================================================================== */
function _demo() {
  const a = console.assert;
  {
    const sh = splitShares(1000, ['A', 'B'], true);
    a(sh.length === 2 && Math.round((sh[0].amount + sh[1].amount) * 100) === 66667, 'split: odd paise go to others');
    a(splitShares(900, ['A', 'B'], false).every((x) => x.amount === 450), 'split without me');
    a(splitShares(0, ['A'], true).length === 0 && splitShares(100, [], true).length === 0, 'split: nothing to split');
    a(costPerUse({ amount: 200, usesPerMonth: 4 }) === 50 && costPerUse({ amount: 200 }) === null, 'cost per use');
    const field = (value, badInput) => ({ value, validity: { badInput }, focus() {} });
    a(readAmount(field('249.5')) === 249.5 && readAmount(field('0.1234')) === 0.12, 'amount keeps paise');
    a(readAmount(field('')) === 0 && readAmount(field('-5')) === -5, 'amount: blank/negative left to the caller');
    let refused = false;
    try {
      readAmount(field('', true));
    } catch (_) {
      refused = true;
    }
    a(refused, 'amount: an unparseable value ("1,250") is refused, not read as 0');
  }
  a(suggestCategory('Lunch at cafe') === 'food', 'suggest food');
  a(suggestCategory('Uber to office') === 'transport', 'suggest transport');
  a(suggestCategory('random xyz') === 'others', 'suggest others');
  a(suggestCategory('') === null, 'empty → null');
  a(fmt(-240) === '\u2212' + cur + '240', 'fmt: minus before the symbol');
  a(fmt(1200) === cur + '1,200', 'fmt: positives unchanged');
  const m = normalizeMoney({
    expenses: [
      { id: '1', amount: 100, category: 'food', date: todayKey() },
      { id: '2', amount: 50, category: 'shopping', date: todayKey() },
    ],
    budgets: { food: 80 },
    goals: [
      { id: 'g', name: 'Phone', target: 1000, contribs: [{ date: todayKey(), amount: 500 }] },
    ],
    customCategories: [{ key: 'c_pets', label: 'Pets', color: 'x', soft: 'y', fg: 'z' }],
  });
  a(byCategory(m.expenses, m).food === 100, 'byCategory sums');
  a(catOf('c_pets', m).label === 'Pets', 'custom tag resolves');
  a(budgetStatus(m).find((s) => s.cat.key === 'food').pct === 125, 'over-budget pct');
  a(goalPlan(m.goals[0]).pct === 50, 'goal 50%');
  a(
    advise(m, 'Headphones', 125, 'want').reasons.some((r) => r.includes('further away')),
    'advice names the goal delay at the saving pace'
  );
  a(financialHealth(m).score >= 0 && financialHealth(m).score <= 100, 'health 0..100');
  a(typeof searchExpenses(m, 'how much on food this month').answer === 'string', 'search answers');
  a(
    challengeProgress(m, {
      kind: 'save',
      amount: 1000,
      start: thisMonthPrefix() + '-01',
      end: thisMonthPrefix() + '-28',
    }).pct === 50,
    'save challenge 50%'
  );
  a(
    challengeProgress(m, { kind: 'nospend', scope: 'food', start: todayKey(), end: todayKey() })
      .state === 'broken',
    'nospend broken today'
  );
  // An empty account must score 0 — no phantom budget-adherence / spending-habit
  // points before the user has logged anything.
  a(financialHealth(emptyMoney()).score === 0, 'empty account scores 0');
  // Budgets set but nothing logged this month: every category sits at 0% spent,
  // which used to score a full 25/25 and read as the user's strongest area.
  const mNoLog = normalizeMoney({ budgets: { food: 1000, transport: 500 }, expenses: [] });
  const adhNoLog = financialHealth(mNoLog).parts.find((p) => p.label === 'Budget adherence');
  a(adhNoLog.score === 0, 'no expenses this month => no adherence points');
  const mLogged = normalizeMoney({
    budgets: { food: 1000, transport: 500 },
    expenses: [{ id: 'e1', amount: 100, category: 'food', date: todayKey() }],
  });
  a(
    financialHealth(mLogged).parts.find((p) => p.label === 'Budget adherence').score === 25,
    'within budget with logged spend => full adherence'
  );
  // Income + loans: outstanding excludes settled rows.
  const m2 = normalizeMoney({
    income: [{ id: 'i1', amount: 1000, source: 'salary', label: 'Pay', date: todayKey() }],
    loans: [
      { id: 'l1', direction: 'given', party: 'A', amount: 200, date: todayKey(), settled: false },
      { id: 'l2', direction: 'given', party: 'B', amount: 50, date: todayKey(), settled: true },
      { id: 'l3', direction: 'received', party: 'C', amount: 300, date: todayKey(), settled: false },
    ],
  });
  a(sumIncome(m2.income) === 1000, 'income sums');
  a(loanOutstanding(m2, 'given') === 200, 'lent excludes settled');
  a(loanOutstanding(m2, 'received') === 300, 'borrowed outstanding');
  {
    // Lent from an account: one move out while outstanding, gone once settled.
    const m = { transfers: [] };
    const l = { id: 'q', direction: 'given', party: 'A', amount: 500, date: todayKey(), accountId: 'b' };
    loanMove(m, l);
    loanMove(m, l);
    a(m.transfers.length === 1 && m.transfers[0].from === 'b' && !m.transfers[0].to, 'lent: one move out');
    loanMove(m, { ...l, settled: true });
    const net = m.transfers.reduce((x, t) => x + (t.to ? t.amount : -t.amount), 0);
    a(m.transfers.length === 2 && net === 0, 'settled: money back');
    loanMove(m, { ...l, accountId: undefined });
    a(m.transfers.length === 0, 'no account: balance untouched');
  }
  // Challenge suggestions: thin data → common only; rich data → personalized.
  const thin = suggestChallenges(emptyMoney());
  a(thin.every((c) => c.personalized === false), 'no data → common challenges');
  const heavyFood = normalizeMoney({
    expenses: Array.from({ length: 8 }, (_, i) => ({
      id: 'f' + i,
      amount: 300,
      category: 'food',
      date: todayKey(),
    })),
  });
  const sugg = suggestChallenges(heavyFood);
  a(
    sugg.some((c) => c.personalized && c.scope === 'food' && c.kind === 'reduce'),
    'food-heavy → personalized food challenge'
  );
  console.log('[money] self-check ran');
}
if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  try {
    _demo();
    // share-card.js has no DEV hook of its own; it rides along with the one
    // screen that uses it.
    _shareCardDemo();
  } catch (_) {
    /* never block the app */
  }
}

export { ScreenMoney, searchExpenses, openExpenseModal };
// Lives in money-home.js now (Home imports it from there); re-exported for older imports.
export { MoneyHomeCard } from './money-home.js';
// The pure engines, for money-calc.test.mjs (node, no DOM). Not for screens.
export const _calc = {
  forecast,
  upcomingSubs,
  budgetStatus,
  logStreak,
  bestStreak,
  loanLeft,
  loanOutstanding,
  loanMove,
  recurringDue,
  recurringToCome,
  materialiseRecurring,
  toHomeAmount,
  editedHomeAmount,
};
