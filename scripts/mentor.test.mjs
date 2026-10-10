/* Run with: node scripts/mentor.test.mjs
   The chat bubble's markdown split and the on-device crisis check. */
import assert from 'node:assert/strict';
import { richParts, crisisMatch, parseSse, actionChips, streamVisible } from './mentor.js';

const shape = (s) => richParts(s).map((p) => p.type + ':' + p.text);

// --- richParts: emphasis only when the asterisks hug the words ---
assert.deepEqual(shape('2 * 3 * 4'), ['t:2 * 3 * 4'], 'arithmetic stays plain');
assert.deepEqual(shape('a * b'), ['t:a * b']);
assert.deepEqual(shape('do *one* thing'), ['t:do ', 'i:one', 't: thing']);
assert.deepEqual(shape('a *small step* now'), ['t:a ', 'i:small step', 't: now']);
assert.deepEqual(shape('**Start** here'), ['b:Start', 't: here']);
assert.deepEqual(shape('** not bold **'), ['t:** not bold **']);
assert.deepEqual(shape('*x*'), ['i:x'], 'a one-letter italic');
assert.deepEqual(shape('*line\none*'), ['t:*line\none*'], 'an italic never spans a line');
assert.deepEqual(shape(''), []);
assert.deepEqual(shape(null), []);
assert.equal(
  richParts('mix **b** and *i* and 5 * 6').map((p) => p.text).join(''),
  'mix b and i and 5 * 6',
  'nothing is lost but the markers'
);

// --- crisisMatch ---
for (const s of [
  'I want to die',
  'sometimes I think about suicide',
  'I keep hurting myself',
  "I'm thinking of ending my life",
  'self-harm again last night',
  'Everyone would be better off dead without me',
]) {
  assert.ok(crisisMatch(s), s);
}
for (const s of ['Plan my day', 'this deadline is killing me', 'I died laughing', '', null]) {
  assert.ok(!crisisMatch(s), String(s));
}


// --- parseSse: what Spring's SseEmitter writes, split across reads ---
{
  const whole = 'event:delta\ndata:{"text":"Hi"}\n\nevent:delta\ndata:{"text":" there"}\n\n';
  const r = parseSse(whole);
  assert.deepEqual(r.events.map((e) => e.event + ':' + e.data.text), ['delta:Hi', 'delta: there']);
  assert.equal(r.rest, '');
  // A chunk boundary mid-event keeps the tail for the next read.
  const a = parseSse(whole.slice(0, 40));
  assert.equal(a.events.length, 1);
  const b = parseSse(a.rest + whole.slice(40));
  assert.equal(b.events.length, 1);
  assert.equal(b.events[0].data.text, ' there');
  // "data: " with a space, CRLF, a keep-alive comment, malformed JSON skipped.
  const c = parseSse(
    ':ping\r\n\r\nevent: done\r\ndata: {"message":{"content":"ok"}}\r\n\r\nevent:delta\ndata:{oops\n\n'
  );
  assert.deepEqual(c.events, [{ event: 'done', data: { message: { content: 'ok' } } }]);
  // No event line means "message"; empty input means nothing.
  assert.equal(parseSse('data:{"a":1}\n\n').events[0].event, 'message');
  assert.deepEqual(parseSse(''), { events: [], rest: '' });
  assert.deepEqual(parseSse(null), { events: [], rest: '' });
}


// --- actionChips: the one-tap chips under a reply ---
{
  const chips = actionChips([
    { type: 'task', title: '  Walk  10 minutes ' },
    { type: 'habit', title: 'Read', time: '21:30' },
    { type: 'reminder', title: 'Call mum', time: '9:5' },
    { type: 'email', title: 'nope' },
    { type: 'task', title: '' },
    { type: 'task', title: 'walk 10 minutes' },
    null,
  ]);
  assert.deepEqual(
    chips.map((c) => [c.type, c.label, c.title, c.time]),
    [
      ['task', 'Add as task', 'Walk 10 minutes', null],
      ['habit', 'Make it a habit', 'Read', '21:30'],
      ['reminder', 'Remind me', 'Call mum', null],
    ],
    'known types only, titles tidied, repeats and bad times dropped'
  );
  assert.equal(chips[0].aria, 'Add as task: Walk 10 minutes');
  assert.equal(chips[2].icon, 'alarm-clock');
  const many = Array.from({ length: 5 }, (_, i) => ({ type: 'task', title: 't' + i }));
  assert.equal(actionChips(many).length, 3, 'at most three');
  assert.deepEqual(actionChips(null), []);
  assert.deepEqual(actionChips('x'), []);
}

// --- streamVisible: the fence never shows while a reply streams ---
const FENCE = '`'.repeat(3);
assert.equal(streamVisible('Go for a walk.\n\n' + FENCE + 'actions\n[{"type"'), 'Go for a walk.');
assert.equal(streamVisible('Go for a walk.\n`'), 'Go for a walk.\n', 'a half-arrived fence is held back');
assert.equal(streamVisible('Go for a walk.\n``'), 'Go for a walk.\n');
assert.equal(streamVisible('One small '), 'One small ', 'spaces between words survive mid-stream');
assert.equal(streamVisible(null), '');

console.log('mentor.test.mjs: all assertions passed');
