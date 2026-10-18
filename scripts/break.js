/* "Take a break" (I-08). ui_prefs.breakFrom .. breakUntil, 'YYYY-MM-DD',
   both days inclusive. The server reads the same pair (habit/OnBreak.java):
   streaks hold over break days without a freeze token, nothing is owed, and
   habit reminders, the evening reflection and the digest stay quiet. Timed
   reminders still ring. Pure, no DOM, so node tests load it. */
import { localKey } from './dates.js';

export const BREAK_LENGTHS = [3, 7, 14];
/* The longest the server takes (OnBreak.MAX_DAYS, less a rescue's yesterday). */
export const MAX_BREAK_DAYS = 14;

function addDays(key, n) {
  const [y, m, d] = String(key).split('-').map(Number);
  return localKey(new Date(y, m - 1, d + n));
}

const KEY = /^\d{4}-\d{2}-\d{2}$/;

/* The break as stored, or null when there is none to read. A string compare
   orders 'YYYY-MM-DD' keys correctly. */
function range(prefs) {
  const from = prefs && prefs.breakFrom;
  const until = prefs && prefs.breakUntil;
  if (!KEY.test(from || '') || !KEY.test(until || '') || until < from) return null;
  return { from, until };
}

/* Every break day, the current break and the remembered ones (breakPast,
   "from..until", which only the server writes): what OnBreak.days reads. A
   day in it owes nothing and holds a streak, so history and insights must not
   read it as missed. A range over the server's 15 days is skipped, as there. */
export function breakDays(prefs) {
  const out = new Set();
  const past = (prefs && Array.isArray(prefs.breakPast) ? prefs.breakPast : []).map((s) => {
    const [breakFrom, breakUntil] = String(s).split('..');
    return { breakFrom, breakUntil };
  });
  for (const p of [prefs, ...past]) {
    const r = range(p);
    if (!r || addDays(r.from, 15) <= r.until) continue; // longer than OnBreak.MAX_DAYS
    for (let k = r.from; k <= r.until; k = addDays(k, 1)) out.add(k);
  }
  return out;
}

export function onBreakDay(prefs, key) {
  const r = range(prefs);
  return !!r && key >= r.from && key <= r.until;
}

/* What Home says today: { on, until } inside a break, { back } the day after
   one ends (also the day "End now" was tapped), null otherwise. */
export function breakState(prefs, today) {
  const r = range(prefs);
  if (!r) return null;
  if (today >= r.from && today <= r.until) return { on: true, from: r.from, until: r.until };
  if (today === addDays(r.until, 1)) return { back: true, until: r.until };
  return null;
}

/* `days` from today. `rescue` (offered when yesterday was missed) starts it
   yesterday, so that miss is covered too; the server allows exactly that. */
export function startBreak(days, today, rescue = false) {
  return { breakFrom: rescue ? addDays(today, -1) : today, breakUntil: addDays(today, days - 1) };
}

/* Ending early: the break closes yesterday, so today is owed again. */
export function endBreak(today) {
  return { breakUntil: addDays(today, -1) };
}
