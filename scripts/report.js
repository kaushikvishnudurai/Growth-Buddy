/* =====================================================================
   Growth Buddy — Report screen
   A per-feature progress overview. When a feature is turned off in
   settings, its report section is replaced with a prompt to turn it
   back on (so the data the report needs can start being collected).
   ===================================================================== */
import { h, Card, SectionTitle, Icon } from './gb-kit.js';
import { WeeklyReflectionCard, BadgeCard, GoalTimelineCard } from './dashboard.js';
import { buildInsights } from './insights.js';
import { localKey, pixelValues, personalRecords, periodDelta, monthReview } from './review.js';
import { shareStoryCard } from './share-card.js';
import { toast } from './toast.js';

/** Patterns across the user's logged signals, plus habits, tasks, goals, focus and money. */
function insightsSection(data) {
  const insights = buildInsights(data);
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
              h('span', null, 'Log sleep and mood for a week and patterns show up here.')
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
// Hover or drag across it to read one day: `days[i]` is values[i]'s date key,
// `fmt` turns a value into its label.
function trendChart(values, color, days, fmt) {
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
    tip.textContent = date + ' · ' + fmt(p.v);
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
  return h('div', { class: 'gb-trend-plot' }, svg, tip);
}

function trendCard(title, latest, sub, values, color, days, fmt, vs) {
  return Card({
    className: 'gb-trend-card',
    children: [
      h(
        'div',
        { class: 'gb-trend-head' },
        h('div', { class: 'gb-trend-title' }, title),
        h('div', { class: 'gb-trend-latest', style: { color } }, latest)
      ),
      trendChart(values, color, days, fmt),
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
  return h('div', { class: 'gb-range-toggle' }, opt(7, '7 days'), opt(30, '30 days'));
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
    const d = periodDelta(valsFor(curDays), valsFor(prevDays));
    if (!d) return null;
    const amount = fmtDiff(Math.abs(d.diff));
    const label = range === 7 ? 'last week' : 'the 30 days before';
    if (!parseFloat(amount)) return { dir: 'flat', text: 'Same as ' + label };
    return {
      dir: d.diff > 0 ? 'up' : 'down',
      text: (d.diff > 0 ? '+' : '\u2212') + amount + ' vs ' + label,
    };
  };

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
      trendCard(
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
      trendCard(
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
      trendCard(
        'Mood',
        s.last != null ? SCALE_LABEL[Math.round(s.last)] || '—' : '—',
        s.count ? 'from ' + s.count + ' check-in' + (s.count === 1 ? '' : 's') : null,
        vals,
        'var(--brand)',
        days,
        (v) => SCALE_LABEL[v],
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
      trendCard(
        'Sleep quality',
        s.last != null ? SCALE_LABEL[Math.round(s.last)] || '—' : '—',
        s.count ? 'from ' + s.count + ' night' + (s.count === 1 ? '' : 's') + ' logged' : null,
        vals,
        'var(--brand)',
        days,
        (v) => SCALE_LABEL[v],
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
  const grid = h(
    'div',
    {
      class: 'gb-pixels',
      role: 'img',
      'aria-label': total,
      // One listener for ~370 cells. A tap on the picked day again goes back
      // to the year's summary.
      onclick: (e) => {
        // Cells are ~6px on a small phone, so a tap often lands in a gap: take
        // the nearest day to the finger rather than clearing the readout.
        const cell = e.target.closest('[data-day]') || nearestDay(e.currentTarget, e);
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
          (k === today
            ? 'today, still counting'
            : v == null
              ? 'nothing logged'
              : Math.round(v * 100) + '%');
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
  return { trends: { byDate: y.byDate || {} }, wellness: { moodByDate: y.moodByDate || {} } };
}

/* ---- Personal records + month in review ---------------------------------- */
function recordsSection({ habits, trends, wellness, money, insightHistory }) {
  const cur = (money && money.settings && money.settings.currency) || '';
  const records = personalRecords({
    habits,
    trends,
    money,
    focus: insightHistory && insightHistory.focus,
    fmtMoney: (v) => cur + Math.round(v).toLocaleString('en-IN'),
  });
  const card = monthReview({ trends, wellness, habits, history: insightHistory });
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
            'Share my month'
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
    insightsSection({
      wellness,
      trends,
      money,
      habits: hb,
      tasks: t,
      goals: flatGoals,
      goalProgress,
      history: insightHistory,
    }),

    // ---- Best-ever numbers + the shareable month card ----
    recordsSection({
      habits: hb,
      ...yearOf(trends, wellness, insightHistory),
      money,
      insightHistory,
    }),

    // ---- Trends drill-down (weekly / monthly line charts) ----
    trendsSection({ on, trends, wellness, range: range || 7, onRange }),

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
