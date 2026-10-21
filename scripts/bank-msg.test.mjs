// node scripts/bank-msg.test.mjs
// The bank / UPI message reader (bank-msg.js) against the shared case list
// (bank-msg.cases.json), which the Java mirror (BankMessageParserTest) reads too.
// A case that fails here names itself; add new real-world shapes there, anonymised.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBankMessage } from './bank-msg.js';

const { cases } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./bank-msg.cases.json', import.meta.url)), 'utf8')
);
assert.ok(cases.length >= 30, 'the shared case file should not have shrunk');

let failed = 0;
for (const c of cases) {
  const got = parseBankMessage(c.text);
  try {
    if (c.expect === null) assert.equal(got, null);
    else {
      assert.ok(got, 'expected a transaction, got null');
      for (const [k, v] of Object.entries(c.expect)) assert.deepEqual(got[k], v, k);
    }
  } catch (e) {
    failed++;
    console.error('FAIL ' + c.name + ': ' + e.message + '\n  got ' + JSON.stringify(got));
  }
}

// Guards no case file can express.
assert.equal(parseBankMessage(''), null);
assert.equal(parseBankMessage(null), null);
assert.equal(
  parseBankMessage('x'.repeat(3000) + ' Rs 10 debited'),
  null,
  'an oversized text is refused, not scanned'
);
assert.equal(
  parseBankMessage('Rs 0.00 debited from A/c XX1234'),
  null,
  'a zero amount is no transaction'
);

if (failed) {
  console.error(failed + ' of ' + cases.length + ' cases failed');
  process.exit(1);
}
console.log('bank-msg: ' + cases.length + ' cases ok');
