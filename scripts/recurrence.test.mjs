/* Run: node scripts/recurrence.test.mjs

   Guards the one shared answer to "does this reminder land on this day?".

   The cases live in recurrence.cases.json, NOT in this file, because the Java
   copy (ReminderService.occursOn, which drives WhatsApp delivery and cannot
   import JavaScript) is tested against the same list. Add a case there and both
   sides have to satisfy it — which is the only thing stopping the two
   implementations drifting apart again. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { occursOn } from './recurrence.js';

const cases = JSON.parse(
  readFileSync(fileURLToPath(new URL('./recurrence.cases.json', import.meta.url)), 'utf8')
).cases;

assert.ok(cases.length > 20, 'the shared case file should not have shrunk to nothing');

for (const c of cases) {
  const rem = { skip: [], ...c.reminder };
  assert.equal(
    occursOn(rem, c.day, c.workWeek),
    c.expect,
    `${c.why} — ${rem.repeat} anchored ${rem.date} on ${c.day}` +
      (c.workWeek ? ` (${c.workWeek})` : '')
  );
}

console.log(`recurrence.test.mjs: ${cases.length} shared cases passed`);
