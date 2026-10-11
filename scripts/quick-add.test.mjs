/* Run: node scripts/quick-add.test.mjs
   What a spoken expense books: a wrong currency or account here is a wrong
   number in Money with nothing on screen to say so. */
import assert from 'node:assert/strict';
import { quickMoney, quickCategory, defaultAccount, dayWord, intentDay, stripEmoji, capitalise } from './quick-add.js';

const money = {
  settings: { currency: '₹', fx: { $: 83 }, lastAccountId: 'card' },
  accounts: [
    { id: 'bank', kind: 'bank' },
    { id: 'cash', kind: 'cash' },
    { id: 'card', kind: 'card' },
    { id: 'old', kind: 'cash', archived: true },
  ],
};
const today = '2026-10-11';

// Home currency, no date: today, last account paid from, formatted.
{
  const q = quickMoney(money, { amount: 25000 }, 'expense', today);
  assert.equal(q.amount, 25000);
  assert.equal(q.date, today);
  assert.equal(q.accountId, 'card');
  assert.equal(q.label, '₹25,000');
  assert.equal(q.noRate, undefined);
}

// A named currency with a rate: converted, what was paid kept.
{
  const q = quickMoney(money, { amount: 12, currency: 'usd', date: '2026-10-10' }, 'expense', today);
  assert.equal(q.amount, 996);
  assert.deepEqual(q.orig, { amount: 12, currency: '$', rate: 83 });
  assert.equal(q.date, '2026-10-10');
  assert.equal(q.label, '$12 (₹996)');
}

// No rate: never silently 1:1 without saying so.
{
  const q = quickMoney(money, { amount: 12, currency: 'EUR' }, 'expense', today);
  assert.equal(q.noRate, true);
  assert.equal(q.orig, undefined);
  assert.match(q.label, /no rate set/);
}

// The home currency named explicitly is not foreign.
assert.equal(quickMoney(money, { amount: 5, currency: 'INR' }, 'expense', today).noRate, undefined);

// Accounts, by Money's own form rules.
assert.equal(defaultAccount(money, 'income'), 'bank');
assert.equal(defaultAccount({ ...money, settings: { lastAccountId: 'old' } }, 'expense'), 'cash', 'archived last account is skipped');
assert.equal(defaultAccount({ accounts: [{ id: 'w', kind: 'card' }], settings: {} }, 'income'), 'w', 'first open account');
assert.equal(defaultAccount({ settings: {} }, 'expense'), null);
assert.equal('accountId' in quickMoney({ settings: {} }, { amount: 1 }, 'expense', today), false);

// Dates.
assert.equal(intentDay({ date: 'yesterday' }, today), today, 'only a real key counts');
assert.equal(dayWord(today, today), '');
assert.equal(dayWord('2026-10-10', today), 'yesterday');
assert.equal(dayWord('2026-10-01', today), '1 Oct');

// Model text.
assert.equal(stripEmoji('Logged lunch \u{1F355} and coffee \u2615\uFE0F'), 'Logged lunch and coffee');
assert.equal(stripEmoji('family \u{1F468}\u200D\u{1F469}\u200D\u{1F467} dinner'), 'family dinner');
assert.equal(capitalise('lunch'), 'Lunch');


// The tag: the note's hint wins; no hint = the fixed default tag, else Others.
{
  assert.equal(quickCategory({ settings: { defaultTag: 'food', defaultTagSet: true } }, 'travel'), 'travel');
  assert.equal(quickCategory({ settings: { defaultTag: 'food', defaultTagSet: true } }, 'others'), 'food');
  assert.equal(quickCategory({ settings: { defaultTag: 'food', defaultTagSet: false } }, 'others'), 'others');
  assert.equal(quickCategory({ settings: { defaultTag: 'others' } }, null), 'others');
  assert.equal(quickCategory({ settings: { defaultTag: 'bills' } }, null), 'bills');
}
console.log('quick-add: ok');
