// node scripts/app-logic.test.mjs — the pure rules app.js, calendar.js and
// gb-kit.js lean on for races and payloads: water taps landing out of order,
// the offline water replay, the backdated-summary guard, the week cache's
// generation, goal-progress rollback, the double-tap guard, the reminder edit
// PATCH, the saved bottom-nav layout, which first-run steps show, and when to ask for push.
import assert from 'node:assert/strict';
import {
  overlayPendingWater,
  replayOldestFirst,
  summaryIsForToday,
  generation,
  applyWeekInvalidation,
  latestSeq,
  restoreKey,
  inFlightKeys,
  overlayQueuedWellness,
  networkError,
  offlineError,
  sameZone,
  firstRunSteps,
  pushAskDue,
  noonIn,
  SAVED_ON_PHONE,
  savedLocallyMessage,
} from './app-logic.js';
import { sessionEndedError } from './session.js';
import { timeRangeOk, reminderEditPatch } from './calendar.js';
import { resolveNavLayout, splitNavBar, NAV_CATALOG, NAV_MAX_PRIMARY } from './gb-kit.js';

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('ok   ' + name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + err.message);
  }
}

// ---- 1. calendar: TimeRange validation + the edit dialog's PATCH ----

await test('an end time is optional, but must be after the start', () => {
  assert.equal(timeRangeOk('09:00', ''), true);
  assert.equal(timeRangeOk('', ''), true);
  assert.equal(timeRangeOk('09:00', '10:00'), true);
  assert.equal(timeRangeOk('09:00', '09:00'), false, 'zero-length block');
  assert.equal(timeRangeOk('09:00', '08:59'), false);
  assert.equal(timeRangeOk('09:30', '10:05'), true, 'string compare is a time compare for HH:MM');
});

const base = { text: 'Call', time: '09:00', endTime: '', tag: 'work', sound: '', lead: null, movedDate: null, repeat: null, until: '' };

await test('edit PATCH: blanks become null, a default lead becomes -1', () => {
  const p = reminderEditPatch({ time: '09:00' }, base);
  assert.deepEqual(p, { text: 'Call', time: '09:00', endTime: null, tag: 'work', sound: '', notifyBefore: -1 });
});

await test('edit PATCH: a chosen lead is sent as is (0 is not "default")', () => {
  assert.equal(reminderEditPatch({}, { ...base, lead: 0 }).notifyBefore, 0);
  assert.equal(reminderEditPatch({}, { ...base, lead: 15 }).notifyBefore, 15);
});

await test('edit PATCH: removing a time says allDay outright', () => {
  const p = reminderEditPatch({ time: '09:00' }, { ...base, time: '' });
  assert.equal(p.time, null);
  assert.equal(p.allDay, true);
  assert.equal('allDay' in reminderEditPatch({ time: null }, { ...base, time: '' }), false, 'was already all-day');
});

await test('edit PATCH: only a moved single occurrence carries a date', () => {
  assert.equal('date' in reminderEditPatch({}, base), false);
  assert.equal(reminderEditPatch({}, { ...base, movedDate: '2026-10-12' }).date, '2026-10-12');
});

await test('edit PATCH: repeat / until / clearUntil', () => {
  assert.equal('repeat' in reminderEditPatch({}, base), false, "scope 'this' sends no repeat");
  const none = reminderEditPatch({ until: '2026-12-01' }, { ...base, repeat: 'none', until: '2026-12-01' });
  assert.equal(none.repeat, 'none');
  assert.equal('until' in none || 'clearUntil' in none, false, 'no until on a non-repeating one');
  assert.equal(reminderEditPatch({}, { ...base, repeat: 'weekly', until: '2026-12-01' }).until, '2026-12-01');
  const cleared = reminderEditPatch({ until: '2026-12-01' }, { ...base, repeat: 'weekly', until: '' });
  assert.equal(cleared.clearUntil, true);
  assert.equal('until' in cleared, false);
  assert.equal('clearUntil' in reminderEditPatch({}, { ...base, repeat: 'weekly' }), false, 'nothing to clear');
});

// ---- 2. water: pending overlay + offline replay ----

const dayOf = (iso) => iso.slice(0, 10);
const effectiveMl = (ml, drink) => (drink === 'coffee' ? Math.round(ml * 0.8) : ml);
const opts = { today: '2026-10-10', dayOf, effectiveMl };

await test('pending glasses are laid over the server total, effective ml', () => {
  const pending = new Map([
    ['p1', { amountMl: 250, loggedAt: '2026-10-10T08:00:00Z' }],
    ['p2', { amountMl: 250, loggedAt: '2026-10-10T08:01:00Z', drinkType: 'coffee' }],
  ]);
  const w = overlayPendingWater({ date: '2026-10-10', consumedMl: 500, goalMl: 2000, entries: [{ id: 1 }] }, pending, opts);
  assert.equal(w.consumedMl, 500 + 250 + 200);
  assert.equal(w.goalMl, 2000);
  assert.deepEqual(w.entries.map((e) => e.id), [1, 'p1', 'p2']);
  assert.equal(w.entries[1].drinkType, 'water');
});

await test("a glass queued for yesterday is not on today's card", () => {
  const pending = new Map([['old', { amountMl: 300, loggedAt: '2026-10-09T23:50:00Z' }]]);
  assert.equal(overlayPendingWater({ date: '2026-10-10', consumedMl: 0 }, pending, opts).consumedMl, 0);
  assert.equal(overlayPendingWater({ date: '2026-10-09', consumedMl: 0 }, pending, opts).consumedMl, 300);
  assert.equal(overlayPendingWater(null, new Map([['t', { amountMl: 100, loggedAt: '2026-10-10T01:00:00Z' }]]), opts).consumedMl, 100, 'no summary: today');
});

await test('two POSTs landing out of order still show both glasses', () => {
  // Taps A and B are in flight. The server sees A then B, but B's answer arrives first.
  const pending = new Map([
    ['A', { amountMl: 250, loggedAt: '2026-10-10T08:00:00Z' }],
    ['B', { amountMl: 250, loggedAt: '2026-10-10T08:00:01Z' }],
  ]);
  const serverAfterA = { date: '2026-10-10', consumedMl: 250, entries: [{ id: 101 }] };
  const serverAfterAB = { date: '2026-10-10', consumedMl: 500, entries: [{ id: 101 }, { id: 102 }] };
  // B's answer lands first carrying A+B, while A is still pending client-side:
  // A is briefly counted twice (known, transient: never fewer than tapped).
  pending.delete('B');
  let card = overlayPendingWater(serverAfterAB, pending, opts);
  assert.equal(card.consumedMl, 750, 'transient overcount until A answers');
  // A's answer then lands: A leaves pending and the card settles.
  pending.delete('A');
  card = overlayPendingWater(serverAfterA, pending, opts);
  assert.equal(card.consumedMl, 250, 'known gap: the overlay cannot restore B from an older summary — app.js must not paint it (see report)');
  card = overlayPendingWater(serverAfterAB, pending, opts);
  assert.equal(card.consumedMl, 500);
  // The other order: A's answer (A only) lands while B is still pending.
  const p2 = new Map([['B', { amountMl: 250, loggedAt: '2026-10-10T08:00:01Z' }]]);
  card = overlayPendingWater(serverAfterA, p2, opts);
  assert.equal(card.consumedMl, 500, 'B is laid back over A’s answer');
  assert.deepEqual(card.entries.map((e) => e.id), [101, 'B']);
});

await test('offline replay sends oldest first and stops at the first offline failure', async () => {
  const sent = [];
  const refused = [];
  const queue = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }];
  await replayOldestFirst(
    queue,
    async (x) => {
      sent.push(x.id);
      if (x.id === 'q2') throw { status: 400 };
      if (x.id === 'q3') throw { status: 0 };
      return { id: x.id };
    },
    {
      isOffline: (err) => !err.status,
      onSent: () => {},
      onRefused: (x) => refused.push(x.id),
    }
  );
  assert.deepEqual(sent, ['q1', 'q2', 'q3'], 'q4 never overtakes the q3 that could not go');
  assert.deepEqual(refused, ['q2'], 'a refusal is dropped and the run goes on');
});

await test('offline replay is sequential: each send waits for the one before', async () => {
  let inFlight = 0;
  let max = 0;
  const order = [];
  await replayOldestFirst(
    [1, 2, 3],
    async (x) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 4 - x));
      inFlight--;
      return x;
    },
    { isOffline: () => true, onSent: (x) => order.push(x), onRefused: () => {} }
  );
  assert.equal(max, 1);
  assert.deepEqual(order, [1, 2, 3]);
});

// ---- 3. food: backdated summary guard + week generation ----

await test("a backdated summary must not overwrite today's card", () => {
  assert.equal(summaryIsForToday({ date: '2026-10-10' }, '2026-10-10'), true);
  assert.equal(summaryIsForToday({ date: '2026-10-08' }, '2026-10-10'), false);
  assert.equal(summaryIsForToday({}, '2026-10-10'), true, 'undated: today');
  assert.equal(summaryIsForToday(null, '2026-10-10'), true);
});

await test('invalidating the week drops only the half that changed', () => {
  const s = () => ({ dietCheck: {}, foodWeek: {}, waterWeek: {} });
  const f = s();
  applyWeekInvalidation(f, 'food', '2026-10-10');
  assert.deepEqual([f.dietCheck, f.foodWeek, !!f.waterWeek], [null, null, true]);
  const w = s();
  applyWeekInvalidation(w, 'water', '2026-10-10');
  assert.deepEqual([w.dietCheck, !!w.foodWeek, w.waterWeek], [null, true, null]);
  const b = s();
  applyWeekInvalidation(b, undefined, '2026-10-10');
  assert.deepEqual([b.foodWeek, b.waterWeek], [null, null]);
});

await test("a water write keeps today's trends row in step; a food write leaves it", () => {
  const row = { waterMl: 0, waterGoalMl: 0 };
  const st = { trends: { byDate: { '2026-10-10': row } }, water: { consumedMl: 750, goalMl: 2000 } };
  applyWeekInvalidation(st, 'food', '2026-10-10');
  assert.equal(row.waterMl, 0);
  applyWeekInvalidation(st, 'water', '2026-10-10');
  assert.deepEqual(row, { waterMl: 750, waterGoalMl: 2000 });
  applyWeekInvalidation({ water: {} }, 'water', '2026-10-10'); // no trends: no throw
});

await test('weekGen: an answer in flight across a write is stale', async () => {
  const gen = generation();
  const g = gen.now();
  const answer = new Promise((r) => setTimeout(r, 5));
  gen.bump(); // a food entry logged while the week was loading
  await answer;
  assert.equal(gen.isStale(g), true, 'the old week must not land');
  const g2 = gen.now();
  assert.equal(gen.isStale(g2), false, 'the refetch lands');
  gen.bump();
  gen.bump();
  assert.equal(gen.isStale(g2), true);
});

// ---- 4. goal progress: only the newest save may roll back ----

await test('a stale failed save does not roll back newer progress', () => {
  const seq = latestSeq();
  const progress = {};
  // Save 1: {a:1}. Save 2 (sent before 1 answers): {a:1,b:1}.
  const prev1 = progress.g;
  const s1 = seq.start('g');
  progress.g = { ...(prev1 || {}), a: 1 };
  const prev2 = progress.g;
  const s2 = seq.start('g');
  progress.g = { ...prev2, b: 1 };
  // Save 1 fails late: superseded, ignore.
  if (seq.isLatest('g', s1)) restoreKey(progress, 'g', prev1);
  assert.deepEqual(progress.g, { a: 1, b: 1 });
  // Save 2 fails: roll back to what was there before it.
  if (seq.isLatest('g', s2)) restoreKey(progress, 'g', prev2);
  assert.deepEqual(progress.g, { a: 1 });
});

await test('goal seq is per goal, and a rollback with nothing before removes the key', () => {
  const seq = latestSeq();
  const a = seq.start('1');
  seq.start('2');
  assert.equal(seq.isLatest('1', a), true, "another goal's save does not supersede");
  const p = { 1: { x: 1 } };
  restoreKey(p, '1', undefined);
  assert.equal('1' in p, false);
});

// ---- 5. habits: double tap = one request ----

await test('togglesInFlight: a second tap while the first is in flight sends nothing', async () => {
  const inFlight = inFlightKeys();
  let requests = 0;
  async function toggle(id) {
    if (!inFlight.claim(id)) return;
    try {
      requests++;
      await new Promise((r) => setTimeout(r, 5));
    } finally {
      inFlight.delete(id);
    }
  }
  await Promise.all([toggle('h1'), toggle('h1'), toggle('h2')]);
  assert.equal(requests, 2, 'h1 once, h2 once');
  await toggle('h1');
  assert.equal(requests, 3, 'released after the answer: the next tap goes');
  assert.equal(inFlight.size, 0);
});

await test('togglesInFlight is still a Set for the has/add/delete callers', () => {
  const k = inFlightKeys();
  k.add('patch:1');
  assert.equal(k.has('patch:1'), true);
  assert.equal(k.claim('patch:1'), false);
  k.delete('patch:1');
  assert.equal(k.claim('patch:1'), true);
});

// ---- 6. gb-kit resolveNavLayout ----

const ids = NAV_CATALOG.map((i) => i.id);

await test('no saved layout is the catalog with its default split', () => {
  for (const saved of [null, undefined, [], 'junk']) {
    const out = resolveNavLayout(saved);
    assert.deepEqual(out.map((x) => x.id), ids);
    assert.deepEqual(out.map((x) => x.primary), NAV_CATALOG.map((i) => i.primary));
  }
});

await test('saved order and primary flag are kept; duplicates and unknown ids dropped', () => {
  const [a, b] = ids;
  const out = resolveNavLayout([{ id: b, primary: false }, { id: 'gone-feature' }, null, { id: b, primary: true }, { id: a }]);
  assert.deepEqual(out.slice(0, 2), [
    { id: b, primary: false },
    { id: a, primary: true },
  ]);
  assert.equal(out.filter((x) => x.id === b).length, 1);
  assert.equal(out.some((x) => x.id === 'gone-feature'), false);
  assert.equal(out.length, ids.length, 'every catalog entry exactly once');
});

await test('catalog entries the saved layout predates are appended with their default', () => {
  const out = resolveNavLayout([{ id: ids[0], primary: true }]);
  assert.deepEqual(out.map((x) => x.id), ids);
  out.slice(1).forEach((x, i) => assert.equal(x.primary, NAV_CATALOG[i + 1].primary));
});

await test('NAV_MAX_PRIMARY caps the bar; the surplus leads the "More" sheet', () => {
  assert.equal(NAV_MAX_PRIMARY, 5);
  const allPrimary = ids.map((id) => ({ id, primary: true }));
  assert.ok(resolveNavLayout(allPrimary).every((x) => x.primary), 'resolve keeps the flag; the split caps');
  const { primary, overflow } = splitNavBar(allPrimary, null);
  assert.equal(primary.length, Math.min(NAV_MAX_PRIMARY, ids.length));
  assert.deepEqual(
    [...primary, ...overflow].map((i) => i.id),
    ids,
    'nothing lost, spilled ones first in More in their saved order'
  );
});

await test('the split drops destinations whose feature is off', () => {
  const gated = NAV_CATALOG.find((i) => i.feature && !i.feature.includes('|'));
  if (!gated) return;
  const { primary, overflow } = splitNavBar(null, { [gated.feature]: false });
  assert.equal([...primary, ...overflow].some((i) => i.id === gated.id), false);
  const on = splitNavBar(null, {});
  assert.equal([...on.primary, ...on.overflow].some((i) => i.id === gated.id), true);
});

await test('a slot freed by a turned-off feature is refilled from "More"', () => {
  const gated = NAV_CATALOG.find((i) => i.primary && i.feature && !i.feature.includes('|'));
  if (!gated) return;
  const on = splitNavBar(null, {});
  const off = splitNavBar(null, { [gated.feature]: false });
  assert.equal(off.primary.length, on.primary.length, 'the bar keeps its size');
  assert.equal(off.primary.some((i) => i.id === gated.id), false);
  assert.equal(off.primary[off.primary.length - 1].id, on.overflow[0].id, 'first More item moves up');
});

await test('sameZone: an alias is the same zone, a different offset or DST rule is not', () => {
  assert.equal(sameZone('Asia/Calcutta', 'Asia/Kolkata'), true);
  assert.equal(sameZone('Europe/Kiev', 'Europe/Kyiv'), true);
  assert.equal(sameZone('America/Buenos_Aires', 'America/Argentina/Buenos_Aires'), true);
  assert.equal(sameZone('Asia/Kolkata', 'Asia/Dubai'), false);
  // Same offset in one half of the year only: London and Lisbon agree, Lagos does not.
  assert.equal(sameZone('Europe/London', 'Africa/Lagos'), false);
  assert.equal(sameZone('Not/AZone', 'Asia/Kolkata'), false);
});

await test('FN-02: sleep / mood still queued survive a load of the server logs', () => {
  const server = {
    sleepByDate: { '2026-10-09': { date: '2026-10-09', quality: 'good' } },
    moodByDate: {},
    photoHistory: [],
  };
  const ops = [
    { kind: 'wellness.sleep', local: { date: '2026-10-11', quality: 'poor' } },
    { kind: 'task.toggle', local: { id: 't1' } },
    { kind: 'wellness.mood', local: { date: '2026-10-11', mood: 'low' } },
    { kind: 'wellness.mood', local: { date: '2026-10-11', mood: 'great' } },
  ];
  const w = overlayQueuedWellness(server, ops);
  assert.equal(w.sleepByDate['2026-10-11'].quality, 'poor', 'queued night shown after the load');
  assert.equal(w.sleepByDate['2026-10-09'].quality, 'good', "the server's other nights kept");
  assert.equal(w.moodByDate['2026-10-11'].mood, 'great', 'newest queued check-in for the day wins');
  assert.deepEqual(server.moodByDate, {}, 'the server copy is not mutated');
  assert.deepEqual(overlayQueuedWellness(server, []).sleepByDate, server.sleepByDate);
});

await test('an ended session is never queued for a replay', () => {
  const ended = sessionEndedError();
  assert.equal(networkError(ended), false);
  assert.equal(offlineError(ended), false);
  assert.equal(networkError(ended, false), false, 'not even offline');
  assert.equal(networkError(new Error('Failed to fetch')), true, 'no response');
  assert.equal(networkError({ status: 503 }), false, 'a 5xx is an answer');
  assert.equal(offlineError({ status: 503 }), true, 'but the server is down');
  assert.equal(offlineError({ status: 400 }), false, 'a refusal');
  assert.equal(offlineError({ status: 400 }, false), true, 'offline');
  assert.equal(networkError(null), true);
});

await test('a write kept on the phone after a 5xx does not claim the user is offline', () => {
  assert.equal(savedLocallyMessage({ status: 500 }, true), savedLocallyMessage({ status: 503 }));
  assert.notEqual(savedLocallyMessage({ status: 500 }, true), SAVED_ON_PHONE);
  assert.match(savedLocallyMessage({ status: 500 }, true), /server had a problem/);
  assert.equal(savedLocallyMessage(new Error('Failed to fetch'), true), SAVED_ON_PHONE, 'no response');
  assert.equal(savedLocallyMessage({ status: 500 }, false), SAVED_ON_PHONE, 'device offline');
  assert.equal(savedLocallyMessage(undefined, true), SAVED_ON_PHONE);
});

await test('first-run leaves the timezone step out when the zones match', () => {
  assert.deepEqual(firstRunSteps({ hasGoal: true, accountZone: 'Europe/London', deviceZone: 'Europe/London' }), ['goal']);
  // Chrome's spelling of India against the account's: an alias, not a move.
  assert.equal(sameZone('Asia/Kolkata', 'Asia/Calcutta') || sameZone('Asia/Calcutta', 'Asia/Kolkata'), true);
  assert.deepEqual(
    firstRunSteps({ hasGoal: true, accountZone: 'Asia/Kolkata', deviceZone: new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata' }).resolvedOptions().timeZone }),
    ['goal']
  );
});

await test('first-run keeps the timezone step when the zones differ', () => {
  assert.deepEqual(firstRunSteps({ hasGoal: true, accountZone: 'UTC', deviceZone: 'Asia/Tokyo' }), ['goal', 'timezone']);
  assert.deepEqual(firstRunSteps({ hasGoal: false, accountZone: 'UTC', deviceZone: 'Asia/Tokyo' }), ['timezone']);
  // Nothing to compare: no step, and no goal chunk leaves nothing at all.
  assert.deepEqual(firstRunSteps({ hasGoal: false, accountZone: 'UTC', deviceZone: '' }), []);
  assert.deepEqual(firstRunSteps({ hasGoal: true, accountZone: '', deviceZone: 'Asia/Tokyo' }), ['goal']);
});

await test('push is asked once, at a timed save, only when it can help', () => {
  const due = { needs: true, setupOpen: false, asked: false, supported: true, subscribed: false, permission: 'default' };
  assert.equal(pushAskDue(due), true);
  assert.equal(pushAskDue({ ...due, permission: 'prompt' }), true, 'native not asked yet');
  assert.equal(pushAskDue({ ...due, needs: false }), false, 'an untimed save');
  assert.equal(pushAskDue({ ...due, setupOpen: true }), false, 'never inside first-run');
  assert.equal(pushAskDue({ ...due, asked: true }), false, 'once per account');
  assert.equal(pushAskDue({ ...due, supported: false }), false, 'no notifications here');
  assert.equal(pushAskDue({ ...due, subscribed: true }), false, 'already on');
  assert.equal(pushAskDue({ ...due, permission: 'denied' }), false, 'already refused');
});

await test('a backdated entry is filed at noon of that day in the account zone', () => {
  // A phone in LA, an account in Kolkata: the device's noon on the 3rd is 00:30
  // on the 4th in Kolkata, so the server filed the meal under the 4th.
  assert.equal(noonIn('2026-03-03', 'Asia/Kolkata'), '2026-03-03T06:30:00.000Z');
  assert.equal(noonIn('2026-03-03', 'America/Los_Angeles'), '2026-03-03T20:00:00.000Z');
  assert.equal(noonIn('2026-07-03', 'America/Los_Angeles'), '2026-07-03T19:00:00.000Z', 'summer time');
  assert.equal(noonIn('2026-03-03', 'Pacific/Kiritimati'), '2026-03-02T22:00:00.000Z', 'UTC+14');
  // An unknown id: the device's noon, not a throw.
  assert.equal(noonIn('2026-03-03', 'Not/AZone'), new Date(2026, 2, 3, 12).toISOString());
  for (const zone of ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(noonIn('2026-11-01', zone)));
    assert.equal(day, '2026-11-01', zone);
  }
});

if (failures) {
  console.log('\n' + failures + ' failed');
  process.exit(1);
}
console.log('\nall app-logic checks passed');
