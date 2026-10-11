/* =====================================================================
   Growth Buddy — Circle, the pure parts (no DOM; checked by
   circle-core.test.mjs): where you stand in a challenge, the one-tap
   challenge templates, and the invite link. The wins worth sharing are in
   circle-wins.js, because app.js needs them at boot and this file is Circle's.
   ===================================================================== */

/** One-tap starts for "Start a challenge": each fills the form, Start sends it. */
export const CHALLENGE_TEMPLATES = [
  { label: '7-day habit sprint', title: '7-day habit sprint', metric: 'habit_checkins', days: 7 },
  { label: 'Focus week', title: 'Focus week', metric: 'focus_minutes', days: 7 },
  { label: 'Hydration week', title: 'Hit the water goal', metric: 'water_days', days: 7 },
  { label: '30-day streak', title: '30-day habit streak', metric: 'habit_checkins', days: 30 },
];

/**
 * One line on what to do next: "You're #2, 3 check-ins behind Priya." An ended
 * challenge names its winner instead. `unit(n)` is the metric's own wording.
 * Null when there is nothing to say (no board, or you're not on it).
 */
export function standingLine(entries, me, unit, ended) {
  if (!entries || !entries.length) return null;
  const top = entries.filter((e) => e.rank === 1);
  if (ended) {
    if (!top[0] || top[0].value <= 0) return 'Ended with no score on the board.';
    const names = top.map((e) => (e.userId === me ? 'You' : e.name));
    return (
      (names.length > 1
        ? names.join(' and ') + ' tied for the win'
        : names[0] === 'You'
          ? 'You won'
          : names[0] + ' won') +
      ' with ' +
      unit(top[0].value) +
      '.'
    );
  }
  const mine = entries.find((e) => e.userId === me);
  if (!mine || entries.length < 2) return null;
  if (mine.rank === 1) {
    if (top.length > 1) return 'Tied for first. One more puts you ahead.';
    const next = entries.find((e) => e.rank > 1);
    return next ? 'You lead by ' + unit(mine.value - next.value) + '.' : null;
  }
  const ahead = entries.filter((e) => e.rank < mine.rank).pop();
  return (
    "You're #" + mine.rank + ', ' + unit(ahead.value - mine.value) + ' behind ' + ahead.name + '.'
  );
}

/** The link that joins a circle in one tap: a private one by its code, a public one by id. */
export function inviteLink(base, c) {
  const q = c.joinCode
    ? 'join=' + encodeURIComponent(c.joinCode)
    : 'circle=' + encodeURIComponent(c.id);
  return base.replace(/#.*$/, '') + '#/circle?' + q;
}

/** What an opened invite link asks for: {code} or {id}, else null. */
export function inviteFromHash(hash) {
  const q = String(hash || '').split('?')[1];
  if (!q) return null;
  const p = new URLSearchParams(q);
  if (p.get('join')) return { code: p.get('join').toUpperCase() };
  if (p.get('circle')) return { id: p.get('circle') };
  return null;
}

/* ---- The seat ring: the circle drawn as its members ---- */

/** Most seats the ring draws; past that the last seat reads "+N". */
export const MAX_SEATS = 12;

/**
 * Where each of `n` seats sits on the ring, as percentages of the ring's box:
 * the first at twelve o'clock, then clockwise, evenly spaced. `radius` is the
 * ring's, in the same percent units (the SVG track uses the same number).
 */
export function seatLayout(n, radius = 40) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    out.push({
      x: Math.round((50 + radius * Math.cos(a)) * 100) / 100,
      y: Math.round((50 + radius * Math.sin(a)) * 100) / 100,
    });
  }
  return out;
}

/**
 * Who is in today. `doneToday` is null for a member who keeps progress
 * private: they are neither in nor quiet, just unknown. `quiet` leaves you out
 * (you don't cheer yourself) and is who "Cheer the N still to check in" taps.
 */
export function presence(members, me) {
  const known = (members || []).filter((m) => m.doneToday !== null && m.doneToday !== undefined);
  const lit = known.filter((m) => m.doneToday > 0);
  return {
    lit: lit.length,
    known: known.length,
    quiet: known.filter((m) => m.doneToday === 0 && m.userId !== me),
    meIn: known.some((m) => m.userId === me && m.doneToday > 0),
  };
}

/**
 * Seat order around the ring: everyone in today first, then those not yet,
 * then those who keep progress private; you lead whichever group you are in.
 * Grouped so the lit arc covers exactly the lit seats: the track's fill starts
 * half a seat before the first and runs for lit/total of the ring.
 */
export function seatOrder(members, me) {
  const rank = (m) => (m.doneToday == null ? 2 : m.doneToday > 0 ? 0 : 1);
  return (members || [])
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m) - rank(b.m) || (b.m.userId === me) - (a.m.userId === me) || a.i - b.i)
    .map((x) => x.m);
}

/** "JD" from "Jane Doe", "PR" from "priya raman", one letter for one word. */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const pick = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return pick.map((w) => w[0].toUpperCase()).join('');
}

/**
 * Which day of a challenge today is: {day, total} (day 1 = the start date),
 * or null before it starts / after it ends. Dates are local YYYY-MM-DD.
 */
export function challengeDay(start, end, today) {
  if (!start || !end || !today || today < start || today > end) return null;
  const d = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const day = Math.round((d(today) - d(start)) / 86400000) + 1;
  const total = Math.round((d(end) - d(start)) / 86400000) + 1;
  return { day, total };
}

/* ponytail: the checklist lives in the existing 500-char agreement column, one item a
   line, "[x] " marking a done one. An agreement written before the checklist reads as
   one open item. An agreement_items table is the upgrade if pairs outgrow ~10 items. */
export const AGREEMENT_MAX = 500;
const DONE_MARK = /^\[(x| )\]\s*/i;
export function parseAgreement(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ done: /^\[x\]/i.test(l), text: l.replace(DONE_MARK, '') }))
    .filter((it) => it.text);
}
export function formatAgreement(items) {
  return items.map((it) => (it.done ? '[x] ' : '[ ] ') + it.text).join('\n');
}
