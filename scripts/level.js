// Its own module so the header's level ring (boot) does not pull the badge
// gallery, achievements.js (lazy), into the boot chunk.
// The server owns the level curve (ProgressService.XP_PER_LEVEL) and sends each
// user's progress through it; this is only the fallback for an older cached user.
const XP_PER_LEVEL_FALLBACK = 100;

/** Level progress, from the server's numbers when the user object carries them. */
export function levelProgress(user) {
  const u = user || {};
  const xp = Number(u.xpTotal) || 0;
  const per = Number(u.xpPerLevel) > 0 ? Number(u.xpPerLevel) : XP_PER_LEVEL_FALLBACK;
  const level = Number(u.level) || Math.max(1, 1 + Math.floor(xp / per));
  const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const into = num(u.xpIntoLevel) ?? xp % per;
  const toNext = num(u.xpForNextLevel) ?? per - into;
  const span = into + toNext || per;
  return { xp, level, into, toNext, pct: Math.round((into / span) * 100) };
}
