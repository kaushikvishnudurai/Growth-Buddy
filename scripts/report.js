/* =====================================================================
   Growth Buddy — Report screen
   A per-feature progress overview. When a feature is turned off in
   settings, its report section is replaced with a prompt to turn it
   back on (so the data the report needs can start being collected).
   ===================================================================== */
import { h, Card, SectionTitle, Icon } from './gb-kit.js';
import { WeeklyReflectionCard, BadgeCard, GoalTimelineCard } from './dashboard.js';
import { buildInsights, insightProgress } from './insights.js';
import {
  localKey,
  pixelValues,
  personalRecords,
  periodDelta,
  monthReview,
  weeklyBuckets,
  monthTicks,
  correlate,
  correlationWords,
  focusMinutesByDay,
  weekOverWeek,
} from './review.js';
// The Compare card reads the same daily series the insight cards do.
import { signals } from './insights.js';
import { shareStoryCard } from './share-card.js';
import { toast } from './toast.js';

/** Patterns across the user's logged signals, plus habits, tasks, goals, focus and money.
    `loading`: the history fetch is still out, so an empty list is not yet "nothing found".
    `onAction(action, card)`: a card's `action` ({label, kind, params}, insights.js) is
    drawn as a button only when app.js handles that kind — insights.js stays data. */
function insightsSection(data, { loading, onDismiss, onAction } = {}) {
  const insights = buildInsights(data);
  let body;
  if (insights.length) {
    body = Card({
      children: insights.map((it) =>
        h(
          'div',
          { class: 'gb-insight-row' },
          h('span', { class: 'gb-insight-ic' }, Icon(it.icon, { size: 18, color: 'var(--brand)' })),
          h(
            'div',
            { style: { minWidth: 0 } },
            h('div', { class: 'gb-insight-title' }, it.title),
            h('div', { class: 'gb-insight-text' }, it.text),
            it.basis ? h('div', { class: 'gb-insight-basis' }, 'Based on ' + it.basis) : null,
            it.action && onAction
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-btn gb-btn--soft gb-btn--compact gb-insight-action',
                    onclick: () => onAction(it.action, it),
                  },
                  it.action.label
                )
              : null
          ),
          onDismiss && it.id
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'gb-insight-dismiss',
                  'aria-label': 'Dismiss insight: ' + it.title,
                  title: 'Dismiss',
                  onclick: () => onDismiss(it.id),
                },
                Icon('x', { size: 16, sw: 2.4 })
              )
            : null
        )
      ),
    });
  } else if (loading) {
    body = Card({
      children: [
        h(
          'div',
          { class: 'gb-insight-skel', 'aria-busy': 'true', 'aria-label': 'Looking for patterns' },
          h(
            'div',
            { class: 'gb-skel-lines' },
            h('div', { class: 'gb-skel-line', style: { width: '45%' } }),
            h('div', { class: 'gb-skel-line', style: { width: '90%' } }),
            h('div', { class: 'gb-skel-line', style: { width: '70%' } })
          )
        ),
      ],
    });
  } else {
    // How far along the first pattern is, so the empty card is a goal, not a wall.
    const p = insightProgress(data.wellness);
    body = Card({
      children: [
        h(
          'div',
          { class: 'gb-insight-empty' },
          Icon('sparkles', { size: 18, color: 'var(--fg3)' }),
          h(
            'span',
            null,
            'Log sleep and mood for a week and patterns show up here. ' +
              p.days +
              ' of ' +
              p.need +
              ' days logged.'
          )
        ),
        h(
          'div',
          {
            class: 'gb-insight-meter',
            role: 'progressbar',
            'aria-label': 'Days with sleep and mood logged',
            'aria-valuemin': '0',
            'aria-valuemax': String(p.need),
            'aria-valuenow': String(p.days),
          },
          h('div', { style: { width: Math.round((p.days / p.need) * 100) + '%' } })
        ),
      ],
    });
  }
  return h('div', { class: 'gb-dash-block' }, SectionTitle({ title: 'Insights' }), body);
}

function statTile(label, value, sub, color) {
  // A missing number reads as a dash, not "undefined%".
  const shown = value == null || Number.isNaN(value) ? '\u2014' : String(value);
  return h(
    'div',
    { class: 'gb-report-stat' },
    h('div', { class: 'gb-report-stat-value', style: color ? { color } : null }, shown),
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
// Hover or drag across it to read one day: `days[i]` is values[i]'s date key,
// `fmt` turns a value into its label.
// `opts.bucket === 'week'`: each value is a week's daily average and `days[i]`
// its Monday (the 1-year range); `opts.ticks` = [{i, label}] prints month labels under it.
function trendChart(values, color, days, fmt, title, opts = {}) {
  const weekly = opts.bucket === 'week';
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

  // The picture is for the eye; a screen reader gets a one-line summary and,
  // under it, the logged days as a table (aria-hidden alone left it nothing).
  const svg = svgEl('svg', {
    viewBox: '0 0 ' + W + ' ' + H,
    class: 'gb-trend-svg',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const dayLabel = (k) =>
    new Date(k + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const lows = present.reduce((a, b) => (b.v < a.v ? b : a));
  const highs = present.reduce((a, b) => (b.v > a.v ? b : a));
  const summary =
    (title ? title + ': ' : '') +
    present.length +
    (weekly ? ' weeks logged, latest weekly average ' : ' days logged, latest ') +
    fmt(present[present.length - 1].v) +
    ', lowest ' +
    fmt(lows.v) +
    (weekly ? ' in the week of ' : ' on ') +
    dayLabel(days[lows.i]) +
    ', highest ' +
    fmt(highs.v) +
    (weekly ? ' in the week of ' : ' on ') +
    dayLabel(days[highs.i]) +
    '.';
  const table = h(
    'table',
    { class: 'gb-sr-only' },
    h('caption', null, summary),
    h(
      'tr',
      null,
      h('th', { scope: 'col' }, weekly ? 'Week of' : 'Day'),
      h('th', { scope: 'col' }, weekly ? 'Daily average' : 'Value')
    ),
    present.map((p) => h('tr', null, h('td', null, dayLabel(days[p.i])), h('td', null, fmt(p.v))))
  );
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

  // Hover readout: snaps to the nearest logged day, so a gap never reads as 0.
  const guide = svgEl('line', {
    y1: PY,
    y2: H - PY,
    stroke: color,
    'stroke-width': '1',
    visibility: 'hidden',
  });
  const dot = svgEl('circle', {
    r: '4',
    fill: color,
    stroke: 'var(--surface)',
    'stroke-width': '2',
    visibility: 'hidden',
  });
  svg.append(guide, dot);
  const tip = h('div', { class: 'gb-trend-tip', hidden: true });
  const show = (e) => {
    const box = svg.getBoundingClientRect();
    const at = ((((e.clientX - box.left) / box.width) * W - PX) / (W - 2 * PX)) * (n - 1);
    const p = present.reduce((a, b) => (Math.abs(b.i - at) < Math.abs(a.i - at) ? b : a));
    const px = x(p.i).toFixed(1);
    guide.setAttribute('x1', px);
    guide.setAttribute('x2', px);
    dot.setAttribute('cx', px);
    dot.setAttribute('cy', y(p.v).toFixed(1));
    guide.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', 'visible');
    const date = new Date(days[p.i] + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    tip.textContent = weekly
      ? 'Week of ' + dayLabel(days[p.i]) + ' · avg ' + fmt(p.v)
      : date + ' · ' + fmt(p.v);
    tip.style.left = Math.min(85, Math.max(15, (x(p.i) / W) * 100)) + '%';
    tip.hidden = false;
  };
  const hide = () => {
    guide.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  // Mouse only: a finger lifting fires pointerleave straight after pointerup,
  // so a tap read the day for one frame. A touch readout stays until the next
  // tap or until a scroll starts (pointercancel).
  svg.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hide());
  svg.addEventListener('pointercancel', hide);
  // Month labels (1-year range), placed where each month's first week sits.
  const ticks =
    opts.ticks && opts.ticks.length
      ? h(
          'div',
          { class: 'gb-trend-ticks', 'aria-hidden': 'true' },
          opts.ticks.map((t) => {
            const pct = (x(t.i) / W) * 100;
            // A label at either edge hangs inward instead of being clipped.
            const edge = pct < 8 ? ' is-start' : pct > 92 ? ' is-end' : '';
            return h('span', { class: edge.trim() || null, style: { left: pct.toFixed(1) + '%' } }, t.label);
          })
        )
      : null;
  return h('div', { class: 'gb-trend-plot' }, svg, ticks, tip, table);
}

function trendCard(title, latest, sub, values, color, days, fmt, vs, opts) {
  return Card({
    className: 'gb-trend-card',
    children: [
      h(
        'div',
        { class: 'gb-trend-head' },
        h('div', { class: 'gb-trend-title' }, title),
        h('div', { class: 'gb-trend-latest' }, latest)
      ),
      trendChart(values, color, days, fmt, title, opts),
      sub ? h('div', { class: 'gb-trend-sub' }, sub) : null,
      vs ? h('div', { class: 'gb-trend-vs is-' + vs.dir }, vs.text) : null,
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
  return h(
    'div',
    { class: 'gb-range-toggle' },
    opt(7, '7 days'),
    opt(30, '30 days'),
    opt(90, '90 days'),
    opt(365, '1 year')
  );
}

function trendsSection({ on, trends, wellness, range, onRange }) {
  const days = lastNDays(range);
  const byDate = (trends && trends.byDate) || {};
  const moodBy = (wellness && wellness.moodByDate) || {};
  const sleepBy = (wellness && wellness.sleepByDate) || {};

  // "vs last week" compares the last `range` FULL days with the `range` before
  // them. Today is left out of both: half logged, it read as a drop every morning.
  const cmp = lastNDays(range * 2 + 1);
  const prevDays = cmp.slice(0, range);
  const curDays = cmp.slice(range, range * 2);
  const seriesFrom = (pick, keys = days) => keys.map((k) => (byDate[k] ? pick(byDate[k]) : null));
  const scaleFrom = (store, field, keys = days) =>
    keys.map((k) => {
      const e = store[k];
      const num = e ? SCALE_NUM[e[field]] : null;
      return num || null;
    });
  // Average of this window against the previous one. Neutral wording: more
  // calories or less water is not "better" or "worse" for everyone.
  const vsLine = (valsFor, fmtDiff) => {
    // The year fetch holds 366 days: there is no "year before" to compare with.
    if (range > 90) return null;
    const d = periodDelta(valsFor(curDays), valsFor(prevDays));
    if (!d) return null;
    const amount = fmtDiff(Math.abs(d.diff));
    const label = range === 7 ? 'last week' : 'the ' + range + ' days before';
    if (!parseFloat(amount)) return { dir: 'flat', text: 'Same as ' + label };
    return {
      dir: d.diff > 0 ? 'up' : 'down',
      text: (d.diff > 0 ? '+' : '\u2212') + amount + ' vs ' + label,
    };
  };

  // 1 year: 365 daily points is a scribble at phone width, so the line plots
  // weekly averages with month labels. Latest / avg under the title stay daily.
  const yearly = range === 365;
  const card = (title, latest, sub, vals, color, keys, fmt, vs) => {
    if (!yearly) return trendCard(title, latest, sub, vals, color, keys, fmt, vs);
    const b = weeklyBuckets(keys, vals);
    // Every other month, counted back from this one: twelve labels collide on a phone.
    const all = monthTicks(b.keys, 3);
    const ticks = all.filter((_, j) => (all.length - 1 - j) % 2 === 0).map((t) => ({
      i: t.i,
      label: new Date(t.month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short' }),
    }));
    return trendCard(title, latest, sub, b.values, color, b.keys, fmt, vs, {
      bucket: 'week',
      ticks,
    });
  };

  const cards = [];

  // Score — always available.
  {
    const vals = seriesFrom((d) => (d.score != null ? d.score : null));
    const s = summarize(vals);
    cards.push(
      card(
        'Daily score',
        s.last != null ? Math.round(s.last) + '%' : '—',
        s.avg != null ? Math.round(s.avg) + '% avg over ' + nDays(s.count) : null,
        vals,
        'var(--brand)',
        days,
        (v) => Math.round(v) + '%',
        vsLine(
          (keys) => seriesFrom((d) => (d.score != null ? d.score : null), keys),
          (v) => Math.round(v) + ' pts'
        )
      )
    );
  }
  // Water.
  if (on('water')) {
    const vals = seriesFrom((d) => (d.waterMl != null ? d.waterMl : null));
    const s = summarize(vals);
    cards.push(
      card(
        'Water',
        s.last != null ? Math.round(s.last) + ' ml' : '—',
        s.avg != null ? Math.round(s.avg) + ' ml avg over ' + nDays(s.count) : null,
        vals,
        'var(--brand)',
        days,
        (v) => Math.round(v) + ' ml',
        vsLine(
          (keys) => seriesFrom((d) => (d.waterMl != null ? d.waterMl : null), keys),
          (v) => Math.round(v) + ' ml'
        )
      )
    );
  }
  // Calories.
  if (on('food')) {
    // 0 kcal is a day with nothing logged, as in vsLine below: plotted, it drew
    // a dive to zero and pulled the average down.
    const vals = seriesFrom((d) => Number(d.kcal) || null);
    const s = summarize(vals);
    cards.push(
      card(
        'Calories',
        s.last != null ? Math.round(s.last) + ' kcal' : '—',
        s.avg != null ? Math.round(s.avg) + ' kcal avg over ' + nDays(s.count) : null,
        vals,
        'var(--brand)',
        days,
        (v) => Math.round(v) + ' kcal',
        // 0 kcal is a day with no food logged, not a fast (same rule as Insights).
        vsLine(
          (keys) => seriesFrom((d) => Number(d.kcal) || null, keys),
          (v) => Math.round(v) + ' kcal'
        )
      )
    );
  }
  // Mood.
  {
    const vals = scaleFrom(moodBy, 'mood');
    const s = summarize(vals);
    cards.push(
      card(
        'Mood',
        s.last != null ? SCALE_LABEL[Math.round(s.last)] || '—' : '—',
        s.count ? 'from ' + s.count + ' check-in' + (s.count === 1 ? '' : 's') : null,
        vals,
        'var(--brand)',
        days,
        (v) => SCALE_LABEL[Math.round(v)],
        vsLine(
          (keys) => scaleFrom(moodBy, 'mood', keys),
          (v) => v.toFixed(1) + ' pts'
        )
      )
    );
  }
  // Sleep quality.
  {
    const vals = scaleFrom(sleepBy, 'quality');
    const s = summarize(vals);
    cards.push(
      card(
        'Sleep quality',
        s.last != null ? SCALE_LABEL[Math.round(s.last)] || '—' : '—',
        s.count ? 'from ' + s.count + ' night' + (s.count === 1 ? '' : 's') + ' logged' : null,
        vals,
        'var(--brand)',
        days,
        (v) => SCALE_LABEL[Math.round(v)],
        vsLine(
          (keys) => scaleFrom(sleepBy, 'quality', keys),
          (v) => v.toFixed(1) + ' pts'
        )
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

/* ---- This week vs last: water + food -------------------------------------
   Calendar weeks, Monday to yesterday against the whole week before (maths in
   review.js `weekOverWeek`). A visible table, so it needs no hidden twin.
   Protein shows only once a day in the store carries `proteinG`. */
const WOW_ROWS = [
  { field: 'waterMl', feature: 'water', label: 'Water', fmt: (v) => Math.round(v).toLocaleString() + ' ml' },
  { field: 'kcal', feature: 'food', label: 'Calories', fmt: (v) => Math.round(v).toLocaleString() + ' kcal' },
  { field: 'proteinG', feature: 'food', label: 'Protein', fmt: (v) => Math.round(v) + ' g' },
];

function weekRollupSection({ on, trends }) {
  const defs = WOW_ROWS.filter((d) => on(d.feature));
  if (!defs.length) return null;
  const rows = weekOverWeek(
    (trends && trends.byDate) || {},
    localKey(new Date()),
    defs.map((d) => d.field)
  );
  if (!rows.length) return null;
  const cell = (v, n, fmt) =>
    v == null
      ? h('td', null, '—')
      : h('td', null, fmt(v), h('span', { class: 'gb-wow-n' }, nDays(n)));
  const body = rows.map((r) => {
    const d = defs.find((x) => x.field === r.field);
    const change =
      r.diff == null
        ? '—'
        : Math.round(r.diff) === 0
          ? 'Same'
          : (r.diff > 0 ? '+' : '−') + d.fmt(Math.abs(r.diff));
    return h(
      'tr',
      null,
      h('th', { scope: 'row' }, d.label),
      cell(r.cur, r.curDays, d.fmt),
      cell(r.prev, r.prevDays, d.fmt),
      h('td', null, change)
    );
  });
  return h(
    'div',
    { class: 'gb-dash-block' },
    SectionTitle({ title: 'This week vs last' }),
    Card({
      className: 'gb-wow-card',
      children: [
        h(
          'table',
          { class: 'gb-wow' },
          h('caption', { class: 'gb-sr-only' }, 'Daily averages, this week against last week'),
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { scope: 'col' }, h('span', { class: 'gb-sr-only' }, 'Measure')),
              h('th', { scope: 'col' }, 'This week'),
              h('th', { scope: 'col' }, 'Last week'),
              h('th', { scope: 'col' }, 'Change')
            )
          ),
          h('tbody', null, body)
        ),
        h(
          'div',
          { class: 'gb-trend-sub' },
          'Per-day averages over the days you logged. This week runs Monday to yesterday; today counts once it is over.'
        ),
      ],
    })
  );
}

/* ---- Compare: any two daily series against each other --------------------
   A scatter of the days both were logged, Pearson r (review.js `correlate`)
   and plain words for it. A pair under 14 shared days is not offered: r on a
   handful of points is mostly noise. Today is left out (half-logged). The pick
   is module-level like `pixelMetric`: not app state, not persisted. */
const ENERGY_LABEL = { 1: 'Low', 2: 'Medium', 3: 'High' };
const STRESS_LABEL = { 1: 'Calm', 2: 'Normal', 3: 'High' };
const COMPARE_METRICS = [
  { key: 'sleepHours', label: 'Sleep hours', fmt: (v) => v.toFixed(1) + ' h' },
  { key: 'mood', label: 'Mood', fmt: (v) => SCALE_LABEL[Math.round(v)] || v.toFixed(1) },
  { key: 'energy', label: 'Energy', fmt: (v) => ENERGY_LABEL[Math.round(v)] || v.toFixed(1) },
  { key: 'stress', label: 'Stress', fmt: (v) => STRESS_LABEL[Math.round(v)] || v.toFixed(1) },
  { key: 'water', label: 'Water', feature: 'water', fmt: (v) => Math.round(v) + ' ml' },
  { key: 'kcal', label: 'Calories', feature: 'food', fmt: (v) => Math.round(v) + ' kcal' },
  { key: 'spend', label: 'Spending', feature: 'money', fmt: null }, // currency set per render
  { key: 'focus', label: 'Focus minutes', feature: 'focus', fmt: (v) => Math.round(v) + ' min' },
  { key: 'habits', label: 'Habits done', feature: 'habits', fmt: (v) => Math.round(v) + '%' },
];
let compareX = 'sleepHours';
let compareY = 'mood';

function scatterChart(res, mx, my) {
  const W = 320;
  const H = 200;
  const PL = 50;
  const PR = 10;
  const PT = 18;
  const PB = 22;
  const xsV = res.points.map((p) => p.x);
  const ysV = res.points.map((p) => p.y);
  const x0 = Math.min(...xsV);
  const x1 = Math.max(...xsV);
  const y0 = Math.min(...ysV);
  const y1 = Math.max(...ysV);
  // correlate() never returns a series that does not vary, so neither span is 0.
  const x = (v) => PL + ((v - x0) / (x1 - x0)) * (W - PL - PR);
  const y = (v) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB);
  const svg = svgEl('svg', {
    viewBox: '0 0 ' + W + ' ' + H,
    class: 'gb-trend-svg gb-scatter-svg',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const text = (s, at) => {
    const t = svgEl('text', { class: 'gb-scatter-tick', ...at });
    t.textContent = s;
    return t;
  };
  svg.append(
    svgEl('line', { x1: PL, y1: H - PB, x2: W - PR, y2: H - PB, class: 'gb-scatter-axis' }),
    svgEl('line', { x1: PL, y1: PT, x2: PL, y2: H - PB, class: 'gb-scatter-axis' }),
    text(mx.fmt(x0), { x: PL, y: H - 6, 'text-anchor': 'start' }),
    text(mx.fmt(x1), { x: W - PR, y: H - 6, 'text-anchor': 'end' }),
    text(mx.label + ' →', { x: (PL + W - PR) / 2, y: H - 6, 'text-anchor': 'middle' }),
    text(my.fmt(y0), { x: PL - 6, y: H - PB, 'text-anchor': 'end' }),
    text(my.fmt(y1), { x: PL - 6, y: PT + 4, 'text-anchor': 'end' }),
    text('↑ ' + my.label, { x: PL, y: PT - 8, 'text-anchor': 'start' })
  );
  // Overlapping days (ordinal check-ins land on the same spot) darken where
  // they stack; the surface ring keeps neighbours apart.
  for (const p of res.points) {
    svg.appendChild(
      svgEl('circle', {
        cx: x(p.x).toFixed(1),
        cy: y(p.y).toFixed(1),
        r: '4',
        fill: 'var(--brand)',
        'fill-opacity': '0.55',
        stroke: 'var(--surface)',
        'stroke-width': '1',
      })
    );
  }
  const dot = svgEl('circle', {
    r: '5.5',
    fill: 'var(--brand)',
    stroke: 'var(--surface)',
    'stroke-width': '2',
    visibility: 'hidden',
  });
  svg.appendChild(dot);
  const tip = h('div', { class: 'gb-trend-tip', hidden: true });
  const dayLabel = (k) =>
    new Date(k + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const show = (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const py = ((e.clientY - box.top) / box.height) * H;
    const p = res.points.reduce((a, b) =>
      (x(b.x) - px) ** 2 + (y(b.y) - py) ** 2 < (x(a.x) - px) ** 2 + (y(a.y) - py) ** 2 ? b : a
    );
    dot.setAttribute('cx', x(p.x).toFixed(1));
    dot.setAttribute('cy', y(p.y).toFixed(1));
    dot.setAttribute('visibility', 'visible');
    tip.textContent = dayLabel(p.key) + ' · ' + mx.fmt(p.x) + ' · ' + my.fmt(p.y);
    tip.style.left = Math.min(80, Math.max(20, (x(p.x) / W) * 100)) + '%';
    tip.style.top = ((y(p.y) - 8) / H) * 100 + '%';
    tip.hidden = false;
  };
  const hide = () => {
    dot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hide());
  svg.addEventListener('pointercancel', hide);
  // As trendChart: the picture is for the eye, the days go to a screen reader.
  const table = h(
    'table',
    { class: 'gb-sr-only' },
    h('caption', null, mx.label + ' against ' + my.label.toLowerCase() + ', one row per day'),
    h(
      'tr',
      null,
      h('th', { scope: 'col' }, 'Day'),
      h('th', { scope: 'col' }, mx.label),
      h('th', { scope: 'col' }, my.label)
    ),
    res.points.map((p) =>
      h('tr', null, h('td', null, dayLabel(p.key)), h('td', null, mx.fmt(p.x)), h('td', null, my.fmt(p.y)))
    )
  );
  return h('div', { class: 'gb-trend-plot' }, svg, tip, table);
}

function compareSection({ on, trends, wellness, money, insightHistory }) {
  const today = localKey(new Date());
  const cur = (money && money.settings && money.settings.currency) || '';
  const sig = signals({ wellness, trends, money });
  const pos = (s) => {
    const out = {};
    for (const k in s || {}) if (s[k] > 0) out[k] = s[k];
    return out;
  };
  const share = pixelValues('habits', {
    habitHistory: insightHistory && insightHistory.habits,
    today,
  });
  const series = {
    sleepHours: sig.sleepHours,
    mood: sig.mood,
    energy: sig.energy,
    stress: sig.stress,
    water: pos(sig.water), // the snapshot writes 0 on a day nothing was logged
    kcal: sig.kcal,
    spend: sig.spend,
    focus: focusMinutesByDay(insightHistory && insightHistory.focus),
    habits: Object.fromEntries(Object.entries(share).map(([k, v]) => [k, v * 100])),
  };
  const metrics = COMPARE_METRICS.filter((m) => !m.feature || on(m.feature)).map((m) =>
    m.key === 'spend' ? { ...m, fmt: (v) => cur + Math.round(v).toLocaleString() } : m
  );
  const pairs = {};
  for (const a of metrics) {
    for (const b of metrics) {
      if (a.key === b.key) continue;
      const r = correlate(series[a.key], series[b.key], { min: 14, before: today });
      if (r) pairs[a.key + '|' + b.key] = r;
    }
  }
  const partners = (k) => metrics.filter((m) => pairs[k + '|' + m.key]);
  const xs = metrics.filter((m) => partners(m.key).length);

  const head = SectionTitle({ title: 'Compare' });
  if (!xs.length) {
    return h(
      'div',
      { class: 'gb-dash-block' },
      head,
      Card({
        className: 'gb-trend-card',
        children: [
          h(
            'div',
            { class: 'gb-trend-empty' },
            'Once two things (say sleep and mood) are logged on the same 14 days, you can see how they move together here.'
          ),
        ],
      })
    );
  }

  const slot = h('div');
  const paint = () => {
    if (!xs.some((m) => m.key === compareX)) compareX = xs[0].key;
    const ys = partners(compareX);
    if (!ys.some((m) => m.key === compareY)) compareY = ys[0].key;
    const mx = metrics.find((m) => m.key === compareX);
    const my = metrics.find((m) => m.key === compareY);
    const res = pairs[compareX + '|' + compareY];
    const words = correlationWords(res.r);
    const select = (id, label, opts, value, set) =>
      h(
        'label',
        { class: 'gb-compare-field', for: id },
        h('span', null, label),
        h(
          'select',
          {
            id,
            class: 'gb-input',
            onchange: (e) => {
              set(e.target.value);
              paint();
              const again = document.getElementById(id);
              if (again) again.focus();
            },
          },
          opts.map((m) => h('option', { value: m.key, selected: m.key === value }, m.label))
        )
      );
    const rText = 'r = ' + (res.r < 0 ? '−' : '') + Math.abs(res.r).toFixed(2);
    slot.replaceChildren(
      h(
        'div',
        { class: 'gb-compare-pick' },
        select('gb-compare-x', 'Compare', xs, compareX, (v) => (compareX = v)),
        select('gb-compare-y', 'with', ys, compareY, (v) => (compareY = v))
      ),
      scatterChart(res, mx, my),
      h(
        'div',
        { class: 'gb-compare-result', 'aria-live': 'polite' },
        h('span', { class: 'gb-compare-r' }, rText),
        h('span', { class: 'gb-trend-sub' }, ' · ' + nDays(res.n) + ' with both logged'),
        h('div', { class: 'gb-compare-words' }, words.text + '.')
      ),
      h(
        'div',
        { class: 'gb-trend-sub' },
        'An association, not a cause: something else (a busy week, being unwell) can move both.'
      )
    );
  };
  paint();
  return h(
    'div',
    { class: 'gb-dash-block' },
    head,
    Card({ className: 'gb-trend-card gb-compare-card', children: [slot] })
  );
}

/* ---- Year in pixels ------------------------------------------------------
   A row per month for the last 12 (oldest on top), a column per day of the
   month, shade is the day's value, blank is a day with nothing logged. It was
   53 week-columns, GitHub-style: ~5px dots on a phone with no month or date on
   any of them, so "how was March" meant counting columns. Tapping a day reads
   it out under the grid (a title tooltip never shows on touch).
   The metric toggle repaints the grid in place; it is not app state. */
const PIXEL_METRICS = [
  { key: 'score', label: 'Score', low: 'Less', high: 'More' },
  { key: 'mood', label: 'Mood', low: 'Low', high: 'Great' },
  { key: 'habits', label: 'Habits', low: 'None', high: 'All' },
];
let pixelMetric = 'score';

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function nearestDay(grid, e) {
  let best = null;
  let bestD = Infinity;
  for (const c of grid.querySelectorAll('[data-day]')) {
    const r = c.getBoundingClientRect();
    const d = Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  // Not a tap on the month labels or far outside the cells.
  return best && bestD < 12 ? best : null;
}

function pixelGrid(values, today, readout) {
  const [ty, tm] = today.split('-').map(Number);
  const rows = [];
  const summary = { logged: 0, sum: 0 };
  // Header: day numbers at 1, 10, 20, 30 over their columns.
  rows.push(h('span', { class: 'gb-pixels-corner' }));
  for (let d = 1; d <= 31; d++) {
    rows.push(h('span', { class: 'gb-pixels-day' }, d === 1 || d % 10 === 0 ? String(d) : ''));
  }
  for (let i = 11; i >= 0; i--) {
    const first = new Date(ty, tm - 1 - i, 1);
    const y = first.getFullYear();
    const m = first.getMonth();
    const len = new Date(y, m + 1, 0).getDate();
    rows.push(h('span', { class: 'gb-pixels-month' }, MONTH_SHORT[m]));
    for (let d = 1; d <= 31; d++) {
      if (d > len) {
        rows.push(h('span', { class: 'gb-pixel is-void' }));
        continue;
      }
      const k = y + '-' + pad2(m + 1) + '-' + pad2(d);
      if (k > today) {
        rows.push(h('span', { class: 'gb-pixel is-future' }));
        continue;
      }
      const v = values[k];
      if (v != null) {
        summary.logged++;
        summary.sum += v;
      }
      const lv = v == null ? 0 : Math.max(1, Math.ceil(v * 4));
      rows.push(
        h('span', {
          class: 'gb-pixel lv-' + lv + (k === today ? ' is-today' : ''),
          'data-day': k,
        })
      );
    }
  }
  const avg = summary.logged ? Math.round((summary.sum / summary.logged) * 100) : 0;
  const total = summary.logged
    ? summary.logged + ' days logged · average ' + avg + '%'
    : 'Nothing logged in the last year yet';
  readout.textContent = total;

  let picked = null;
  // A tap on the picked day again goes back to the year's summary.
  const pick = (cell) => {
    if (picked) picked.classList.remove('is-picked');
    if (!cell || cell === picked) {
      picked = null;
      readout.textContent = total;
      return;
    }
    picked = cell;
    cell.classList.add('is-picked');
    const k = cell.dataset.day;
    const v = values[k];
    const date = new Date(k + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    readout.textContent =
      date +
      ' · ' +
      (k === today ? 'today, still counting' : v == null ? 'nothing logged' : Math.round(v * 100) + '%');
  };
  // Rows are a month label + 31 cells, so a column step is 32 children.
  const STEP = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -32, ArrowDown: 32 };
  const grid = h(
    'div',
    {
      class: 'gb-pixels',
      // Not an img: it takes a pick. The readout is aria-live, so a keyboard
      // pick is announced the same way a tap's is shown.
      role: 'group',
      tabindex: '0',
      'aria-label': total + '. Arrow keys pick a day, Home and End jump to the first and last.',
      // One listener for ~370 cells.
      onclick: (e) => {
        // Cells are ~6px on a small phone, so a tap often lands in a gap: take
        // the nearest day to the finger rather than clearing the readout.
        pick(e.target.closest('[data-day]') || nearestDay(e.currentTarget, e));
      },
      onkeydown: (e) => {
        if (e.key === 'Escape' && picked) {
          e.preventDefault();
          pick(picked);
          return;
        }
        const days = e.currentTarget.querySelectorAll('[data-day]');
        if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          const end = e.key === 'Home' ? days[0] : days[days.length - 1];
          // pick() on the picked cell clears it; Home on the first day stays put.
          if (end && end !== picked) pick(end);
          return;
        }
        const step = STEP[e.key];
        if (!step) return;
        e.preventDefault();
        const kids = Array.from(e.currentTarget.children);
        // Nothing picked yet: start on today, the last cell that has a day.
        if (!picked) return pick(days[days.length - 1] || null);
        let i = kids.indexOf(picked) + step;
        // Left/right walk days across month ends; up/down only land on a real day.
        if (Math.abs(step) === 1) while (kids[i] && !kids[i].dataset.day) i += step;
        if (kids[i] && kids[i].dataset.day) pick(kids[i]);
      },
    },
    rows
  );
  return grid;
}

function pixelsSection({ trends, wellness, insightHistory }) {
  const today = localKey(new Date());
  const habitHistory = insightHistory && insightHistory.habits;
  const slot = h('div');
  const toggle = h('div', { class: 'gb-range-toggle' });
  const readout = h('span', { class: 'gb-pixels-readout', 'aria-live': 'polite' });
  const key = h('div', { class: 'gb-pixels-legend' });
  const paint = () => {
    const metric = PIXEL_METRICS.find((m) => m.key === pixelMetric);
    toggle.replaceChildren(
      ...PIXEL_METRICS.map((m) =>
        h(
          'button',
          {
            type: 'button',
            class: 'gb-range-opt' + (pixelMetric === m.key ? ' is-active' : ''),
            'aria-pressed': String(pixelMetric === m.key),
            onclick: () => {
              pixelMetric = m.key;
              paint();
            },
          },
          m.label
        )
      )
    );
    slot.replaceChildren(
      pixelGrid(pixelValues(pixelMetric, { trends, wellness, habitHistory, today }), today, readout)
    );
    key.replaceChildren(
      metric.low,
      ...[1, 2, 3, 4].map((lv) => h('span', { class: 'gb-pixel lv-' + lv })),
      metric.high
    );
  };
  paint();
  return h(
    'div',
    { class: 'gb-dash-block' },
    h('div', { class: 'gb-trend-section-head' }, SectionTitle({ title: 'Year in pixels' }), toggle),
    Card({
      className: 'gb-pixels-card',
      children: [slot, h('div', { class: 'gb-pixels-key' }, readout, key)],
    })
  );
}

/* Boot holds 60 days of daily logs; Report fetches the year (`insightHistory.year`,
   same shape as /api/daily-logs) after first paint. Use it once it lands. */
function yearOf(trends, wellness, insightHistory) {
  const y = insightHistory && insightHistory.year;
  if (!y) return { trends, wellness };
  // The live stores win a shared day: they hold today's edits, the year fetch
  // is whatever the server had when Report opened.
  const w = wellness || {};
  return {
    trends: { byDate: { ...(y.byDate || {}), ...((trends && trends.byDate) || {}) } },
    wellness: {
      ...w,
      sleepByDate: { ...(y.sleepByDate || {}), ...(w.sleepByDate || {}) },
      moodByDate: { ...(y.moodByDate || {}), ...(w.moodByDate || {}) },
    },
  };
}

/** This month's YYYY-MM, or last month's on the 1st to 3rd (this one is too new to share). */
function reviewMonth(now = new Date()) {
  if (now.getDate() > 3) return null;
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}

/* ---- Personal records + month in review ---------------------------------- */
function recordsSection({ habits, trends, wellness, money, insightHistory }) {
  const cur = (money && money.settings && money.settings.currency) || '';
  // Lakh grouping (1,00,000) is right for rupees only; anything else groups the
  // device's way.
  const loc = !cur || cur === '\u20b9' || /^(rs|inr)/i.test(cur) ? 'en-IN' : undefined;
  const records = personalRecords({
    habits,
    trends,
    money,
    focus: insightHistory && insightHistory.focus,
    fmtMoney: (v) => cur + Math.round(v).toLocaleString(loc),
  });
  const past = reviewMonth();
  const card =
    (past && monthReview({ trends, wellness, habits, history: insightHistory, month: past })) ||
    monthReview({ trends, wellness, habits, history: insightHistory });
  if (!records.length && !card) return null;
  const share = async () => {
    try {
      const res = await shareStoryCard(card, {
        filename: 'growth-buddy-month.png',
        title: card.eyebrow,
      });
      if (res === 'saved') toast.success('Image saved. Add it to your story.');
      if (res === 'unsupported') toast.error(null, 'Could not draw the card here.');
    } catch (err) {
      toast.error(err, 'Could not draw the card here.');
    }
  };
  return h(
    'div',
    { class: 'gb-dash-block' },
    h(
      'div',
      { class: 'gb-trend-section-head' },
      SectionTitle({ title: 'Personal records' }),
      card
        ? h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: share },
            Icon('share-2', { size: 14, sw: 2.4 }),
            past && card.month === past ? 'Share last month' : 'Share my month'
          )
        : null
    ),
    records.length
      ? Card({
          className: 'gb-records',
          children: records.map((r) => statTile(r.label, r.value, r.sub)),
        })
      : null
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
  goalProgress,
  insightHistory,
  insightLoading,
  dismissedInsights,
  onDismissInsight,
  onInsightAction,
  range,
  onRange,
  onEnableFeature,
}) {
  const on = (k) => !features || features[k] !== false;
  const t = tasks || [];
  const hb = habits || [];
  const flatGoals = (goals || []).flatMap((s) => s.goals || []);

  // Paused tasks are out of the score, so out of the Tasks tile beside it too.
  const scored = t.filter((x) => !x.paused);
  const tasksDone = scored.filter((x) => x.done).length;
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
          statTile('Score', Number.isFinite(score) ? Math.round(score) + '%' : null, null, 'var(--brand)'),
          statTile('Tasks', tasksDone + '/' + scored.length, 'done today'),
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
    // The year of logs once it lands: sixty days is thin for a weekday pattern.
    insightsSection(
      {
        ...yearOf(trends, wellness, insightHistory),
        money,
        habits: hb,
        tasks: t,
        goals: flatGoals,
        goalProgress,
        history: insightHistory,
        features,
        dismissed: dismissedInsights,
      },
      { loading: insightLoading, onDismiss: onDismissInsight, onAction: onInsightAction }
    ),

    // ---- Best-ever numbers + the shareable month card ----
    recordsSection({
      habits: hb,
      ...yearOf(trends, wellness, insightHistory),
      money,
      insightHistory,
    }),

    // ---- Trends drill-down (weekly / monthly line charts) ----
    trendsSection({ on, ...yearOf(trends, wellness, insightHistory), range: range || 7, onRange }),

    // ---- Water + food: this week's daily averages against last week's ----
    weekRollupSection({ on, ...yearOf(trends, wellness, insightHistory) }),

    // ---- Any two daily series against each other (scatter + r) ----
    compareSection({ on, ...yearOf(trends, wellness, insightHistory), money, insightHistory }),

    // ---- A year of days at a glance ----
    pixelsSection({ ...yearOf(trends, wellness, insightHistory), insightHistory }),

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
