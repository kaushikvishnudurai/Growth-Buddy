// node scripts/when.test.mjs: the due time read out of a task title (dates.js parseWhen).
import assert from 'node:assert/strict';
import { parseWhen } from './dates.js';

const sun = new Date(2026, 9, 11, 23, 15); // Sunday 11 Oct, 23:15
const wedAm = new Date(2026, 9, 14, 10, 0); // Wednesday 14 Oct, 10:00
const at = (r) => r && [r.at.getDate(), r.at.getHours(), r.at.getMinutes()];

let r = parseWhen('Call plumber tomorrow 5pm', sun);
assert.equal(r.rest, 'Call plumber');
assert.equal(r.phrase, 'tomorrow 5pm');
assert.deepEqual(at(r), [12, 17, 0]);

assert.equal(parseWhen('Buy milk', sun), null, 'no when words, no due');
assert.equal(parseWhen('tomorrow', sun), null, 'a title that is only a date stays a title');

assert.deepEqual(at(parseWhen('Pay rent on friday', wedAm)), [16, 18, 0], 'a day alone is due 18:00');
assert.equal(parseWhen('Pay rent on friday', wedAm).rest, 'Pay rent');
assert.deepEqual(at(parseWhen('standup wednesday 9:30', wedAm)), [14, 9, 30], 'this week, even if gone');
assert.deepEqual(at(parseWhen('review next wednesday', wedAm)), [21, 18, 0], 'next = a week on');
assert.deepEqual(at(parseWhen('Submit form by 17:30', wedAm)), [14, 17, 30]);
assert.equal(parseWhen('Submit form by 17:30', wedAm).rest, 'Submit form');
assert.deepEqual(at(parseWhen('gym at 9am', wedAm)), [15, 9, 0], 'a time gone today is tomorrow');
assert.deepEqual(at(parseWhen('call mom at 5', wedAm)), [14, 17, 0], 'bare 5 is the afternoon');
assert.deepEqual(at(parseWhen('call mom at 9', wedAm)), [15, 9, 0]);
assert.deepEqual(at(parseWhen('water plants tonight', wedAm)), [14, 20, 0]);
assert.deepEqual(at(parseWhen('stretch in 2 hours', wedAm)), [14, 12, 0]);
assert.deepEqual(at(parseWhen('email Ravi in 20 min', wedAm)), [14, 10, 20]);
assert.deepEqual(at(parseWhen('book cab tomorrow morning', wedAm)), [15, 9, 0]);
assert.deepEqual(at(parseWhen('file taxes today', sun)), [11, 23, 59], 'today, said late: end of today');
assert.deepEqual(at(parseWhen('12pm lunch with Asha', wedAm)), [14, 12, 0]);
assert.deepEqual(at(parseWhen('12am backup', wedAm)), [15, 0, 0]);

console.log('when: all assertions passed');
