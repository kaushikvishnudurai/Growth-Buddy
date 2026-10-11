/* =====================================================================
   Growth Buddy — Achievements screen (lazy chunk). The badge maths is in
   achievements.js, which boot keeps for the unlock check and the XP bar.
   ===================================================================== */
import { h, Card, SectionTitle, Icon } from './gb-kit.js';
import { computeAchievements, levelProgress } from './achievements.js';

// Tier labels (shown as a small caption). Unlocked badges share one calm brand
// treatment rather than a different colour per tier, to keep the wall quiet.
const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

function badgeTile(item) {
  const children = [
    h(
      'div',
      { class: 'gb-ach-icon' },
      Icon(item.icon, {
        size: 20,
        sw: 2.2,
        color: item.unlocked ? 'var(--fg-on-brand)' : 'var(--fg3)',
      })
    ),
    h(
      'div',
      { class: 'gb-ach-body' },
      h('div', { class: 'gb-ach-title' }, item.title),
      h(
        'div',
        { class: 'gb-ach-desc' },
        item.desc,
        TIER_LABEL[item.tier]
          ? h('span', { class: 'gb-ach-tier' }, ' · ' + TIER_LABEL[item.tier])
          : null
      )
    ),
  ];
  if (item.unlocked) {
    children.push(
      h('span', { class: 'gb-ach-check', title: 'Unlocked' }, Icon('check', { size: 14, sw: 3 }))
    );
  } else {
    const pct = item.target ? Math.round((item.current / item.target) * 100) : 0;
    children.push(
      h(
        'div',
        { class: 'gb-ach-progress' },
        h(
          'div',
          {
            class: 'gb-ach-progress-bar',
            role: 'progressbar',
            'aria-valuemin': '0',
            'aria-valuemax': String(item.target),
            'aria-valuenow': String(item.current),
            'aria-label': item.title,
          },
          h('div', { class: 'gb-ach-progress-fill', style: { width: pct + '%' } })
        ),
        h('div', { class: 'gb-ach-progress-label' }, item.current + ' / ' + item.target)
      )
    );
  }
  return h(
    'div',
    {
      class: 'gb-ach-tile' + (item.unlocked ? ' is-unlocked' : ' is-locked'),
      role: 'listitem',
      'aria-label':
        item.title + ' — ' + (item.unlocked ? 'unlocked' : item.current + ' of ' + item.target),
    },
    children
  );
}

function ScreenAchievements(props) {
  const groups = computeAchievements(props);
  const all = groups.flatMap((g) => g.items);
  const unlocked = all.filter((i) => i.unlocked).length;
  const total = all.length;
  const pct = total ? Math.round((unlocked / total) * 100) : 0;
  const { xp, level, pct: xpPct } = levelProgress(props.user);

  return h(
    'div',
    { class: 'gb-rise gb-ach' },
    h(
      'div',
      { class: 'gb-dash-block' },
      Card({
        className: 'gb-ach-summary',
        children: [
          h(
            'div',
            { class: 'gb-ach-summary-top' },
            h(
              'span',
              { class: 'gb-ach-summary-ic' },
              Icon('award', { size: 22, color: 'var(--brand)' })
            ),
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(
                'div',
                { class: 'gb-ach-summary-title' },
                h('span', { class: 'gb-ach-summary-n' }, String(unlocked)),
                ' of ' + total + ' unlocked'
              ),
              h(
                'div',
                { class: 'gb-ach-summary-sub' },
                'Level ' + level + ' · ' + xp + ' XP'
              )
            )
          ),
          // The shelf: one slot per badge, in the order the sections below list
          // them, filled once earned. Replaced a % bar plus a "% earned" caption
          // (and the big "32%" beside "6 of 19 unlocked" that repeated it).
          h(
            'div',
            {
              class: 'gb-ach-shelf',
              role: 'progressbar',
              'aria-valuemin': '0',
              'aria-valuemax': String(total),
              'aria-valuenow': String(unlocked),
              'aria-valuetext': unlocked + ' of ' + total + ' badges, ' + pct + '%',
              'aria-label': 'Badges earned',
            },
            all.map((i) => h('span', { class: i.unlocked ? 'is-on' : null }))
          ),
          // XP toward the next level — a separate metric, so give it its own
          // labelled bar (previously the label sat under the badge bar, which
          // made "% to next level" look like it belonged to the badge %).
          h(
            'div',
            {
              class: 'gb-ach-summary-bar gb-ach-summary-bar--xp',
              role: 'progressbar',
              'aria-valuemin': '0',
              'aria-valuemax': '100',
              'aria-valuenow': String(xpPct),
              'aria-label': 'Progress to Level ' + (level + 1),
            },
            h('div', { class: 'gb-ach-summary-fill gb-ach-summary-fill--xp', style: { width: xpPct + '%' } })
          ),
          h('div', { class: 'gb-ach-summary-caption' }, xpPct + '% to Level ' + (level + 1)),
        ],
      })
    ),
    groups.map((group) =>
      h(
        'div',
        { class: 'gb-dash-block' },
        SectionTitle({ title: group.title }),
        h('div', { class: 'gb-ach-grid', role: 'list' }, group.items.map(badgeTile))
      )
    )
  );
}

export { ScreenAchievements };
