/* Run with: node scripts/calendar.test.mjs
   Plain-assert self-check for isPastSlot — it decides whether a one-off reminder
   is refused and whether a row claims it will reach WhatsApp, so getting the
   boundary wrong is silently wrong in two places. */
import assert from 'node:assert/strict';
import { isPastSlot } from './calendar.js';

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const now = new Date();
const today = keyOf(now);
const yesterday = keyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
const tomorrow = keyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

// --- whole days ---
assert.equal(isPastSlot(yesterday, '23:59'), true, 'yesterday is past whatever the time');
assert.equal(isPastSlot(tomorrow, '00:00'), false, 'tomorrow is not past whatever the time');

// --- today, around the current minute ---
const minutesFromNow = (delta) => {
  const d = new Date(now.getTime() + delta * 60000);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
};
if (now.getHours() * 60 + now.getMinutes() >= 5) {
  assert.equal(isPastSlot(today, minutesFromNow(-5)), true, 'five minutes ago is past');
}
if (now.getHours() * 60 + now.getMinutes() < 24 * 60 - 5) {
  assert.equal(isPastSlot(today, minutesFromNow(5)), false, 'five minutes from now is not');
}

// --- a reminder with no time is "sometime today", which has not gone by ---
assert.equal(isPastSlot(today, ''), false);
assert.equal(isPastSlot(today, null), false);
assert.equal(isPastSlot(yesterday, ''), true, 'but an untimed day that is over has');

console.log('isPastSlot: all assertions pass');
