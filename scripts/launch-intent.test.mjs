// node scripts/launch-intent.test.mjs — the manifest's shortcut and share-target URLs.
import assert from 'node:assert/strict';
import { launchIntent, SHORTCUTS, SHARE_MAX } from './launch-intent.js';

for (const id of SHORTCUTS) {
  assert.deepEqual(launchIntent('?shortcut=' + id), { shortcut: id }, id);
}
assert.equal(launchIntent('?shortcut=nope'), null, 'unknown shortcut is ignored');
assert.equal(launchIntent(''), null);
assert.equal(launchIntent('?join=ABC'), null, 'unrelated query is not a launch');

assert.deepEqual(launchIntent('?text=spent+200+on+lunch'), { share: 'spent 200 on lunch' });
assert.deepEqual(
  launchIntent('?title=Note&text=call+mom&url=https%3A%2F%2Fx.app%2Fa'),
  { share: 'Note call mom https://x.app/a' },
  'title, text and url joined in that order'
);
assert.deepEqual(
  launchIntent('?title=Article&text=Article+https%3A%2F%2Fx.app&url=https%3A%2F%2Fx.app'),
  { share: 'Article https://x.app' },
  'a part repeated inside another is kept once'
);
assert.deepEqual(launchIntent('?title=same&text=same'), { share: 'same' }, 'identical parts kept once');
assert.deepEqual(launchIntent('?text=++'), null, 'blank share is nothing');
assert.equal(launchIntent('?text=' + 'a'.repeat(900)).share.length, SHARE_MAX, 'long share is cut');

console.log('launch-intent: ok');
