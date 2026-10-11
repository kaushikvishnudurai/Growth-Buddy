// node scripts/water-fish.test.mjs — every fish stays in the glass and under the water.
import assert from 'node:assert/strict';
import { waterFish, bubbleRise, GLASS_W, GLASS_H } from './water-fish.js';

for (let pct = 0; pct <= 100; pct++) {
  const depth = (pct / 100) * GLASS_H;
  for (const f of waterFish(pct)) {
    const tail = f.size * 0.25;
    // Horizontal: the whole swim, fin on either side, inside the glass walls.
    assert.ok(f.left - tail >= 0, `pct ${pct}: fish pokes out the left wall`);
    assert.ok(f.left + f.swim + f.size + tail <= GLASS_W, `pct ${pct}: fish swims out the right wall`);
    assert.ok(f.swim >= 8, `pct ${pct}: fish barely moves`);
    // Vertical: the whole bob, above the floor and below the surface.
    assert.ok(f.bottom - f.bob >= 0, `pct ${pct}: fish sinks through the floor`);
    assert.ok(f.bottom + f.bob + f.size * 0.5 <= depth, `pct ${pct}: fish leaves the water`);
  }
  if (bubbleRise(pct)) assert.ok(6 + bubbleRise(pct) + 14 <= depth, `pct ${pct}: bubble rises out of the water`);
}
assert.equal(waterFish(0).length, 0, 'an empty glass has no fish on its dry floor');
assert.equal(waterFish(10).length, 1, 'shallow water keeps one fish');
assert.equal(waterFish(10)[0].bob, 0, 'and it swims flat');
assert.equal(bubbleRise(0), 0);
assert.ok(waterFish(30).length >= 2, 'a third full glass has fish');
assert.equal(waterFish(100).length, 7);
assert.ok(new Set(waterFish(100).map((f) => f.left + ':' + f.bottom)).size === 7, 'no two fish share a spot');
console.log('water-fish ok');
