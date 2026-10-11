/* Quick add's pure pieces: how a spoken expense or income becomes a Money entry
   (currency, date, account), and the words its preview row shows. No DOM, no
   state: app.js passes the Money document in. Tested by quick-add.test.mjs. */
import { homeCur, fxRate, fmtIn } from './money-core.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The intent's own day when it is a real YYYY-MM-DD, else `today`. */
export function intentDay(it, today) {
  return it && typeof it.date === 'string' && DAY.test(it.date) ? it.date : today;
}

/** '' for today, 'yesterday', else a short date ("9 Oct"). */
export function dayWord(day, today) {
  if (!day || day === today) return '';
  const t = new Date(today + 'T12:00:00');
  t.setDate(t.getDate() - 1);
  const y = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  if (day === y) return 'yesterday';
  return new Date(day + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Model text, minus emoji (pictographs, their joiners and variation selectors). */
export function stripEmoji(s) {
  return String(s == null ? '' : s)
    .replace(/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[\u{1F3FB}-\u{1F3FF}]|\u200D|\uFE0F|\u20E3/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** 'USD' -> '$', the key Money's rates use (settings.fx{'$': 83.2}). */
export function currencySymbol(iso) {
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency: iso, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part ? part.value : iso;
  } catch (_) {
    return iso;
  }
}

/* The account Money's own forms start on: expense = the last one paid from,
   else the first cash account (money.js openExpenseModal); income = the first
   bank or wallet (openAddIncome); either falls back to the first open account,
   as accountPicker does. null when there are no accounts. */
export function defaultAccount(money, kind) {
  const open = ((money && money.accounts) || []).filter((a) => !a.archived);
  if (!open.length) return null;
  const last = money.settings && money.settings.lastAccountId;
  if (kind === 'expense' && open.some((a) => a.id === last)) return last;
  const kinds = kind === 'expense' ? ['cash'] : ['bank', 'wallet'];
  return (open.find((a) => kinds.includes(a.kind)) || open[0]).id;
}

/* An expense / income intent as Money will store it. A named foreign currency
   is converted with the rate the user set (Customise > Other currencies) and
   keeps what was paid in `orig`, like Money's own form. With no rate, `noRate`
   is set: the preview leaves the row unticked, and if ticked anyway it is
   booked at face value because the user chose that. */
export function quickMoney(money, it, kind, today) {
  const home = homeCur(money);
  const v = Math.round(Number(it.amount) * 100) / 100;
  const date = intentDay(it, today);
  const accountId = defaultAccount(money, kind);
  const iso = it.currency ? String(it.currency).toUpperCase() : '';
  const sym = iso ? currencySymbol(iso) : home;
  const base = { date, ...(accountId ? { accountId } : {}) };
  if (!iso || sym === home || iso === home) {
    return { ...base, amount: v, label: fmtIn(v, home) };
  }
  const rateKey = fxRate(money, sym) ? sym : fxRate(money, iso) ? iso : null;
  if (!rateKey) return { ...base, amount: v, noRate: true, label: fmtIn(v, sym) + ' (no rate set)' };
  const rate = fxRate(money, rateKey);
  const amount = Math.round(v * rate * 100) / 100;
  return {
    ...base,
    amount,
    orig: { amount: v, currency: rateKey, rate },
    label: fmtIn(v, rateKey) + ' (' + fmtIn(amount, home) + ')',
  };
}

/* The tag a quick expense books under: what the note hints at, else the tag
   the user fixed in Money (Customise > "Always one tag"; before the
   defaultTagSet flag, anything but Others counted as picked, as money.js
   defaultTagOf), else Others. `hint` is suggestCategory's answer, which is
   'others' when the note says nothing. */
export function quickCategory(money, hint) {
  if (hint && hint !== 'others') return hint;
  const s = (money && money.settings) || {};
  const fixed = s.defaultTagSet === false ? null : s.defaultTagSet || s.defaultTag !== 'others' ? s.defaultTag : null;
  return fixed || hint || 'others';
}
