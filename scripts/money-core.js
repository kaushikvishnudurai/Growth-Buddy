/* =====================================================================
   Growth Buddy — Money Buddy core (the light half of money.js)
   ---------------------------------------------------------------------
   What the boot chunk needs without the Money screen: the document model
   (emptyMoney / normalizeMoney / mergeMoney, tombstones), the ledger split
   app.js saves through (ledgerDiff / applyLedgerDiff / docPart), and the
   few engines Home's Money card reads (budgetStatus, buildInsights), with
   the date / currency / category helpers under them. No DOM, no imports.
   money.js imports all of it and re-exports what it used to export, so the
   tests and older import paths keep working; the screen itself is a lazy
   chunk (app.js SCREENS.money → lazyScreen).
   `cur` is a live binding: applyCurrency() here sets it, money.js reads it.
   ===================================================================== */
const CUR = '₹';
// Display currency symbol — customizable via settings.currency; applied from
// the money doc whenever the screen/widget/modals render. ponytail: a single
// module-level display var beats threading currency through every fmt() call.
let cur = CUR;
function applyCurrency(money) {
  cur = (money && money.settings && money.settings.currency) || CUR;
}

/* Built-in categories. Users can add their own (custom tags) — see mergedCats. */
const DEFAULT_CATEGORIES = [
  {
    key: 'food',
    label: 'Food',
    icon: 'utensils',
    color: 'var(--coral-500)',
    soft: 'var(--coral-50)',
    fg: 'var(--coral-700)',
  },
  {
    key: 'shopping',
    label: 'Shopping',
    icon: 'shopping-bag',
    color: 'var(--bloom-500)',
    soft: 'var(--bloom-50)',
    fg: 'var(--bloom-700)',
  },
  {
    key: 'transport',
    label: 'Transport',
    icon: 'bus',
    color: 'var(--sky-500)',
    soft: 'var(--sky-50)',
    fg: 'var(--sky-700)',
  },
  {
    key: 'entertainment',
    label: 'Entertainment',
    icon: 'clapperboard',
    color: 'var(--iris-500)',
    soft: 'var(--iris-50)',
    fg: 'var(--iris-700)',
  },
  {
    key: 'education',
    label: 'Education',
    icon: 'graduation-cap',
    color: 'var(--leaf-600)',
    soft: 'var(--leaf-50)',
    fg: 'var(--leaf-700)',
  },
  {
    key: 'others',
    label: 'Others',
    icon: 'shapes',
    color: 'var(--sun-600)',
    soft: 'var(--sun-50)',
    fg: 'var(--sun-700)',
  },
];

/* Swatches a user picks from when creating a custom tag. */
const PALETTE = [
  { color: 'var(--coral-500)', soft: 'var(--coral-50)', fg: 'var(--coral-700)' },
  { color: 'var(--bloom-500)', soft: 'var(--bloom-50)', fg: 'var(--bloom-700)' },
  { color: 'var(--sky-500)', soft: 'var(--sky-50)', fg: 'var(--sky-700)' },
  { color: 'var(--iris-500)', soft: 'var(--iris-50)', fg: 'var(--iris-700)' },
  { color: 'var(--leaf-600)', soft: 'var(--leaf-50)', fg: 'var(--leaf-700)' },
  { color: 'var(--sun-600)', soft: 'var(--sun-50)', fg: 'var(--sun-700)' },
];

const KEYWORDS = {
  food: [
    'food',
    'lunch',
    'dinner',
    'breakfast',
    'coffee',
    'cafe',
    'restaurant',
    'snack',
    'grocery',
    'groceries',
    'pizza',
    'swiggy',
    'zomato',
    'tea',
    'meal',
    'canteen',
    'dining',
    'milk',
    'bakery',
    'juice',
  ],
  shopping: [
    'shopping',
    'clothes',
    'shoes',
    'amazon',
    'flipkart',
    'myntra',
    'dress',
    'shirt',
    'mall',
    'gift',
    'electronics',
    'gadget',
    'makeup',
    'jeans',
    'bag',
  ],
  transport: [
    'uber',
    'ola',
    'bus',
    'train',
    'metro',
    'fuel',
    'petrol',
    'diesel',
    'cab',
    'auto',
    'rickshaw',
    'flight',
    'parking',
    'toll',
    'transport',
    'commute',
  ],
  entertainment: [
    'movie',
    'netflix',
    'spotify',
    'game',
    'concert',
    'party',
    'subscription',
    'prime',
    'hotstar',
    'bar',
    'club',
    'outing',
    'entertain',
    'cinema',
  ],
  education: [
    'book',
    'course',
    'tuition',
    'class',
    'exam',
    'fee',
    'udemy',
    'coursera',
    'school',
    'college',
    'study',
    'stationery',
    'education',
    'notes',
  ],
};

/* =====================================================================
   Date + money helpers
   ===================================================================== */
function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}
function dkey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function todayKey() {
  return dkey(new Date());
}
function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function diffDays(aKey, bKey) {
  return Math.round((parseKey(aKey) - parseKey(bKey)) / 86400000);
}
function thisMonthPrefix() {
  return todayKey().slice(0, 7);
}
function lastMonthPrefix() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return dkey(d).slice(0, 7);
}
function daysInMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function weekStartKey(date) {
  const d = date ? new Date(date) : new Date();
  const dow = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - dow);
  return dkey(d);
}
function lastNDays(n) {
  const out = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) out.push(dkey(addDays(base, -i)));
  return out;
}
function fmt(n) {
  const v = Math.round(Number(n) || 0);
  // Sign before the symbol, as a true minus: "₹-240" beside an account's "−₹240".
  return (v < 0 ? '\u2212' : '') + cur + Math.abs(v).toLocaleString('en-IN');
}
/* ---- Other currencies (light) ----
   An account can hold another currency: `settings.accountCurrency{accountId: '$'}`,
   with a rate the person types in `settings.fx{'$': 83.2}` (1 unit = that many of
   the home currency; no network FX). An entry booked to such an account is stored
   in the HOME currency, converted at entry with that day's rate, and keeps what was
   actually paid in `orig {amount, currency, rate}` for its row. So every total,
   budget, forecast and the server's balance stay in one currency and none of
   them had to learn about conversion; the account's own-currency balance is that
   home balance shown back at the current rate. ponytail: a rate changed later moves
   the shown foreign balance (the home amounts are fixed at entry); a per-account
   currency column on the server would fix that if anyone keeps real money abroad.
   Transfers and recurring rules stay in the home currency. */
function homeCur(money) {
  return (money && money.settings && money.settings.currency) || CUR;
}
function accCurrency(money, accountId) {
  const c = accountId && ((money.settings || {}).accountCurrency || {})[accountId];
  return c && c !== homeCur(money) ? c : null;
}
function fxRate(money, sym) {
  const r = Number(((money.settings || {}).fx || {})[sym]);
  return Number.isFinite(r) && r > 0 ? r : 0;
}
/* What an amount typed for `accountId` is stored as. Throws when that account's
   currency has no rate: booking it 1:1 would be silently wrong. */
function toHomeAmount(money, accountId, v) {
  const c = accCurrency(money, accountId);
  if (!c) return { amount: v };
  const rate = fxRate(money, c);
  if (!rate) throw new Error('Set a rate for ' + c + ' in Customise → Other currencies first.');
  return { amount: Math.round(v * rate * 100) / 100, orig: { amount: v, currency: c, rate } };
}
/* An edited entry's stored figures. The form shows `orig.amount` for a foreign
   row, so an untouched amount keeps both what was paid and what it cost at the
   time: a note-only edit must not re-convert at today's rate, or read $50 as 50
   in the home currency once the account's currency is cleared. A changed amount
   on the same account keeps the row's own currency and rate; only a move to
   another account books it as that account says. */
function editedHomeAmount(money, ex, accountId, v) {
  if (v === (ex.orig ? ex.orig.amount : ex.amount)) return { amount: ex.amount, orig: ex.orig };
  if (ex.orig && accountId === ex.accountId) {
    const { currency, rate } = ex.orig;
    return { amount: Math.round(v * rate * 100) / 100, orig: { amount: v, currency, rate } };
  }
  return toHomeAmount(money, accountId, v);
}
function fmtIn(n, sym) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const txt =
    Math.round(a * 100) % 100
      ? a.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : Math.round(a).toLocaleString('en-IN');
  return (v < 0 ? '−' : '') + sym + txt;
}
/* An account's balance in its own currency, for display. */
function fmtBalance(money, a) {
  const c = accCurrency(money, a.id);
  const rate = c ? fxRate(money, c) : 0;
  return rate ? fmtIn((Number(a.balance) || 0) / rate, c) : fmt(a.balance);
}

/* An amount field's value, to the paisa. Rounding to whole rupees saved 249.50
   as 250, and the ledger (decimal(14,2)) holds paise. type=number reports what
   it can't parse ("1,250" in most locales) as an empty value, which read as
   "greater than zero" — so say what is actually wrong. */
function readAmount(input) {
  if (input.validity && input.validity.badInput) {
    input.focus();
    throw new Error('Use digits only, like 1250 or 1250.50.');
  }
  return Math.round(Number(input.value) * 100) / 100;
}
/* readAmount's twin for the fields kept in whole rupees on purpose (budgets,
   subscriptions). They carry step=1 and a numeric keyboard; a decimal pasted or
   typed anyway is refused, not rounded behind the user's back. */
function readWhole(input) {
  if (input.validity && (input.validity.badInput || input.validity.stepMismatch)) {
    input.focus();
    throw new Error('Whole amounts only, like 1250.');
  }
  return Number(input.value);
}
/* The year appears only when it isn't this one: "1 Oct" twice in a list (this
   October and last) was two different salaries that read as one. */
function fmtDateShort(k) {
  try {
    const opts = { month: 'short', day: 'numeric' };
    if (String(k).slice(0, 4) !== todayKey().slice(0, 4)) opts.year = 'numeric';
    return parseKey(k).toLocaleDateString(undefined, opts);
  } catch (_) {
    return k;
  }
}

let _seq = 0;
function uid() {
  return 'm' + Date.now().toString(36) + (_seq++).toString(36);
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const slug = (s) =>
  'c_' +
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);

/* =====================================================================
   Data model
   ===================================================================== */
export function emptyMoney() {
  return {
    expenses: [],
    noSpendDays: [],
    income: [],
    loans: [],
    budgets: {},
    goals: [],
    customCategories: [],
    challenges: [],
    wishlist: [],
    subscriptions: [],
    transfers: [],
    accounts: [],
    // Repeating income / expenses, posted into the ledger each month (materialiseRecurring).
    recurring: [],
    // categoryKey -> 'YYYY-MM' rollover was switched on; see budgetStatus.
    rollover: {},
    // "loans:<id>" -> ms deleted. See removeDocItem / mergeMoney.
    tombstones: {},
    settings: { reflectThreshold: 1000, currency: CUR, defaultTag: 'others' },
    currency: CUR,
  };
}
export function normalizeMoney(m) {
  m = m || {};
  const e = emptyMoney();
  return {
    // Copies, not the caller's arrays: quick-add pushed onto a normalised copy,
    // which mutated the live state before saveMoney diffed it, so the diff was
    // empty and the expense never reached the server.
    expenses: Array.isArray(m.expenses) ? m.expenses.slice() : [],
    // A day with a real expense is not a no-spend day, however it got marked; one
    // place fixes it for every path that logs an expense (modal, quick add, import).
    noSpendDays: (Array.isArray(m.noSpendDays) ? m.noSpendDays : []).filter(
      (d) =>
        !(Array.isArray(m.expenses) ? m.expenses : []).some(
          (e) => e && e.date === d && Number(e.amount) > 0
        )
    ),
    income: Array.isArray(m.income) ? m.income.slice() : [],
    loans: Array.isArray(m.loans) ? m.loans : [],
    budgets: m.budgets && typeof m.budgets === 'object' ? m.budgets : {},
    goals: Array.isArray(m.goals)
      ? m.goals.map((g) =>
          Object.assign({}, g, { contribs: Array.isArray(g.contribs) ? g.contribs : [] })
        )
      : [],
    customCategories: Array.isArray(m.customCategories) ? m.customCategories : [],
    challenges: Array.isArray(m.challenges) ? m.challenges : [],
    wishlist: Array.isArray(m.wishlist) ? m.wishlist : [],
    subscriptions: Array.isArray(m.subscriptions) ? m.subscriptions : [],
    transfers: Array.isArray(m.transfers) ? m.transfers.slice() : [],
    recurring: Array.isArray(m.recurring) ? m.recurring : [],
    rollover: m.rollover && typeof m.rollover === 'object' ? m.rollover : {},
    // Live balances from the server; read-only here, never saved back.
    accounts: Array.isArray(m.accounts) ? m.accounts : [],
    tombstones: pruneTombstones(m.tombstones),
    settings: Object.assign({}, e.settings, m.settings || {}),
    currency: CUR,
  };
}
/* ---- Deletes that survive a merge ----
   The document's own lists (loans, goals, subscriptions, challenges, wishlist) are
   unioned by mergeMoney after a 409, so a delete on one device came back from the
   other device's copy. A delete now leaves a tombstone ("loans:<id>" -> when),
   and mergeMoney drops any item either side has a tombstone for. Kept 120 days:
   a device offline longer than that can resurrect an item, which is the old
   behaviour, not lost money. (The ledger lists don't need this: their deletes
   are server rows.) */
export const TOMBSTONED = ['loans', 'goals', 'subscriptions', 'challenges', 'wishlist', 'recurring'];
const TOMBSTONE_TTL = 120 * 86400000;
function pruneTombstones(t, now = Date.now()) {
  const out = {};
  if (!t || typeof t !== 'object') return out;
  for (const [k, at] of Object.entries(t))
    if (Number(at) > now - TOMBSTONE_TTL) out[k] = Number(at);
  return out;
}
export function removeDocItem(m, key, id, now = Date.now()) {
  m[key] = (m[key] || []).filter((x) => x.id !== id);
  m.tombstones = Object.assign({}, m.tombstones, { [key + ':' + id]: now });
}

/* ---- The ledger: expenses, income and transfers are rows on the server ----
   Everything else in the document is saved whole; these three are saved item by
   item, so a save sends what changed instead of years of history. */
export const LEDGER_ARRAYS = { expenses: 'expense', income: 'income', transfers: 'transfer' };

/* Key order must not count as a change: an expense that comes back from the
   server with its fields in another order is the same expense. */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stable(v[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}

/* What a save has to tell the ledger: every added or edited item, every removed id.
   Pure, so the whole save path rests on something testable. */
export function ledgerDiff(before, after) {
  const upserts = [];
  const deletes = [];
  for (const [arr, kind] of Object.entries(LEDGER_ARRAYS)) {
    const was = new Map(
      ((before && before[arr]) || []).filter((x) => x && x.id).map((x) => [x.id, stable(x)])
    );
    const kept = new Set();
    for (const item of (after && after[arr]) || []) {
      if (!item || !item.id) continue;
      kept.add(item.id);
      if (was.get(item.id) !== stable(item)) upserts.push(Object.assign({ kind }, item));
    }
    for (const id of was.keys()) if (!kept.has(id)) deletes.push(id);
  }
  return { upserts, deletes };
}

/* A diff laid onto a document: deletes removed, edits replaced in place, new items
   first. Pure; it is how a save built from an older snapshot lands on the live
   state without dropping what arrived since. */
export function applyLedgerDiff(money, diff) {
  const out = Object.assign({}, money);
  const del = new Set(diff.deletes);
  for (const [arr, kind] of Object.entries(LEDGER_ARRAYS)) {
    const ups = diff.upserts.filter((u) => u.kind === kind).map(({ kind: _k, ...item }) => item);
    const byId = new Map(ups.map((u) => [u.id, u]));
    const was = (money && money[arr]) || [];
    const had = new Set(was.map((x) => x.id));
    out[arr] = ups
      .filter((u) => !had.has(u.id))
      .concat(was.filter((x) => !del.has(x.id)).map((x) => byId.get(x.id) || x));
  }
  return out;
}

/* The part of the document that is still saved as one document. */
export function docPart(m) {
  const out = Object.assign({}, m);
  for (const k of Object.keys(LEDGER_ARRAYS)) delete out[k];
  delete out.accounts;
  return out;
}

/* Union two money documents by item id.

   Reached only after the server refuses a write as stale, and it is the right
   shape for what actually collides: both sides have been ADDING things — an
   expense here, an income row there — to a document they both loaded from the
   same place. Union keeps both.

   Deletes: the document's lists carry tombstones (removeDocItem), unioned here,
   and an item with one on either side is dropped. Without them a loan deleted on
   the laptop came back from the phone. The ledger lists (expenses, income,
   transfers) are server rows whose deletes are rows too, so they need none.
   ponytail: an item with no id can't be tombstoned; only id-less noSpendDays
   strings are like that, and a day un-marked twice is a nuisance, not money. */
export function mergeMoney(mine, theirs) {
  const out = normalizeMoney(theirs);
  const local = normalizeMoney(mine);
  for (const key of Object.keys(out)) {
    if (!Array.isArray(out[key]) || !Array.isArray(local[key])) continue;
    const seen = new Set(out[key].map((x) => (x && x.id) || JSON.stringify(x)));
    for (const item of local[key]) {
      const id = (item && item.id) || JSON.stringify(item);
      if (!seen.has(id)) {
        out[key].push(item);
        seen.add(id);
      }
    }
  }
  // Objects (budgets) and settings are last-writer-wins on purpose: they are
  // single values a person sets, not a log they append to.
  // Items above are whole-item theirs-wins, which would drop a "Mark as paid" made
  // here while another device saved: keep the later paidFor of the two copies.
  const mineSubs = new Map(local.subscriptions.map((x) => [x && x.id, x]));
  for (const s of out.subscriptions) {
    const p = s && (mineSubs.get(s.id) || {}).paidFor;
    if (p && p > (s.paidFor || '')) s.paidFor = p;
  }
  // A repeat's postedFor is forward-only like paidFor: the later month wins, or the
  // other device's copy would post this month's occurrence again after a delete.
  const mineRec = new Map(local.recurring.map((x) => [x && x.id, x]));
  for (const r of out.recurring) {
    const p = r && (mineRec.get(r.id) || {}).postedFor;
    if (p && p > (r.postedFor || '')) r.postedFor = p;
  }
  out.budgets = Object.assign({}, out.budgets, local.budgets);
  out.rollover = Object.assign({}, out.rollover, local.rollover);
  out.settings = Object.assign({}, out.settings, local.settings);
  const dead = Object.assign({}, out.tombstones);
  for (const [k, at] of Object.entries(local.tombstones)) dead[k] = Math.max(at, dead[k] || 0);
  out.tombstones = dead;
  for (const key of TOMBSTONED)
    out[key] = out[key].filter((x) => !(x && x.id && dead[key + ':' + x.id]));
  return out;
}


const goalSaved = (g) => (g.contribs || []).reduce((a, c) => a + (Number(c.amount) || 0), 0);

/* ---- Categories (built-in + custom tags) ---- */
function mergedCats(money) {
  const custom = (money && money.customCategories) || [];
  return DEFAULT_CATEGORIES.concat(
    custom.map((c) => ({
      key: c.key,
      label: c.label,
      icon: c.icon || 'tag',
      color: c.color || 'var(--sun-600)',
      soft: c.soft || 'var(--sun-50)',
      fg: c.fg || 'var(--sun-700)',
    }))
  );
}
function catOf(key, money) {
  return (
    mergedCats(money).find((c) => c.key === key) || {
      key: key || 'others',
      label: key || 'Others',
      icon: 'tag',
      color: 'var(--sun-600)',
      soft: 'var(--sun-50)',
      fg: 'var(--sun-700)',
    }
  );
}

/* =====================================================================
   Heuristic engine — pure functions over the money doc
   ===================================================================== */
function inRange(expenses, from, to) {
  return expenses.filter((e) => e.date >= from && e.date <= to);
}
function sumAmt(list) {
  return list.reduce((a, e) => a + (Number(e.amount) || 0), 0);
}
function byCategory(list, money) {
  const m = {};
  mergedCats(money).forEach((c) => (m[c.key] = 0));
  list.forEach((e) => {
    const k = m[e.category] !== undefined ? e.category : 'others';
    m[k] += Number(e.amount) || 0;
  });
  return m;
}
function pctChange(cur, prev) {
  if (prev <= 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}

/* 1 — auto-categorize a note (built-in keywords, then custom tag labels). */
function suggestCategory(text, money) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  for (const c of DEFAULT_CATEGORIES) {
    const ks = KEYWORDS[c.key];
    if (ks && ks.some((k) => t.includes(k))) return c.key;
  }
  for (const c of (money && money.customCategories) || []) {
    if (c.label && t.includes(String(c.label).toLowerCase())) return c.key;
  }
  return 'others';
}

/* 2 — weekly + monthly insights, plain language. */
function buildInsights(money) {
  const out = [];
  const tw = weekStartKey();
  const today = todayKey();
  const lwS = dkey(addDays(parseKey(tw), -7));
  const lwE = dkey(addDays(parseKey(tw), -1));
  const cur = inRange(money.expenses, tw, today);
  const prev = inRange(money.expenses, lwS, lwE);
  const curT = sumAmt(cur);
  const prevT = sumAmt(prev);
  if (cur.length && prevT > 0) {
    const ch = pctChange(curT, prevT);
    if (ch <= -10)
      out.push({
        tone: 'down',
        text: `You're spending ${Math.abs(ch)}% less than last week so far.`,
      });
    else if (ch >= 10)
      out.push({
        tone: 'up',
        text: `You've spent ${ch}% more than last week. Worth a quick glance.`,
      });
    else out.push({ tone: 'flat', text: `Your spending is steady — about the same as last week.` });
  }
  if (cur.length) {
    const cc = byCategory(cur, money);
    const pc = byCategory(prev, money);
    let best = null;
    mergedCats(money).forEach((c) => {
      if (pc[c.key] > 0 && cc[c.key] > 0) {
        const ch = pctChange(cc[c.key], pc[c.key]);
        if (!best || Math.abs(ch) > Math.abs(best.ch)) best = { c, ch };
      }
    });
    if (best && Math.abs(best.ch) >= 15)
      out.push(
        best.ch > 0
          ? { tone: 'up', text: `${best.c.label} is up ${best.ch}% vs last week.` }
          : { tone: 'down', text: `${best.c.label} is down ${Math.abs(best.ch)}% — nice control.` }
      );
  }
  const mExp = inRange(money.expenses, thisMonthPrefix() + '-01', today);
  if (mExp.length) {
    const mc = byCategory(mExp, money);
    const ranked = mergedCats(money)
      .map((c) => ({ c, v: mc[c.key] }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
    if (ranked.length >= 2)
      out.push({
        tone: 'info',
        text: `Most of your money this month goes to ${ranked[0].c.label} and ${ranked[1].c.label}.`,
      });
    else if (ranked.length === 1)
      out.push({ tone: 'info', text: `${ranked[0].c.label} is your main spend this month.` });
  }
  if (!out.length)
    out.push({
      tone: 'info',
      text: `Log a few expenses and I'll start spotting patterns for you.`,
    });
  return out.slice(0, 3);
}

/* 3 — per-category budget status (this month).

   Rollover (`money.rollover[cat]` = the 'YYYY-MM' it was switched on, null = off):
   what last month left unspent is added to this month's limit, and what it went
   over is taken off. `budget` is that effective limit, `base` the one set,
   `carried` the difference. One month deep on purpose: it carries last month
   against the limit as set today (no budget history is kept), so it never
   compounds. A month before the switch-on carries nothing, or turning it on would
   hand everyone a whole extra month of budget for a month they weren't tracking.
   The limit never goes below 0. */
function budgetStatus(money) {
  const spent = byCategory(inRange(money.expenses, thisMonthPrefix() + '-01', todayKey()), money);
  const last = lastMonthPrefix();
  const lastSpent = byCategory(inRange(money.expenses, last + '-01', last + '-31'), money);
  const roll = money.rollover || {};
  return mergedCats(money).map((c) => {
    const base = Number(money.budgets[c.key]) || 0;
    const since = roll[c.key];
    const carried =
      base > 0 && typeof since === 'string' && since <= last
        ? Math.round((base - (lastSpent[c.key] || 0)) * 100) / 100
        : 0;
    const budget = Math.max(0, base + carried);
    const s = spent[c.key] || 0;
    const pct = budget > 0 ? Math.round((s / budget) * 100) : base > 0 && s > 0 ? 101 : 0;
    return { cat: c, budget, base, carried, spent: s, pct, remaining: Math.max(0, budget - s) };
  });
}

// Used by money.js / money-home.js; not a public API.
export {
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
};
