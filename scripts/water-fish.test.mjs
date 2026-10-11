// node scripts/water-fish.test.mjs — every fish stays in the glass and under the water.
import assert from 'node:assert/strict';
import { waterFish, fishStart, bubbleRise, GLASS_W, GLASS_H, GLASS_R } from './water-fish.js';

// Inside the water's rounded rect (72 x 122, 22px corners), y up from the floor.
const inGlass = (x, y) => {
  const cx = Math.min(Math.max(x, GLASS_R), GLASS_W - GLASS_R);
  const cy = Math.min(Math.max(y, GLASS_R), GLASS_H - GLASS_R);
  return x >= 0 && x <= GLASS_W && y >= 0 && y <= GLASS_H && Math.hypot(x - cx, y - cy) <= GLASS_R + 1e-9;
};

for (let pct = 0; pct <= 100; pct++) {
  const depth = (pct / 100) * GLASS_H;
  const fish = waterFish(pct);
  for (const f of fish) {
    const tail = f.size * 0.25;
    assert.ok(f.swim >= 8, `pct ${pct}: fish barely moves`);
    // The box the fish sweeps (whole swim, fin either side, whole bob): every
    // corner inside the rounded glass, so the corners never clip it.
    const x0 = f.left - tail;
    const x1 = f.left + f.swim + f.size + tail;
    const y0 = f.bottom - f.bob;
    const y1 = f.bottom + f.bob + f.size * 0.5;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      assert.ok(inGlass(x, y), `pct ${pct}: fish corner (${x}, ${y}) outside the rounded glass`);
    }
    assert.ok(y1 <= depth, `pct ${pct}: fish leaves the water`);
  }
  // No two fish start on top of each other.
  for (let i = 0; i < fish.length; i++)
    for (let j = i + 1; j < fish.length; j++) {
      const a = fishStart(fish[i]);
      const b = fishStart(fish[j]);
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `pct ${pct}: fish ${i} and ${j} start on top of each other`);
    }
  if (bubbleRise(pct)) assert.ok(6 + bubbleRise(pct) + 14 <= depth, `pct ${pct}: bubble rises out of the water`);
}
assert.equal(waterFish(0).length, 0, 'an empty glass has no fish on its dry floor');
assert.equal(waterFish(10).length, 1, 'shallow water keeps one fish');
assert.equal(waterFish(10)[0].bob, 0, 'and it swims flat');
assert.ok(waterFish(10)[0].left > 10, 'clear of the rounded corner');
assert.equal(bubbleRise(0), 0);
assert.equal(waterFish(30).length, 3, 'a third full glass shows all three fish');
assert.equal(waterFish(100).length, 7);
assert.deepEqual(
  waterFish(100).map((f) => f.face).slice(0, 2),
  [-1, 1],
  'reduced-motion facing alternates'
);
console.log('water-fish ok');
