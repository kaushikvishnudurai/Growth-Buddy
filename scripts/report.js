/* =====================================================================
   Growth Buddy — Report screen
   A per-feature progress overview. When a feature is turned off in
   settings, its report section is replaced with a prompt to turn it
   back on (so the data the report needs can start being collected).
   ===================================================================== */
import { h, Card, SectionTitle, Icon } from './gb-kit.js';
import { WeeklyReflectionCard, BadgeCard, GoalTimelineCard } from './dashboard.js';
import { buildInsights } from './insights.js';

/** Correlation insights across the user's logged signals (sleep, mood, score…). */
function insightsSection({ wellness, trends, money }) {
  const insights = buildInsights({ wellness, trends, money });
  return h(
    'div',
    { class: 'gb-dash-block' },
    SectionTitle({ title: 'Insights' }),
    insights.length
      ? Card({
          children: insights.map((it) =>
            h(
              'div',
              { class: 'gb-insight-row' },
              h(
                'span',
                { class: 'gb-insight-ic' },
                Icon(it.icon, { size: 18, color: 'var(--brand)' })
              ),
              h(
                'div',
                { style: { minWidth: 0 } },
                h('div', { class: 'gb-insight-title' }, it.title),
                h('div', { class: 'gb-insight-text' }, it.text)
              )
            )
          ),
        })
      : Card({
          children: [
            h(
              'div',
              { class: 'gb-insight-empty' },
              Icon('sparkles', { size: 18, color: 'var(--fg3)' }),
              h(
                'span',
                null,
                'Log sleep and mood for a few days — patterns show up here.'
              )
            ),
          ],
        })
  );
}

function statTile(label, value, sub, color) {
  return h(
    'div',
    { class: 'gb-report-stat' },
    h('div', { class: 'gb-report-stat-value', style: color ? { color } : null }, String(value)),
    h('div', { class: 'gb-report-stat-label' }, label),
    sub ? h('div', { class: 'gb-report-stat-sub' }, sub) : null
  );
}

/** Shown in place of a section when its feature is disabled. */
function disabledCard(featureKey, title, icon, onEnableFeature) {
  return Card({
    className: 'gb-report-off',
    children: [
      h(
        'div',
        { class: 'gb-report-off-text' },
        h('span', { class: 'gb-report-off-ic' }, Icon(icon, { size: 18, color: 'var(--fg3)' })),
        h(
          'div',
          null,
          h('div', { class: 'gb-report-off-title' }, title + ' is turned off'),
          h(
            'div',
            { class: 'gb-report-off-sub' },
            'Turn it on to start tracking and see this report.'
          )
        )
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--compact',
          onclick: () => onEnableFeature && onEnableFeature(featureKey),
        },
        'Turn on'
      ),
    ],
  });
}

/* ---- Trends drill-down ---------------------------------------------------
   Small SVG line charts over a 7- or 30-day window. Data comes from the local
   `trends` history (score/water/calories) plus the date-keyed `wellness` store
   (mood/sleep). All client-side, matching the frontend-first plan. */

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) {
    if (attrs[k] != null) e.setAttribute(k, String(attrs[k]));
  }
  return e;
}

// low / okay / good / great -> 1..4 (mood, sleep quality share this scale).
const SCALE_NUM = { low: 1, poor: 1, okay: 2, good: 3, great: 4 };
const SCALE_LABEL = { 1: 'Low', 2: 'Okay', 3: 'Good', 4: 'Great' };

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}
function dayKeyOf(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
// Array of the last n calendar days (oldest first), ending today.
function lastNDays(n) {
  const out = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(dayKeyOf(d));
  }
  return out;
}

function nDays(n) {
  return n + (n === 1 ? ' day' : ' days');
}

function summarize(values) {
  const present = values.filter((v) => v != null && !Number.isNaN(v));
  if (!present.length) return { count: 0, last: null, avg: null, first: null };
  const sum = present.reduce((a, b) => a + b, 0);
  return {
    count: present.length,
    last: present[present.length - 1],
    first: present[0],
    avg: sum / present.length,
  };
}

// Build the SVG line chart (or an empty-state node) for a value series.
function trendChart(values, color) {
  const W = 320;
  const H = 72;
  const PX = 5;
  const PY = 10;
  const present = [];
  values.forEach((v, i) => {
    if (v != null && !Number.isNaN(v)) present.push({ v, i });
  });
  if (present.length < 2) {
    return h('div', { class: 'gb-trend-empty' }, 'Not enough data yet — keep logging.');
  }
  const max = Math.max(...present.map((p) => p.v));
  const min = Math.min(...present.map((p) => p.v));
  const span = max - min || 1;
  const n = values.length;
  const x = (i) => PX + (n === 1 ? 0 : (i / (n - 1)) * (W - 2 * PX));
  const y = (v) => PY + (1 - (v - min) / span) * (H - 2 * PY);

  const svg = svgEl('svg', {
    viewBox: '0 0 ' + W + ' ' + H,
    class: 'gb-trend-svg',
    role: 'img',
    'aria-hidden': 'true',
  });
  // Soft area under the line.
  const areaPts =
    'M ' +
    x(present[0].i).toFixed(1) +
    ' ' +
    (H - PY).toFixed(1) +
    ' ' +
    present.map((p) => 'L ' + x(p.i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ') +
    ' L ' +
    x(present[present.length - 1].i).toFixed(1) +
    ' ' +
    (H - PY).toFixed(1) +
    ' Z';
  svg.appendChild(svgEl('path', { d: areaPts, fill: color, 'fill-opacity': '0.12' }));
  // The line itself.
  svg.appendChild(
    svgEl('polyline', {
      points: present.map((p) => x(p.i).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' '),
      fill: 'none',
      stroke: color,
      'stroke-width': '2.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    })
  );
  // Marker on the most recent point.
  const last = present[present.length - 1];
  svg.appendChild(svgEl('circle', { cx: x(last.i), cy: y(last.v), r: '3.5', fill: color }));
  return svg;
}

function trendCard(title, latest, sub, values, color) {
  return Card({
    className: 'gb-trend-card',
    children: [
      h(
        'div',
        { class: 'gb-trend-head' },
        h('div', { class: 'gb-trend-title' }, title),
        h('div', { class: 'gb-trend-latest', style: { color } }, latest)
      ),
      trendChart(values, color),
      sub ? h('div', { class: 'gb-trend-sub' }, sub) : null,
    ],
  });
}

function rangeToggle(range, onRange) {
  const opt = (days, label) =>
    h(
      'button',
      {
        type: 'button',
        class: 'gb-range-opt' + (range === days ? ' is-active' : ''),
        'aria-pressed': range === days ? 'true' : 'false',
        onclick: () => onRange && onRange(days),
      },
      label
    );
  return h('div', { class: 'gb-range-toggle' }, opt(7, '7 days'), opt(30, '30 days'));
}

function trendsSection({ on, trends, wellness, range, onRange }) {
  const days = lastNDays(range);
  const byDate = (trends && trends.byDate) || {};
  const moodBy = (wellness && wellness.moodByDate) || {};
  const sleepBy = (wellness && wellness.sleepByDate) || {};

  const seriesFrom = (pick) => days.map((k) => (byDate[k] ? pick(byDate[k]) : null));
  const scaleFrom = (store, field) =>
    days.map((k) => {
      const e = store[k];
      const num = e ? SCALE_NUM[e[field]] : null;
      return num || null;
    });

  const cards = [];

  // Score — always available.
  {
    const vals = seriesFrom((d) => (d.score != null ? d.score : null));
    const s = summarize(vals);
    cards.push(
      trendCard(
        'Daily score',
        s.last != null ? Math.round(s.last) + '%' : '—',
        s.avg != null ? Math.round(s.avg) + '% avg over ' + nDays(s.count) : null,
        vals,
        'var(--brand)'
      )
    );
  }
  // Water.
  if (on('water')) {
    const vals = seriesFrom((d) => (d.waterMl != null ? d.waterMl : null));
    const s = summarize(vals);
    cards.push(
      trendCard(
        'Water',
        s.last != null ? Math.round(s.last) + ' ml' : '—',
        s.avg != null ? Math.round(s.avg) + ' ml avg over ' + nDays(s.count) : null,
        vals,
        'var(--brand)'
      )
    );
  }
  // Calories.
  if (on('food')) {
    const vals = seriesFrom((d) => (d.kcal != null ? d.kcal : null));
    const s = summarize(vals);
    cards.push(
      trendCard(
        'Calories',
        s.last != null ? Math.round(s.last) + ' kcal' : '—',
        s.avg != null ? Math.round(s.avg) + ' kcal avg over ' + nDays(s.count) : null,
        vals,
        'var(--brand)'
      )
    );
  }
  // Mood.
  {
    const vals = scaleFrom(moodBy, 'mood');
    const s = summarize(vals);
    cards.push(
      trendCard(
        'Mood',
        s.last != null ? SCALE_LABEL[Math.round(s.last)] || '—' : '—',
        s.count ? 'from ' + s.count + ' check-in' + (s.count === 1 ? '' : 's') : null,
        vals,
        'var(--brand)'
      )
    );
  }
  // Sleep quality.
  {
    const vals = scaleFrom(sleepBy, 'quality');
    const s = summarize(vals);
    cards.push(
      trendCard(
        'Sleep quality',
        s.last != null ? SCALE_LABEL[Math.round(s.last)] || '—' : '—',
        s.count ? 'from ' + s.count + ' night' + (s.count === 1 ? '' : 's') + ' logged' : null,
        vals,
        'var(--brand)'
      )
    );
  }

  return h(
    'div',
    { class: 'gb-dash-block' },
    h(
      'div',
      { class: 'gb-trend-section-head' },
      SectionTitle({ title: 'Trends' }),
      rangeToggle(range, onRange)
    ),
    h('div', { class: 'gb-trend-grid' }, cards)
  );
}

function section(featureKey, title, icon, enabled, onEnableFeature, contentFn) {
  return h(
    'div',
    { class: 'gb-dash-block' },
    SectionTitle({ title }),
    enabled ? contentFn() : disabledCard(featureKey, title, icon, onEnableFeature)
  );
}

function ScreenReport({
  features,
  score,
  tasks,
  habits,
  goals,
  water,
  food,
  wellness,
  trends,
  money,
  range,
  onRange,
  onEnableFeature,
}) {
  const on = (k) => !features || features[k] !== false;
  const t = tasks || [];
  const hb = habits || [];
  const flatGoals = (goals || []).flatMap((s) => s.goals || []);

  const tasksDone = t.filter((x) => x.done).length;
  const habitsDone = hb.filter((x) => x.doneToday).length;
  const topStreak = hb.reduce((m, x) => Math.max(m, x.streak || 0), 0);
  const goalsDone = flatGoals.filter((g) => g.completed).length;
  const waterMl = (water && water.consumedMl) || 0;
  const waterGoal = Math.max(1, (water && water.goalMl) || 2000);
  const waterPct = Math.min(100, Math.round((waterMl / waterGoal) * 100));
  const kcal = (food && food.totalCalories) || 0;

  return h(
    'div',
    { class: 'gb-rise gb-report' },

    // ---- Overall (always shown) ----
    h(
      'div',
      { class: 'gb-dash-block' },
      SectionTitle({ title: "Today's summary" }),
      Card({
        className: 'gb-report-grid',
        children: [
          statTile('Score', score + '%', null, 'var(--brand)'),
          statTile('Tasks', tasksDone + '/' + t.length, 'done today'),
          statTile('Habits', habitsDone + '/' + hb.length, 'done today'),
        ],
      })
    ),

    on('habits')
      ? section('habits', 'Habits', 'repeat', true, onEnableFeature, () =>
          Card({
            className: 'gb-report-grid',
            children: [
              statTile('Top streak', topStreak, 'days', 'var(--coral-600)'),
              statTile('Active', hb.length, 'habits'),
              statTile('Done today', habitsDone, 'of ' + hb.length),
            ],
          })
        )
      : section('habits', 'Habits', 'repeat', false, onEnableFeature),

    on('water')
      ? section('water', 'Water', 'droplets', true, onEnableFeature, () =>
          Card({
            className: 'gb-report-grid',
            children: [
              statTile('Today', waterMl + ' ml', 'of ' + waterGoal + ' ml', 'var(--sky-600)'),
              statTile('Goal', waterPct + '%', 'reached'),
            ],
          })
        )
      : section('water', 'Water', 'droplets', false, onEnableFeature),

    on('food')
      ? section('food', 'Food', 'utensils-crossed', true, onEnableFeature, () =>
          Card({
            className: 'gb-report-grid',
            children: [
              statTile('Calories', kcal, 'logged today', 'var(--sun-700)'),
              statTile('Entries', food && food.entries ? food.entries.length : 0, 'meals'),
            ],
          })
        )
      : section('food', 'Food', 'utensils-crossed', false, onEnableFeature),

    on('goals')
      ? section('goals', 'Goals', 'target', true, onEnableFeature, () =>
          Card({
            className: 'gb-report-grid',
            children: [
              statTile('Total', flatGoals.length, 'goals'),
              statTile('Completed', goalsDone, 'of ' + flatGoals.length, 'var(--leaf-600)'),
            ],
          })
        )
      : section('goals', 'Goals', 'target', false, onEnableFeature),

    // ---- Cross-signal correlation insights ----
    insightsSection({ wellness, trends, money }),

    // ---- Trends drill-down (weekly / monthly line charts) ----
    trendsSection({ on, trends, wellness, range: range || 7, onRange }),

    // ---- Reflection cards (moved here from the home dashboard) ----
    h(
      'div',
      { class: 'gb-dash-block' },
      WeeklyReflectionCard({ tasks, habits, food, goals, wellness })
    ),
    h('div', { class: 'gb-dash-block' }, BadgeCard({ tasks, habits, water, goals, wellness })),
    on('goals') ? h('div', { class: 'gb-dash-block' }, GoalTimelineCard({ goals })) : null
  );
}

export { ScreenReport };
