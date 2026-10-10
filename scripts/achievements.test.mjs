/* Run with: node scripts/achievements.test.mjs
   The level maths and the "earned stays earned" rule of the badge gallery. */
import assert from 'node:assert/strict';
import { computeAchievements, levelProgress } from './achievements.js';

const items = (props) => computeAchievements(props).flatMap((g) => g.items);
const byId = (props) => Object.fromEntries(items(props).map((i) => [i.id, i]));

// --- levelProgress: the server's numbers win; the fallback is its curve (100 XP) ---
{
  // What AuthUserResponse sends for 250 XP.
  const server = { xpTotal: 250, level: 3, xpIntoLevel: 50, xpForNextLevel: 50, xpPerLevel: 100 };
  assert.deepEqual(levelProgress(server), { xp: 250, level: 3, into: 50, toNext: 50, pct: 50 });
  // An older cached user with no progress fields: same answer from the fallback.
  assert.deepEqual(levelProgress({ xpTotal: 250, level: 3 }), {
    xp: 250,
    level: 3,
    into: 50,
    toNext: 50,
    pct: 50,
  });
  // The old client constant was 500: 250 XP read as 50% of level 1 against the
  // server's level 3. Level is never derived from 500 again.
  assert.equal(levelProgress({ xpTotal: 250 }).level, 3);
  assert.equal(levelProgress(null).level, 1);
  assert.equal(levelProgress({ xpTotal: 0, xpIntoLevel: 0, xpForNextLevel: 100 }).pct, 0);
}

// --- level badges follow the server's level, not an XP threshold of their own ---
{
  const at = (level, xpTotal) => byId({ user: { level, xpTotal } });
  assert.equal(at(2, 199).lvl2.unlocked, false);
  assert.equal(at(3, 200).lvl2.unlocked, true, 'Reach Level 3 at the server\'s level 3');
  assert.equal(at(3, 200).lvl2.current, 3);
  assert.equal(at(7, 650).lvl5.unlocked, false);
  assert.equal(at(8, 700).lvl5.unlocked, true);
  assert.equal(at(15, 1400).lvl10.unlocked, true);
  assert.equal(at(14, 1399).lvl10.current, 14);
}

// --- an earned badge stays earned after its days slide out of the 60-day window ---
{
  const lost = byId({ trends: { byDate: {} } });
  assert.equal(lost.log7.unlocked, false);
  const kept = byId({ trends: { byDate: {} }, seen: ['log7'] });
  assert.equal(kept.log7.unlocked, true);
  assert.equal(kept.log7.current, kept.log7.target, 'shown full, not 0 / 14');
  assert.equal(kept.log3.unlocked, false, 'only the ids in seen');
  assert.equal(byId({ seen: 'nonsense' }).log7.unlocked, false);
}

console.log('achievements.test.mjs: all assertions passed');
