/* =====================================================================
   Growth Buddy — Money Buddy core (the light half of money.js)
   ---------------------------------------------------------------------
   What the boot chunk needs without the Money screen: the document model
   (emptyMoney / normalizeMoney / mergeMoney, tombstones), the ledger split
   app.js saves through (ledgerDiff / applyLedgerDiff / docPart), and the
   few engines Home's Money card reads (budgetStatus, buildInsights), with
   the date / currency / category helpers under them. No DOM; imports only
   the pure dates.js.
   money.js imports all of it and re-exports what it used to export, so the
   tests and older import paths keep working; the screen itself is a lazy
   chunk (app.js SCREENS.money → lazyScreen).
   `cur` is a live binding: applyCurrency() here sets it, money.js reads it.
   ===================================================================== */
import { pad2, localKey as dkey, todayKey } from './dates.js';

const CUR = '₹';
// Display currency symbol — customizable via settings.currency; applied from
// the money doc whenever the screen/widget/modals render. ponytail: a single
// module-level display var beats threading currency through every fmt() call.
let cur = CUR;

/* The home currency for an account that never picked one: the device's region,
   read from its language (`en-GB` -> GB -> £; a bare `en` has none). An Indian timezone wins over the
   language, since plenty of phones in India run en-US. Anything not listed keeps
   CUR. A currency the user set (Customise) is stored and always wins. */
const REGION_CUR = { US: '$', CA: '$', AU: '$', NZ: '$', SG: '$', HK: '$', GB: '£', JP: '¥', CN: '¥', KR: '₩', NG: '₦', PH: '₱', AE: 'AED', SA: 'SAR', ZA: 'R', LK: 'Rs', PK: 'Rs', NP: 'Rs', BD: '৳', MY: 'RM', ID: 'Rp', TH: '฿', VN: '₫', BR: 'R$', MX: '$', CH: 'CHF', SE: 'kr', NO: 'kr', DK: 'kr', PL: 'zł', TR: '₺', RU: '₽', IL: '₪', EG: 'E£', KE: 'KSh' };
const EURO = new Set(['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'GR', 'SK', 'SI', 'LT', 'LV', 'EE', 'LU', 'MT', 'CY', 'HR']);
export function currencyFor(locale, timeZone) {
  if (/^Asia\/(Kolkata|Calcutta)$/.test(timeZone || '')) return CUR;
  let region = '';
  try {
    region = new Intl.Locale(locale).region || ''; // never maximize(): it invents one ('en' -> US, 'ar' -> EG)
  } catch (_) {
    /* no or bad locale: the default */
  }
  return REGION_CUR[region] || (EURO.has(region) ? '€' : CUR);
}
let deviceCur = null;
function deviceCurrency() {
  if (deviceCur) return deviceCur;
  try {
    deviceCur = currencyFor(navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch (_) {
    deviceCur = CUR;
  }
  return deviceCur;
}

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
    soft: 'var(--brand-soft)',
    fg: 'var(--brand-soft-fg)',
  },
  {
    key: 'shopping',
    label: 'Shopping',
    icon: 'shopping-bag',
    color: 'var(--bloom-500)',
    soft: 'var(--social-soft)',
    fg: 'var(--social-soft-fg)',
  },
  {
    key: 'transport',
    label: 'Transport',
    icon: 'bus',
    color: 'var(--sky-500)',
    soft: 'var(--info-soft)',
    fg: 'var(--info-soft-fg)',
  },
  {
    key: 'entertainment',
    label: 'Entertainment',
    icon: 'clapperboard',
    color: 'var(--iris-500)',
    soft: 'var(--ai-soft)',
    fg: 'var(--ai-soft-fg)',
  },
  {
    key: 'education',
    label: 'Education',
    icon: 'graduation-cap',
    color: 'var(--leaf-600)',
    soft: 'var(--success-soft)',
    fg: 'var(--success-soft-fg)',
  },
  {
    key: 'others',
    label: 'Others',
    icon: 'shapes',
    color: 'var(--sun-600)',
    soft: 'var(--warning-soft)',
    fg: 'var(--warning-soft-fg)',
  },
];

/* Swatches a user picks from when creating a custom tag. */
const PALETTE = [
  { color: 'var(--coral-500)', soft: 'var(--brand-soft)', fg: 'var(--brand-soft-fg)' },
  { color: 'var(--bloom-500)', soft: 'var(--social-soft)', fg: 'var(--social-soft-fg)' },
  { color: 'var(--sky-500)', soft: 'var(--info-soft)', fg: 'var(--info-soft-fg)' },
  { color: 'var(--iris-500)', soft: 'var(--ai-soft)', fg: 'var(--ai-soft-fg)' },
  { color: 'var(--leaf-600)', soft: 'var(--success-soft)', fg: 'var(--success-soft-fg)' },
  { color: 'var(--sun-600)', soft: 'var(--warning-soft)', fg: 'var(--warning-soft-fg)' },
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
    'blinkit',
    'zepto',
    'bigbasket',
    'instamart',
    'dmart',
    'vegetables',
    'fruits',
    'bread',
    'eggs',
    'rice',
    'chai',
    'biryani',
    'dosa',
    'idli',
    'burger',
    'kfc',
    'mcdonalds',
    'dominos',
    'starbucks',
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
    'rapido',
    'taxi',
    'irctc',
    'fastag',
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
    'bookmyshow',
    'youtube',
    'disney',
    'playstation',
    'steam',
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
  const x = Number(n) || 0;
  // Round the size, then sign it: Math.round(-1200.5) is -1200 but 1200.5 is 1201,
  // so the same expense read 1,200 spent on the slip and 1,201 on the card.
  const v = Math.round(Math.abs(x));
  // Sign before the symbol, as a true minus: "₹-240" beside an account's "−₹240".
  return (x < 0 && v ? '\u2212' : '') + cur + v.toLocaleString('en-IN');
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
  // Amount untouched keeps the stored figures, unless the account (so maybe the currency) moved.
  if (accountId === ex.accountId && v === (ex.orig ? ex.orig.amount : ex.amount)) return { amount: ex.amount, orig: ex.orig };
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
    throw underField(input, 'Use digits only, like 1250 or 1250.50.');
  }
  return Math.round(Number(input.value) * 100) / 100;
}
/* gb-kit's fieldRefusal contract (an Error with `.field`), without importing the
   kit into core: openModal shows the message under that input, not as a toast. */
function underField(input, message) {
  const err = new Error(message);
  err.field = input;
  return err;
}
/* readAmount's twin for the fields kept in whole rupees on purpose (budgets,
   subscriptions). They carry step=1 and a numeric keyboard; a decimal pasted or
   typed anyway is refused, not rounded behind the user's back. */
function readWhole(input) {
  if (input.validity && (input.validity.badInput || input.validity.stepMismatch)) {
    throw underField(input, 'Whole amounts only, like 1250.');
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
    // A save's explicit ledger deletes (loanMove), read by ledgerDiff; never stored (docPart).
    ...(Array.isArray(m.ledgerDeletes) ? { ledgerDeletes: m.ledgerDeletes } : {}),
    // ponytail: the device's currency is seeded here, not written: it reaches the
    // server with the next document save (any budget, goal or setting). Until then
    // the server's own messages (WhatsApp, day summary) still say ₹.
    settings: Object.assign({}, e.settings, { currency: deviceCurrency() }, m.settings || {}),
    currency: CUR,
  };
}
/* ---- Deletes that survive a merge ----
   The document's own lists (loans, goals, subscriptions, challenges, wishlist) are
   merged after a 409, so a delete on one device came back from the other device's
   copy. A delete now leaves a tombstone ("loans:<id>" -> when): applyDocDiff won't
   re-add an item the copy has one for, and mergeMoney drops any item either side
   has one for. Kept 120 days:
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
  // Ids a save names as gone that may not be loaded at all (loanMove: an old loan's moves).
  const live = new Set(((after && after.transfers) || []).map((x) => x && x.id));
  for (const id of (after && after.ledgerDeletes) || [])
    if (!live.has(id) && !deletes.includes(id)) deletes.push(id);
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
  delete out.ledgerDeletes;
  return out;
}

/* ---- The document part of a save, as ops ----
   What one save changed in the document, keyed by what it touches: an item of a
   list (by id, a tag by key, a no-spend day by value), one key of an object
   (budgets, rollover, settings, tombstones), or a whole scalar. Two saves' ops
   combine with Object.assign, newest per key wins. Laid onto any copy with
   applyDocDiff, so a save built from an older snapshot changes only what its own
   edit changed (it used to replace the live document whole), and an edit the
   server never accepted is replayed onto the server's copy at the next load or
   conflict instead of being dropped by it. Pure; pinned in money-doc.test.mjs. */
function docId(x) {
  if (x && typeof x === 'object') {
    if (x.id != null) return 'i' + x.id;
    if (x.key != null) return 'k' + x.key;
  }
  return 'v' + stable(x);
}
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function docDiff(before, after) {
  const a = docPart(before || {});
  const b = docPart(after || {});
  const ops = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const was = a[key];
    const now = b[key];
    if (stable(was) === stable(now)) continue;
    if (Array.isArray(was) && Array.isArray(now)) {
      const old = new Map(was.map((x) => [docId(x), x]));
      const kept = new Set();
      for (const x of now) {
        const id = docId(x);
        kept.add(id);
        if (!old.has(id)) ops[key + ':' + id] = { key, id, item: x };
        else if (stable(old.get(id)) !== stable(x)) ops[key + ':' + id] = { key, id, item: x, base: old.get(id) };
      }
      for (const id of old.keys()) if (!kept.has(id)) ops[key + ':' + id] = { key, id, gone: true };
    } else if (isPlain(was) && isPlain(now)) {
      for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
        if (stable(was[k]) === stable(now[k])) continue;
        ops[key + '.' + k] =
          now[k] === undefined ? { key, sub: k, gone: true } : { key, sub: k, value: now[k] };
      }
    } else ops[key] = { key, value: now };
  }
  return ops;
}

/* Our list, less what they removed since base, plus what they added that we don't
   have. By value, so laying the same op twice changes nothing; a new contribution
   or repayment carries an id, so two equal ones from two devices stay two. */
function union3(base, mine, theirs) {
  const b = new Set(base.map(stable));
  const t = new Set(theirs.map(stable));
  const m = new Set(mine.map(stable));
  return mine
    .filter((x) => !b.has(stable(x)) || t.has(stable(x)))
    .concat(theirs.filter((x) => !b.has(stable(x)) && !m.has(stable(x))));
}

export function applyDocDiff(money, ops) {
  const out = Object.assign({}, money);
  for (const op of Object.values(ops || {})) {
    const cur = out[op.key];
    if (op.id !== undefined) {
      const list = Array.isArray(cur) ? cur.slice() : [];
      const i = list.findIndex((x) => docId(x) === op.id);
      if (op.gone) {
        if (i >= 0) list.splice(i, 1);
      } else if (i >= 0) {
        // paidFor / postedFor only move forward: a WhatsApp "Mark as paid" on the
        // server's copy survives an edit to the same bill made here. An explicit
        // null (a deleted payment, dropExpense) is an un-pay and goes through.
        const item = Object.assign({}, op.item);
        for (const f of ['paidFor', 'postedFor'])
          if (item[f] !== null && list[i] && list[i][f] && list[i][f] > (item[f] || '')) item[f] = list[i][f];
        // A goal's contributions and a loan's repayments are logs both devices
        // append to: three-way against the item this edit started from, so the
        // other copy's new entries (and its removals) survive ours.
        for (const f of ['contribs', 'repaid'])
          if (op.base && Array.isArray(item[f]) && list[i] && Array.isArray(list[i][f]))
            item[f] = union3(Array.isArray(op.base[f]) ? op.base[f] : [], item[f], list[i][f]);
        list[i] = item;
      } else if (
        !(op.item && op.item.id != null && (out.tombstones || {})[op.key + ':' + op.item.id])
      ) {
        list.push(op.item); // not when the other copy deleted it: the delete wins
      }
      out[op.key] = list;
    } else if (op.sub !== undefined) {
      const obj = Object.assign({}, isPlain(cur) ? cur : {});
      if (op.gone) delete obj[op.sub];
      else obj[op.sub] = op.value;
      out[op.key] = obj;
    } else out[op.key] = op.value;
  }
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
    custom.map((c) => {
      // Saved tags carry the swatch's soft/fg as they were then (raw ramp steps,
      // light-only); read them from today's PALETTE by colour so dark mode follows.
      const p = PALETTE.find((x) => x.color === c.color) || c;
      return {
        key: c.key,
        label: c.label,
        icon: c.icon || 'tag',
        color: c.color || 'var(--sun-600)',
        soft: p.soft || 'var(--warning-soft)',
        fg: p.fg || 'var(--warning-soft-fg)',
      };
    })
  );
}
function catOf(key, money) {
  return (
    mergedCats(money).find((c) => c.key === key) || {
      key: key || 'others',
      label: key || 'Others',
      icon: 'tag',
      color: 'var(--sun-600)',
      soft: 'var(--warning-soft)',
      fg: 'var(--warning-soft-fg)',
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

/* 1 — auto-categorize a note. `predictCategory` is the whole of it, pure, so
   Quick add can ask the same question; `suggestCategory` is it over a money doc. */
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'at', 'of', 'on', 'in', 'my', 'to', 'a', 'an', 'some', 'got']);
function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}
// Whole words, or a word starting with a 4+ letter keyword ("groceries" / "grocery",
// "movies" / "movie"): a substring test filed "chocolate" under Transport (ola).
function wordHit(word, k) {
  return word === k || (k.length >= 4 && word.startsWith(k));
}

/**
 * The category a note means, or null for an empty one.
 * 1. The user's own history: the newest expense with the same note wins, else
 *    the one sharing the most words (newest on a tie). A tag they corrected is
 *    what that expense now carries, so a correction teaches the next guess with
 *    nothing stored for it. A partial match filed under Others is no signal.
 * 2. A tag named outright ("groceries" when they have a Groceries tag), then
 *    the built-in keywords.
 * 3. 'others'.
 * `history`: expenses ({note, category, date, createdAt}); `categories`: the
 * [{key, label}] the user has (mergedCats) — a guess is always one of them.
 */
function predictCategory(text, history, categories) {
  const words = tokens(text);
  const norm = String(text || '').trim().toLowerCase();
  if (!norm) return null;
  const cats = categories && categories.length ? categories : DEFAULT_CATEGORIES;
  const valid = new Set(cats.map((c) => c.key));
  const fallback = valid.has('others') ? 'others' : cats[0].key;
  let best = null;
  let bestScore = 0;
  const newer = (a, b) =>
    !b || (a.date || '') > (b.date || '') || ((a.date || '') === (b.date || '') && (a.createdAt || 0) > (b.createdAt || 0));
  for (const e of history || []) {
    if (!e || !valid.has(e.category)) continue;
    const note = String(e.note || '').trim().toLowerCase();
    if (!note) continue;
    let score;
    if (note === norm) score = Infinity;
    else if (e.category === 'others') continue;
    else {
      const theirs = tokens(note);
      score = words.filter((w) => theirs.some((t) => wordHit(w, t) || wordHit(t, w))).length;
    }
    if (score > bestScore || (score === bestScore && score > 0 && newer(e, best))) {
      best = e;
      bestScore = score;
    }
  }
  if (best) return best.category;
  for (const c of cats) {
    const label = tokens(c.label);
    if (label.length && label.every((l) => words.some((w) => wordHit(w, l)))) return c.key;
  }
  for (const c of DEFAULT_CATEGORIES) {
    const ks = KEYWORDS[c.key];
    if (valid.has(c.key) && ks && words.some((w) => ks.some((k) => wordHit(w, k)))) return c.key;
  }
  return fallback;
}

function suggestCategory(text, money) {
  return predictCategory(text, money && money.expenses, mergedCats(money));
}

/* This week so far against the same days of last week (Mon..today vs last
   Mon..same weekday). The one week-over-week window: Home's card, Coach and the
   weekly review all read it, so their numbers agree. Comparing a partial week with
   a whole one said "less than last week" every Monday. */
function weekVsLast(money, today = todayKey()) {
  const tw = weekStartKey(parseKey(today));
  const n = diffDays(today, tw);
  const lwS = dkey(addDays(parseKey(tw), -7));
  const lwE = dkey(addDays(parseKey(lwS), n));
  const cur = inRange(money.expenses, tw, today);
  const prev = inRange(money.expenses, lwS, lwE);
  return { from: tw, cur, prev, curT: sumAmt(cur), prevT: sumAmt(prev) };
}

/* 2 — weekly + monthly insights, plain language. The week lines say "this week",
   since Home shows them under a month figure. */
function buildInsights(money) {
  const out = [];
  const today = todayKey();
  const { cur, prev, curT, prevT } = weekVsLast(money, today);
  // The tag that moved most, worked out first: "steady" above "Transport is up
  // 67%" contradicted itself, so a tag moving more than 25% rules steady out.
  let best = null;
  if (cur.length) {
    const cc = byCategory(cur, money);
    const pc = byCategory(prev, money);
    mergedCats(money).forEach((c) => {
      if (pc[c.key] > 0 && cc[c.key] > 0) {
        const ch = pctChange(cc[c.key], pc[c.key]);
        if (!best || Math.abs(ch) > Math.abs(best.ch)) best = { c, ch };
      }
    });
  }
  if (cur.length && prevT > 0) {
    const ch = pctChange(curT, prevT);
    if (ch <= -10)
      out.push({
        tone: 'down',
        text: `This week you're spending ${Math.abs(ch)}% less than by this point last week.`,
      });
    else if (ch >= 10)
      out.push({
        tone: 'up',
        text: `This week you've spent ${ch}% more than by this point last week. Worth a quick glance.`,
      });
    else if (!best || Math.abs(best.ch) <= 25)
      out.push({ tone: 'flat', text: `Your spending this week is steady, about the same as last week.` });
  }
  if (best && Math.abs(best.ch) >= 15)
    out.push(
      best.ch > 0
        ? { tone: 'up', text: `${best.c.label} is up ${best.ch}% vs the same days last week.` }
        : { tone: 'down', text: `${best.c.label} is down ${Math.abs(best.ch)}% vs the same days last week. Nice control.` }
    );
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

/* Add income's Salary help: `last` = the newest salary (to prefill), `repeat` =
   {amount, day} once two salaries of the same amount landed on the same day of
   two different months, unless an active salary repeat already exists. The day is
   'last' only when both were their month's last day (30 Apr + 30 Jun, 31 Jan + 31
   Mar); a 29th or 30th otherwise stays that day. Pure. */
function salaryPattern(money) {
  const sal = (money.income || [])
    .filter((i) => i && i.source === 'salary' && Number(i.amount) > 0)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const last = sal[0] || null;
  let repeat = null;
  for (let i = 0; i < sal.length && !repeat; i++)
    for (let j = i + 1; j < sal.length && !repeat; j++) {
      const a = sal[i];
      const b = sal[j];
      if (Number(a.amount) === Number(b.amount) && a.date.slice(8) === b.date.slice(8) && a.date.slice(0, 7) !== b.date.slice(0, 7)) {
        const d = Number(a.date.slice(8));
        // 'last' only when both really were month-ends; a 29th or 30th stays itself
        // (recurDate clamps it in a shorter month).
        const end = (x) => d === new Date(Number(x.date.slice(0, 4)), Number(x.date.slice(5, 7)), 0).getDate();
        repeat = { amount: Number(a.amount), day: end(a) && end(b) ? 'last' : d };
      }
    }
  const has = (money.recurring || []).some((r) => r && r.active && r.kind === 'income' && r.category !== 'other');
  return { last, repeat: has ? null : repeat };
}

/* This month's salary when its usual day (salaryPattern) has come and no salary
   is logged this month yet: {amount, date, last}, else null. Add income dates
   itself to it; the Income tab and Home offer it as one tap. Pure. */
function salaryDue(money) {
  const pat = salaryPattern(money);
  if (!pat.repeat) return null;
  const ym = thisMonthPrefix();
  const dim = daysInMonth();
  const date = ym + '-' + pad2(pat.repeat.day === 'last' ? dim : Math.min(dim, pat.repeat.day));
  if (date > todayKey()) return null;
  if ((money.income || []).some((i) => i && i.source === 'salary' && String(i.date || '').startsWith(ym))) return null;
  return { amount: pat.repeat.amount, date, last: pat.last };
}

/* The income row "Salary arrived?" logs: the due amount on its day, on the account
   the last salary went to, keeping that one's currency and rate when the amount
   matches. Shared by the Income tab and Home's Money card. */
function salaryDueRow(money, due) {
  const last = due.last;
  const acc =
    last && (money.accounts || []).some((a) => !a.archived && a.id === last.accountId) ? last.accountId : null;
  const orig = last && last.orig && Number(last.amount) === due.amount ? last.orig : null;
  return {
    id: uid(),
    amount: due.amount,
    ...(orig ? { orig } : {}),
    source: 'salary',
    label: 'Salary',
    date: due.date,
    ...(acc ? { accountId: acc } : {}),
  };
}

/* Automatic capture (server: money/CaptureService). A row it booked carries
   `capture: {via, review?, dupOf?, typed?}`: via = 'notif' | 'sms' | 'share' |
   'ios'; review only when it is genuinely unsure ('check': nothing ties it to a
   payment, 'dup': the same money as a cash entry typed that day, 'transfer': looks
   like a move between two of your accounts); typed = a quick add or WhatsApp
   sentence already named it. Rows count in every total whether reviewed or not. */
function capturedToReview(money) {
  const rows = [];
  for (const [list, kind] of [['expenses', 'expense'], ['income', 'income']])
    for (const r of (money && money[list]) || [])
      if (r && r.capture && r.capture.review) rows.push({ kind, row: r });
  return rows.sort((a, b) => String(b.row.date).localeCompare(String(a.row.date)));
}

/* The captured row a typed entry is about: same kind, same amount to the paisa,
   same day, not already named by an earlier sentence. Newest first. A quick add
   fills it in (note, tag) instead of adding the payment a second time. */
function matchCaptured(money, kind, amount, date) {
  const list = (money && money[kind === 'income' ? 'income' : 'expenses']) || [];
  const want = Math.round(Number(amount) * 100);
  return (
    list
      .filter((r) => r && r.capture && !r.capture.typed && r.date === date && !r.orig && Math.round(Number(r.amount) * 100) === want)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null
  );
}

/* That row, named by the sentence: its words as the note (or label), out of
   review. Everything else (account, last 4, tag unless one is given) stays. */
function claimCaptured(row, words, patch) {
  const cap = { ...(row.capture || {}), typed: true };
  delete cap.review;
  delete cap.dupOf;
  return { ...row, ...(patch || {}), capture: cap };
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
  weekVsLast,
  suggestCategory,
  predictCategory,
  buildInsights,
  budgetStatus,
  salaryPattern,
  salaryDue,
  salaryDueRow,
  capturedToReview,
  matchCaptured,
  claimCaptured,
};
