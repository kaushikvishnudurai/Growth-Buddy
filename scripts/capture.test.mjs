// node scripts/capture.test.mjs
// Money's automatic capture, phone side: what POST /api/capture is sent for a
// message (capture.js toItem: fields only, never the text), and how a typed
// quick add finds the captured row it is about (money-core matchCaptured /
// claimCaptured / capturedToReview). The server's dedup is CaptureDedupTest.
import assert from 'node:assert/strict';
import { toItem, messageHash } from './capture.js';
import { matchCaptured, claimCaptured, capturedToReview, emptyMoney } from './money-core.js';

const SMS =
  'Sent Rs.250.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 20/10/26\nRef 629312345678\nNot You?';

// toItem: the fields, the hash, the tag; no text anywhere in the payload.
{
  const money = emptyMoney();
  const it = await toItem({ via: 'sms', origin: 'sms', text: SMS, at: 1760950000000 }, money);
  assert.equal(it.kind, 'debit');
  assert.equal(it.amount, 250);
  assert.equal(it.merchant, 'Swiggy');
  assert.equal(it.last4, '1234');
  assert.equal(it.ref, '629312345678');
  assert.equal(it.at, 1760950000000);
  assert.equal(it.category, 'food', "Money's own tag guess for the payee");
  assert.match(it.msgHash, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(it).includes('Not You'), 'the message text never leaves the phone');
  // The same message with different spacing is the same message.
  assert.equal(await messageHash(SMS.replace(/\n/g, ' \n ')), it.msgHash);
  assert.equal(await toItem({ via: 'sms', text: '123456 is your OTP for Rs 500' }, money), null);
  const credit = await toItem(
    { via: 'notif', origin: 'com.phonepe.app', text: 'Received ₹300 from Priya S', at: 1 },
    money
  );
  assert.equal(credit.kind, 'credit');
  assert.equal(credit.category, undefined, 'money in carries no spending tag');
  assert.equal(credit.origin, 'com.phonepe.app');
}

// matchCaptured / claimCaptured: a quick add names the captured row once.
{
  const money = emptyMoney();
  money.expenses = [
    {
      id: 'cap-a',
      amount: 250,
      date: '2026-10-20',
      note: 'Swiggy',
      category: 'food',
      createdAt: 1,
      capture: { via: 'sms' },
    },
    {
      id: 'cap-b',
      amount: 99,
      date: '2026-10-20',
      note: 'Snack Bar',
      createdAt: 2,
      capture: { via: 'sms', review: 'dup', dupOf: 'u1' },
    },
    { id: 'u1', amount: 99, date: '2026-10-20', note: 'Snack', createdAt: 3 },
    {
      id: 'cap-c',
      amount: 250,
      date: '2026-10-19',
      note: 'Swiggy',
      createdAt: 4,
      capture: { via: 'notif' },
    },
  ];
  assert.equal(matchCaptured(money, 'expense', 250, '2026-10-20').id, 'cap-a');
  assert.equal(matchCaptured(money, 'expense', 250.004, '2026-10-20').id, 'cap-a', 'to the paisa');
  assert.equal(matchCaptured(money, 'expense', 251, '2026-10-20'), null);
  assert.equal(matchCaptured(money, 'income', 250, '2026-10-20'), null);
  assert.equal(
    matchCaptured(money, 'expense', 99, '2026-10-20').id,
    'cap-b',
    'a typed row is never the match'
  );
  const named = claimCaptured(money.expenses[1], 'Chips', { note: 'Chips' });
  assert.deepEqual(named.capture, { via: 'sms', typed: true }, 'out of review, named');
  assert.equal(named.note, 'Chips');
  money.expenses[1] = named;
  assert.equal(matchCaptured(money, 'expense', 99, '2026-10-20'), null, 'one sentence per payment');
  assert.deepEqual(
    capturedToReview(money).map((r) => r.row.id),
    [],
    'nothing left to review once named'
  );
  money.income = [
    {
      id: 'cap-i',
      amount: 5000,
      date: '2026-10-21',
      source: 'other',
      label: 'From Ravi',
      capture: { via: 'sms', review: 'transfer' },
    },
  ];
  assert.deepEqual(
    capturedToReview(money).map((r) => [r.kind, r.row.id]),
    [['income', 'cap-i']]
  );
}

console.log('capture: ok');
