/* =====================================================================
   Growth Buddy — where the water card's fish and bubbles go, pure.
   The card only renders on the Food screen, where the glass is the beaker
   (styles/app.css `.gb-food-screen .gb-water-glass`): 84 x 160 with a 2px
   border, so the water is drawn in an 80 x 156 box whose bottom corners are
   18px (20px less the border; the top's 4px is inside that, so one radius is
   the safe bound); `pct` of it is full. Change the beaker, change these. Every fish stays inside
   that rounded box for its whole swim and under the waterline for its whole bob,
   at any fill, and in a band of its own: no two fish ever cross.
   Checked by `node scripts/water-fish.test.mjs`.
   ===================================================================== */

export const GLASS_W = 80;
export const GLASS_H = 156;
export const GLASS_R = 18;
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
 * flat along the floor; a dry glass has none. `nowMs` sets each fish's phase
 * from the clock: the card is rebuilt on every repaint, and a fixed phase sent
 * every fish back to the same spot on each tap.
 */
export function waterFish(pct, nowMs = 0) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const depth = (p / 100) * GLASS_H;
  const wanted = Math.max(1, Math.min(8, Math.floor(p / 15) + 1));
  // No sky fish: a blue fish in blue water was all but invisible.
  const hues = ['sun', 'leaf', 'bloom', 'iris'];
  const sizeOf = (i) => 10 + (i % 3) * 3;
  // Each fish owns a band (its whole bob, top fin to belly) that no other fish
  // enters, so no two ever cross. The bands run from 2px off the floor to under
  // the wave; shallow water holds fewer of them, so fewer fish.
  const bandOf = (i) => Math.ceil(2 * BOB + sizeOf(i) * 0.5); // whole px, so rows never round into each other
  const floor = 2;
  const room = depth - WAVE - floor;
  let count = wanted;
  let used = 0;
  for (let i = 0; i < wanted; i++) used += bandOf(i);
  while (count > 0 && used > room) used -= bandOf(--count);
  const gap = count ? Math.floor((room - used) / (count + 1)) : 0;
  const out = [];
  let cursor = floor;
  const rows = count || (depth >= 10 ? 1 : 0);
  for (let i = 0; i < rows; i++) {
    let size = sizeOf(i);
    let bob = BOB;
    let bottom;
    if (count) {
      cursor += gap;
      bottom = cursor + bob;
      cursor += bandOf(i);
    } else {
      // Too shallow to bob: one small fish swims flat just off the floor.
      size = 8;
      bob = 0;
      bottom = 2;
    }
    const tail = size * 0.25; // the fin sticks out this far, on whichever side it faces
    // The corners curve in hardest at the band's lowest (or highest) point.
    const inset = Math.max(wallInset(bottom - bob), wallInset(bottom + bob + size * 0.5));
    const minX = Math.ceil(inset + tail);
    const maxX = Math.floor(GLASS_W - inset - tail - size); // rightmost body left
    const span = maxX - minX;
    if (span < MIN_SWIM) continue;
    const swim = bob ? Math.max(MIN_SWIM, Math.round(span * (0.45 + 0.15 * (i % 3)))) : span; // the floor fish uses the whole floor
    const slack = span - swim;
    const duration = 5.8 + (i % 4) * 1.1;
    out.push({
      // Spread along the span (golden-ratio steps), so neighbouring rows start apart.
      left: minX + Math.round(slack * ((i * 0.618 + 0.15) % 1)),
      bottom,
      size,
      swim,
      bob,
      // Negative: each fish is already mid-swim at first paint. A positive delay
      // parked it at the keyframes' start until it began, then it snapped.
      // Phase = its own offset + the clock, so a rebuilt card carries on mid-swim.
      delay: -Math.round(((i * 0.37 + 0.2) * duration + nowMs / 1000) % duration * 100) / 100,
      duration,
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
