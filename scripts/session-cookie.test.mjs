/* Node check for what the session cookie may carry (SEC-09).

   `node scripts/session-cookie.test.mjs`

   Cookies are readable by any script on the page and ride on every request, so
   gb.session's cookie is a slim projection of the profile: the first render's
   fields, never the email, phone, body or token. */

import assert from 'node:assert/strict';
import { cookieValue } from './cache-storage.js';

const user = {
  id: 'u1',
  displayName: 'Asha',
  email: 'asha@example.com',
  whatsappNumber: '+919800000000',
  dob: '1990-01-01',
  heightCm: 160,
  weightKg: 60,
  gender: 'female',
  dietPreference: 'veg',
  aboutMe: 'hi',
  allergicTo: 'peanuts',
  favouriteDish: 'dosa',
  fitnessGoal: 'lose',
  ageYears: 36,
  token: 'secret-token',
  uiPrefs: { workWeek: [1, 2, 3, 4, 5], timeFormat: '24h' },
  features: { money: true },
  timezone: 'Asia/Kolkata',
  level: 3,
};

const slim = JSON.parse(cookieValue('gb.session', JSON.stringify(user)));
assert.deepEqual(slim, {
  id: 'u1',
  displayName: 'Asha',
  timezone: 'Asia/Kolkata',
  level: 3,
  features: { money: true },
  uiPrefs: { workWeek: [1, 2, 3, 4, 5], timeFormat: '24h' },
});
for (const pii of ['email', 'whatsappNumber', 'dob', 'heightCm', 'weightKg', 'token', 'allergicTo']) {
  assert.equal(pii in slim, false, pii + ' must not reach the cookie');
}
// A field nobody has allowlisted stays out by default.
assert.equal('newField' in JSON.parse(cookieValue('gb.session', JSON.stringify({ id: 'x', newField: 1 }))), false);
// Unparsable or non-object: no cookie at all, rather than the raw string.
assert.equal(cookieValue('gb.session', 'not json'), null);
assert.equal(cookieValue('gb.session', 'null'), null);
// Every other key goes to its cookie as is.
assert.equal(cookieValue('gb.token', 'abc'), 'abc');
assert.equal(cookieValue('gb.theme', 'dark'), 'dark');

console.log('session-cookie: ok');
