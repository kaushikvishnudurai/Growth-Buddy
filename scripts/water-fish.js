/* =====================================================================
   Growth Buddy — where the water card's fish and bubbles go, pure.
   The glass (styles/app.css .gb-water-glass) is 76 x 126 with a 2px border,
   so the water is drawn in a 72 x 122 box with 22px rounded corners (the glass's
   24px radius less the border); `pct` of it is full. Every fish stays inside
   that rounded box for its whole swim and under the waterline for its whole bob,
   at any fill, and no two start on top of each other.
   Checked by `node scripts/water-fish.test.mjs`.
   ===================================================================== */

export const GLASS_W = 72;
export const GLASS_H = 122;
export const GLASS_R = 22;
const BOB = 4; // the keyframes' translateY (--fish-bob), either way
const WAVE = 6; // the surface's wave band (.gb-water-fill::before)
const MIN_SWIM = 8;

/* How far the rounded corners pull the walls in at height y above the floor. */
export function wallInset(y) {
  const d = y < GLASS_R ? GLASS_R - y : y > GLASS_H - GLASS_R ? y - (GLASS_H - GLASS_R) : 0;
  return d > 0 ? GLASS_R - Math.sqrt(GLASS_R * GLASS_R - Math.min(d, GLASS_R) ** 2) : 0;
}

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
    let size = 10 + (i % 3) * 3;
    let bob = BOB;
    const low = BOB + 2;
    const high = depth - WAVE - BOB - size * 0.5; // highest bottom that keeps the fish under the wave
    let bottom;
    if (high >= low) {
      // One row each, evenly over the depth: golden-ratio rows landed three fish
      // within 4px of each other at 30%.
      bottom = Math.round(low + ((high - low) * (i + 0.5)) / count);
    } else if (i === 0 && depth >= 10) {
      // Too shallow to bob: one small fish swims flat just off the floor.
      size = 8;
      bob = 0;
      bottom = 2;
    } else continue;
    const tail = size * 0.25; // the fin sticks out this far, on whichever side it faces
    // The corners curve in hardest at the band's lowest (or highest) point.
    const inset = Math.max(wallInset(bottom - bob), wallInset(bottom + bob + size * 0.5));
    const minX = Math.ceil(inset + tail);
    const maxX = Math.floor(GLASS_W - inset - tail - size); // rightmost body left
    const span = maxX - minX;
    if (span < MIN_SWIM) continue;
    const swim = bob
      ? Math.max(MIN_SWIM, Math.round(span * (0.45 + 0.15 * (i % 3))))
      : span; // the floor fish uses the whole floor
    const room = span - swim;
    out.push({
      // Spread along the span (golden-ratio steps), so neighbouring rows start apart.
      left: minX + Math.round(room * ((i * 0.618 + 0.15) % 1)),
      bottom,
      size,
      swim,
      bob,
      delay: (i % 5) * 0.55,
      duration: 5.8 + (i % 4) * 1.1,
      hue: hues[i % hues.length],
      lane: (i % 3) + 1,
      face: i % 2 ? 1 : -1, // reduced motion: parked mid-swim, alternating left / right
    });
  }
  return out;
}

/* Where a fish's body is at the start of its swim (lane 2 starts at the far end). */
export function fishStart(f) {
  return { x: f.left + (f.lane === 2 ? f.swim : 0), y: f.bottom, w: f.size, h: f.size * 0.5 };
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
