/* =====================================================================
   Growth Buddy — where the water card's fish and bubbles go, pure.
   The glass (styles/app.css .gb-water-glass) is 76 x 126 with a 2px border,
   so the water is drawn in a 72 x 122 box; `pct` of it is full. Every fish
   stays inside that box for its whole swim and under the waterline for its
   whole bob, at any fill. Checked by `node scripts/water-fish.test.mjs`.
   ===================================================================== */

export const GLASS_W = 72;
export const GLASS_H = 122;
const BOB = 4; // the keyframes' translateY (--fish-bob), either way
const WAVE = 6; // the surface's wave band (.gb-water-fill::before)
const MIN_SWIM = 8;

/**
 * Fish for a glass `pct` full: [{left, bottom, size, swim, bob, delay, duration, hue, lane}].
 * `left` is the body's left edge at the start of the swim, `swim` how far right it
 * goes (keyframes run 0 -> swim and back), `bottom` from the glass floor, `bob`
 * how far it drifts up or down. Shallow water keeps one small fish that swims
 * flat along the floor; a dry glass has none.
 */
export function waterFish(pct) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const depth = (p / 100) * GLASS_H;
  const count = Math.max(1, Math.min(8, Math.floor(p / 15) + 1));
  // No sky fish: a blue fish in blue water was all but invisible.
  const hues = ['sun', 'leaf', 'bloom', 'iris'];
  const out = [];
  for (let i = 0; i < count; i++) {
    const size = 10 + (i % 3) * 3;
    const tail = size * 0.25; // the fin sticks out this far, on whichever side it faces
    const low = BOB + 2;
    const high = depth - WAVE - BOB - size * 0.5; // highest bottom that keeps the fish under the wave
    const minX = 2 + tail;
    const maxX = GLASS_W - 2 - tail - size; // rightmost body left
    const span = maxX - minX;
    const swim = Math.max(MIN_SWIM, Math.round(span * (0.45 + 0.15 * (i % 3))));
    const room = Math.max(0, span - swim);
    const fish = {
      left: Math.round(minX + ((i * 11) % (room + 1))),
      bottom: 0,
      size,
      swim,
      bob: BOB,
      delay: (i % 5) * 0.55,
      duration: 5.8 + (i % 4) * 1.1,
      hue: hues[i % hues.length],
      lane: (i % 3) + 1,
    };
    if (high >= low) {
      // Spread over the depth (golden-ratio steps) rather than stacking them on one row.
      fish.bottom = Math.round(low + (high - low) * ((i * 0.618) % 1));
    } else if (i === 0 && depth >= 10) {
      // Too shallow to bob: one small fish swims flat just off the floor.
      const left = 2 + 2; // wall + its fin
      Object.assign(fish, { size: 8, bob: 0, bottom: 2, left, swim: GLASS_W - 2 - 2 - 8 - left });
    } else continue;
    out.push(fish);
  }
  return out;
}

/**
 * How far a bubble rises (px) and still pops below the surface: it starts 6px off
 * the floor and is at most 14px across once scaled. 0 = too shallow, no bubbles.
 */
export function bubbleRise(pct) {
  const depth = (Math.max(0, Math.min(100, Number(pct) || 0)) / 100) * GLASS_H;
  const rise = Math.floor(depth - WAVE - 6 - 14);
  return rise >= 12 ? rise : 0;
}
