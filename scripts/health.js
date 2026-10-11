/* Health screen: last night's sleep on a timeline, then one tile per metric in
   HEALTH_METRICS (Activity / Heart / Body), each opening a history sheet with
   the readings behind it. Readings come from the phone (Apple Health / Health
   Connect, synced by native.js) and from the person, typed in here.

   View only: every number is built by health-logic.js, every write goes out
   through the props app.js passes, and app.js re-renders after a write, so a
   sheet just closes on success. A missing value is a muted dash, never a zero. */
import {
  h,
  Card,
  Icon,
  openModal,
  confirmDialog,
  fieldRefusal,
  focusSoon,
  formatTime,
} from './gb-kit.js';
import { fmtDate, fmtNumber } from './i18n.js';
import { toast } from './toast.js';
import {
  HEALTH_METRICS,
  HEALTH_GROUPS,
  dayValue,
  series,
  latestValue,
  lastDays,
  HEALTH_TYPES,
  mean,
  entriesFor,
  readingError,
  nights,
  durationLabel,
} from './health-logic.js';

const DASH = '—';
const BAND = 1080; // 18:00 -> 12:00, minutes
const TICKS = ['18', '21', '00', '03', '06', '09', '12'];
const NIGHTS = 14;
const RANGES = [7, 30, 90];

/* ---- formatting ------------------------------------------------------------ */

const numText = (type, v) => {
  const dp = HEALTH_METRICS[type].dp;
  return fmtNumber(v, { maximumFractionDigits: dp, minimumFractionDigits: dp });
};
/** "8,412", or "128/82" for blood pressure. '' for no value. */
const valText = (type, v, v2) =>
  v == null
    ? ''
    : numText(type, v) + (HEALTH_METRICS[type].pair && v2 != null ? '/' + numText(type, v2) : '');

const hhmm = (min) =>
  String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
/** Minutes after 18:00 back to a clock time in the user's 12/24h setting. */
const bandClock = (min) => formatTime(hhmm(Math.round(min + 18 * 60) % 1440));

function syncedText(at) {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return '';
  const min = Math.round((Date.now() - at.getTime()) / 60000);
  if (min < 1) return 'Synced just now';
  if (min < 60) return 'Synced ' + min + ' min ago';
  if (min < 1440) return 'Synced ' + Math.round(min / 60) + ' h ago';
  return 'Synced ' + fmtDate(at, 'short');
}

/* ---- SVG --------------------------------------------------------------------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) if (attrs[k] != null) el.setAttribute(k, String(attrs[k]));
  return el;
}

/** The value range a chart spans: sums from zero, readings hug their own min/max. */
function chartScale(type, pts) {
  const vs = pts.flatMap((p) => [p.value, p.value2]).filter((v) => v != null);
  if (!vs.length) return null;
  const sum = HEALTH_METRICS[type].agg === 'sum';
  let lo = sum ? 0 : Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi === lo) {
    hi += 1;
    if (!sum) lo -= 1;
  }
  return { lo, hi };
}

/* Bars for a sum metric, a broken line with dots for a latest one (two lines
   for blood pressure). Gaps stay empty. `avgs` adds dashed average lines. */
function Trace(type, pts, { w, ht, today, label, sc, avgs = [] }) {
  const svg = s('svg', {
    class: 'gb-health-trace',
    viewBox: '0 0 ' + w + ' ' + ht,
    role: 'img',
    'aria-label': label,
    focusable: 'false',
  });
  if (!sc) return svg;
  const pad = 4;
  const y = (v) => pad + (ht - 2 * pad) * (1 - (v - sc.lo) / (sc.hi - sc.lo));
  const slot = w / pts.length;
  const x = (i) => slot * (i + 0.5);

  if (HEALTH_METRICS[type].agg === 'sum') {
    const bw = Math.max(1, slot * 0.62);
    pts.forEach((p, i) => {
      if (p.value == null) return;
      const top = y(p.value);
      svg.appendChild(
        s('rect', {
          x: (x(i) - bw / 2).toFixed(2),
          y: top.toFixed(2),
          width: bw.toFixed(2),
          height: Math.max(1, ht - pad - top).toFixed(2),
          rx: Math.min(1.5, bw / 2),
          class: p.day === today ? 'is-today' : null,
        })
      );
    });
  } else {
    const dots = pts.length <= 30; // 90 dots are a smear; keep today's only
    for (const key of ['value', 'value2']) {
      if (!pts.some((p) => p[key] != null)) continue;
      let d = '';
      let open = false;
      pts.forEach((p, i) => {
        // A measurement taken every few days joins across the days between:
        // weight didn't vanish on the days nobody stepped on the scale.
        if (p[key] == null) return;
        d += (open ? 'L' : 'M') + x(i).toFixed(2) + ' ' + y(p[key]).toFixed(2);
        open = true;
      });
      svg.appendChild(
        s('path', { d, class: 'gb-health-line', 'vector-effect': 'non-scaling-stroke' })
      );
      pts.forEach((p, i) => {
        if (p[key] == null || (!dots && p.day !== today)) return;
        svg.appendChild(
          s('circle', {
            cx: x(i).toFixed(2),
            cy: y(p[key]).toFixed(2),
            r: p.day === today ? 3 : 2,
            class: p.day === today ? 'is-today' : null,
          })
        );
      });
    }
  }
  for (const a of avgs) {
    if (a == null) continue;
    const ay = y(a).toFixed(2);
    svg.appendChild(
      s('line', {
        x1: 0,
        x2: w,
        y1: ay,
        y2: ay,
        class: 'gb-health-avg',
        'vector-effect': 'non-scaling-stroke',
      })
    );
  }
  return svg;
}

/** Mean of `value` and of `value2` over the points that have one. */
const means = (pts) => [mean(pts), mean(pts.map((p) => ({ value: p.value2 })))];

function traceLabel(type, pts, days) {
  const [a, b] = means(pts);
  return a == null
    ? 'No readings in the last ' + days + ' days'
    : days + '-day average ' + valText(type, a, b) + ' ' + HEALTH_METRICS[type].unit;
}

const smallBtn = (label, onclick, icon, extra) =>
  h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--secondary gb-btn--compact', onclick, ...extra },
    icon ? Icon(icon, { size: 16 }) : null,
    label
  );

/* ---- header ------------------------------------------------------------------ */

function Header(p) {
  let src;
  let action = null;
  if (p.native) {
    const ph = p.phone || {};
    const store = ph.store || 'your health app';
    const linked = ph.available === true || !!ph.syncedAt;
    src = [
      h('strong', null, ph.store || 'Phone health data'),
      h(
        'span',
        null,
        ph.syncing
          ? 'Syncing'
          : linked
            ? syncedText(ph.syncedAt) || 'Not synced yet'
            : 'Not connected'
      ),
    ];
    if (!linked && p.onConnect) {
      action = smallBtn('Connect', p.onConnect, null, { 'aria-label': 'Connect ' + store });
    } else if (p.onSync) {
      action = smallBtn(ph.syncing ? 'Syncing' : 'Sync', p.onSync, 'refresh-cw', {
        disabled: !!ph.syncing,
        'aria-label': 'Sync with ' + store + ' now',
      });
    }
  } else {
    src = h('span', null, 'Typed in by you. The phone app adds Apple Health or Health Connect.');
  }
  return h(
    'div',
    { class: 'gb-health-top' },
    h('p', { class: 'gb-health-src' }, src),
    h(
      'div',
      { class: 'gb-health-actions' },
      action,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary gb-btn--compact',
          onclick: () => openLogForm(p, {}),
        },
        Icon('plus', { size: 16 }),
        'Log a reading'
      )
    )
  );
}

/* ---- last night -------------------------------------------------------------- */

// The big bar grows in once per page load, not again on every re-render after a save.
let grown = false;

/* The entrance: once per page load, the first render that has readings. The
   sentence counts its numbers up, the Today column draws down the ledger and
   the marks rise column by column, oldest day first, as if the two weeks were
   being replayed. CSS does the marks (under .is-entering, inside
   prefers-reduced-motion: no-preference); JS only does the count-up, and
   skips it under reduced motion. Re-renders after a save never replay it. */
let entered = false;
const calm = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {
    return true;
  }
};

/* Counts each fact's number up from zero. Space Mono's digits are all one
   width, so the sentence doesn't reflow while it counts. */
function countUp(root) {
  const facts = [...root.querySelectorAll('.gb-health-fact')].filter((b) => b._count);
  if (!facts.length) return;
  const t0 = performance.now() + 160;
  const DUR = 900;
  const step = (now) => {
    const k = Math.min(1, Math.max(0, (now - t0) / DUR));
    const e = 1 - Math.pow(1 - k, 3); // ease-out cubic
    facts.forEach((b) => (b.textContent = b._count.fmt(b._count.to * e)));
    if (k < 1) requestAnimationFrame(step);
  };
  facts.forEach((b) => (b.textContent = b._count.fmt(0)));
  requestAnimationFrame(step);
}

function LastNight(p) {
  const list = nights(p.sleepByDate, p.today, NIGHTS); // oldest first
  const last = list[list.length - 1].night;
  const known = list.map((n) => n.night).filter(Boolean);
  const avgMin = known.length ? mean(known.map((n) => ({ value: n.minutes }))) : null;
  const avgBed = known.length ? mean(known.map((n) => ({ value: n.from }))) : null;
  // A bedtime after noon (from > 1080) has no place on the band: clamp, width 0.
  const pos = (n) => {
    const from = Math.min(n.from, BAND);
    return {
      '--from': (from / BAND) * 100 + '%',
      '--len': (Math.max(0, n.to - from) / BAND) * 100 + '%',
    };
  };

  const grow = last && !grown;
  if (last) grown = true;

  const said =
    (last
      ? 'Last night ' +
        formatTime(last.bedtime) +
        ' to ' +
        formatTime(last.wakeTime) +
        ', ' +
        durationLabel(last.minutes) +
        '.'
      : 'No sleep logged for last night.') +
    (avgMin != null
      ? ' ' +
        known.length +
        '-night average ' +
        durationLabel(avgMin) +
        ', average bedtime ' +
        bandClock(avgBed) +
        '.'
      : '');

  const band = h(
    'div',
    { class: 'gb-health-band' + (grow ? ' is-entering' : ''), role: 'img', 'aria-label': said },
    h(
      'div',
      { class: 'gb-health-ticks', 'aria-hidden': 'true' },
      TICKS.map((t, i) => h('span', { style: { '--i': i } }, t))
    ),
    h(
      'div',
      { class: 'gb-health-track' + (last ? '' : ' is-empty'), 'aria-hidden': 'true' },
      last
        ? h('div', { class: 'gb-health-lastbar' + (grow ? ' is-growing' : ''), style: pos(last) })
        : h('span', { class: 'gb-health-track-empty' }, 'No sleep logged for last night')
    ),
    // No history at all: 13 empty rows would only draw a grid of nothing.
    !known.length
      ? null
      : h(
          'div',
          { class: 'gb-health-nights', 'aria-hidden': 'true' },
          list
            .slice(0, -1)
            .reverse() // newest nearest the big bar
            .map((n, i) =>
              h(
                'div',
                { class: 'gb-health-night', style: { '--age': i } },
                n.night ? h('i', { style: pos(n.night) }) : null
              )
            )
        )
  );

  const stat = (label, value) =>
    h(
      'div',
      { class: 'gb-health-sstat' },
      h('dt', null, label),
      h('dd', null, value == null ? DASH : value)
    );

  return Card({
    className: 'gb-health-sleep',
    children: [
      h(
        'div',
        { class: 'gb-health-sleep-head' },
        h('h2', null, 'Last night'),
        smallBtn(
          last ? 'Edit last night' : 'Log last night',
          p.onEditSleep,
          last ? 'pencil' : 'moon'
        )
      ),
      !known.length
        ? null
        : h(
            'div',
            { class: 'gb-health-sleep-figs' },
            h(
              'div',
              { class: 'gb-health-sleep-main' },
              // The duration is the hero sentence's; the card leads with when.
              h(
                'span',
                { class: 'gb-health-dur' + (last ? '' : ' is-empty') },
                last ? formatTime(last.bedtime) + ' \u2013 ' + formatTime(last.wakeTime) : DASH
              ),
              last
                ? h('span', { class: 'gb-health-span' }, durationLabel(last.minutes) + ' asleep')
                : null
            ),
            h(
              'dl',
              { class: 'gb-health-sstats' },
              stat(NIGHTS + '-night average', avgMin == null ? null : durationLabel(avgMin)),
              stat('Average bedtime', avgBed == null ? null : bandClock(avgBed))
            )
          ),
      band,
    ],
  });
}

/* ---- values -------------------------------------------------------------------- */

/** Today's value for a sum metric; the newest one for a latest metric. `{day, value, ...}` or null. */
function current(readings, type, today) {
  if (HEALTH_METRICS[type].agg === 'sum') {
    const v = dayValue(readings, type, today);
    return v && { day: today, ...v };
  }
  return latestValue(readings, type, today);
}

/* ---- today, in a sentence ---------------------------------------------------- */

/* The day told in words, every number a button into its history. Movement
   first ("Slept 6h 58m, walked 6,120 steps and worked out 25 min."), then
   whatever was measured today. Only today: an older weight belongs to the
   ledger, not to a sentence about today. */
function Hero(p) {
  // `count` = {to, fmt}: what the entrance counts up to, and how to print it on the way.
  const fact = (text, onclick, label, count) => {
    const b = h(
      'button',
      { type: 'button', class: 'gb-health-fact', onclick, 'aria-label': label },
      text
    );
    if (count) b._count = count;
    return b;
  };
  const counted = (type, to, suffix) => ({
    to,
    fmt: (v) =>
      numText(type, HEALTH_METRICS[type].dp ? Math.round(v * 10) / 10 : Math.round(v)) + suffix,
  });
  const today = (type) => (p.readings ? dayValue(p.readings, type, p.today) : null);
  const open = (type) => () => openDetail(type, p);
  const unit = (type) => HEALTH_METRICS[type].unit;

  const moves = [];
  const night = nights(p.sleepByDate, p.today, 1)[0].night;
  if (night) {
    moves.push([
      'Slept ',
      fact(
        durationLabel(night.minutes),
        p.onEditSleep,
        'Slept ' + durationLabel(night.minutes) + '. Edit last night',
        { to: night.minutes, fmt: (v) => durationLabel(Math.round(v)) }
      ),
    ]);
  }
  const steps = today('steps');
  const dist = today('distance');
  if (steps) {
    const parts = [
      'walked ',
      fact(
        numText('steps', steps.value) + ' steps',
        open('steps'),
        numText('steps', steps.value) + ' steps today. Open history',
        counted('steps', steps.value, ' steps')
      ),
    ];
    if (dist) {
      parts.push(
        ' ',
        h(
          'span',
          { class: 'gb-health-keep' },
          '(',
          fact(
            numText('distance', dist.value) + ' km',
            open('distance'),
            numText('distance', dist.value) + ' kilometres. Open history',
            counted('distance', dist.value, ' km')
          ),
          ')'
        )
      );
    }
    moves.push(parts);
  } else if (dist) {
    moves.push([
      'covered ',
      fact(
        numText('distance', dist.value) + ' km',
        open('distance'),
        numText('distance', dist.value) + ' kilometres today. Open history'
      ),
    ]);
  }
  const work = today('workout');
  if (work)
    moves.push([
      'worked out ',
      fact(
        numText('workout', work.value) + ' min',
        open('workout'),
        work.value + ' minutes of workout today. Open history',
        counted('workout', work.value, ' min')
      ),
    ]);

  const MEASURED = [
    ['restingHeartRate', 'resting heart '],
    ['bloodPressure', 'blood pressure '],
    ['weight', 'weight '],
    ['oxygenSaturation', 'blood oxygen '],
  ];
  const measures = MEASURED.map(([type, words]) => {
    const v = today(type);
    if (!v) return null;
    const text =
      valText(type, v.value, v.value2) + (type === 'bloodPressure' ? '' : ' ' + unit(type));
    return [
      words,
      fact(text, open(type), HEALTH_METRICS[type].label + ' ' + text + ' today. Open history'),
    ];
  }).filter(Boolean);

  // "a, b and c." with the first word capitalised.
  const sentence = (clauses) => {
    const out = [];
    clauses.forEach((c, i) => {
      if (i) out.push(i === clauses.length - 1 ? ' and ' : ', ');
      out.push(...c);
    });
    if (typeof out[0] === 'string') out[0] = out[0][0].toUpperCase() + out[0].slice(1);
    out.push('.');
    return out;
  };

  // No movement yet but something measured: that becomes the headline, so
  // the page never says "nothing logged" above a reading it just showed.
  const headline = moves.length ? moves : measures;
  const lead = headline.length
    ? sentence(headline)
    : p.readings == null
      ? ['\u00a0']
      : ['Nothing logged for today yet.'];
  const second = moves.length && measures.length ? sentence(measures) : null;
  return h(
    'section',
    { class: 'gb-health-hero', 'aria-label': 'Today' },
    h('p', { class: 'gb-health-lead' }, ...lead),
    second ? h('p', { class: 'gb-health-measures' }, ...second) : null
  );
}

/* ---- the ledger ---------------------------------------------------------------- */

/* Every tracked metric as one row across the last 14 days (7 on a narrow
   screen: the CSS hides the older half), grouped Activity / Heart / Body,
   with today as a lit column running through all of it. Read across for a
   metric's trend, down for a day. A row opens that metric's history. Metrics
   with no reading in 90 days leave the ledger for the "Not tracking yet"
   line, so it never fills with dashes. */
const LEDGER_DAYS = 14;

const typesIn = (group) => HEALTH_TYPES.filter((t) => HEALTH_METRICS[t].group === group);
const NARROW_DAYS = 7;

const isTracked = (readings, type, today) => !!latestValue(readings, type, today, 90);

function LedgerHead(days, today) {
  return h(
    'div',
    { class: 'gb-ledger-head', 'aria-hidden': 'true' },
    h('span', { class: 'gb-ledger-corner' }),
    h(
      'div',
      { class: 'gb-ledger-days' },
      days.map((d) =>
        h(
          'span',
          { class: 'gb-ledger-day' + (d === today ? ' is-today' : '') },
          d === today ? 'Today' : fmtDate(d, { weekday: 'narrow' }),
          h('b', null, String(Number(d.slice(8))))
        )
      )
    )
  );
}

/* Marks for one row: a bar per day for a sum metric, a dot per reading joined
   by a line for a measurement (the line joins across days without one). The
   dots and bars are cells, so they line up with the day columns; the line is
   an SVG drawn twice, for the 14- and the 7-day view, because its ends move. */
function LedgerMarks(type, pts, today) {
  const m = HEALTH_METRICS[type];
  const sc = chartScale(type, pts);
  const frac = (v) => (sc ? (v - sc.lo) / (sc.hi - sc.lo) : 0);
  const cells = pts.map((pt, c) => {
    const cls = 'gb-ledger-cell' + (pt.day === today ? ' is-today' : '');
    const col = { '--c': c };
    // A count's empty day is a fact (nothing walked); a measurement's is just a day without one.
    if (pt.value == null)
      return h('span', { class: cls + (m.agg === 'sum' ? ' is-gap' : ''), style: col });
    if (m.agg === 'sum')
      return h(
        'span',
        { class: cls, style: col },
        h('i', { style: { '--h': Math.max(0.08, frac(pt.value)) } })
      );
    return h(
      'span',
      { class: cls, style: col },
      h('b', { style: { '--y': frac(pt.value) } }),
      pt.value2 != null ? h('b', { class: 'is-second', style: { '--y': frac(pt.value2) } }) : null
    );
  });
  const lines = [];
  if (m.agg !== 'sum') {
    for (const [n, cls] of [
      [LEDGER_DAYS, 'is-wide'],
      [NARROW_DAYS, 'is-narrow'],
    ]) {
      const win = pts.slice(-n);
      const svg = s('svg', {
        class: 'gb-ledger-line ' + cls,
        viewBox: '0 0 ' + n + ' 1',
        preserveAspectRatio: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      });
      for (const key of ['value', 'value2']) {
        let d = '';
        win.forEach((pt, i) => {
          if (pt[key] == null) return;
          // Same geometry as the dots: centred in the cell, 4px-ish inset top and bottom (in CSS).
          d += (d ? 'L' : 'M') + (i + 0.5) + ' ' + (1 - frac(pt[key])).toFixed(4);
        });
        if (d.includes('L'))
          // pathLength 1: the entrance draws it with a 0 -> 1 dash.
          svg.appendChild(s('path', { d, pathLength: 1, 'vector-effect': 'non-scaling-stroke' }));
      }
      lines.push(svg);
    }
  }
  return h(
    'div',
    { class: 'gb-ledger-marks' },
    ...lines,
    h('div', { class: 'gb-ledger-cells' }, ...cells)
  );
}

function LedgerRow(type, p, r = 0) {
  const m = HEALTH_METRICS[type];
  const pts = series(p.readings, type, p.today, LEDGER_DAYS);
  const cur = current(p.readings, type, p.today);
  const asOf = cur && cur.day !== p.today ? fmtDate(cur.day, 'short') : null;
  const shown = cur ? valText(type, cur.value, cur.value2) : '';
  const trace = traceLabel(type, pts, LEDGER_DAYS);
  return h(
    'button',
    {
      type: 'button',
      class: 'gb-ledger-row',
      style: { '--r': r }, // the entrance staggers rows top to bottom
      onclick: () => openDetail(type, p),
      'aria-label':
        m.label +
        ', ' +
        (cur ? shown + ' ' + m.unit + (asOf ? ' as of ' + asOf : ' today') : 'nothing today') +
        '. ' +
        trace +
        '. Open history.',
    },
    h(
      'span',
      { class: 'gb-ledger-label' },
      h('span', { class: 'gb-ledger-name' }, m.label),
      cur
        ? h(
            'span',
            { class: 'gb-ledger-val' },
            shown,
            h('small', null, m.unit),
            asOf ? h('em', null, asOf) : null
          )
        : h('span', { class: 'gb-ledger-val is-empty' }, 'Nothing today')
    ),
    LedgerMarks(type, pts, p.today)
  );
}

function Ledger(p) {
  if (!p.readings) {
    return Card({
      className: 'gb-ledger is-loading',
      children: [
        h(
          'div',
          { class: 'gb-skel-lines', 'aria-busy': 'true' },
          [60, 90, 75, 85].map((w) =>
            h('div', { class: 'gb-skel-line', style: { width: w + '%', height: '28px' } })
          )
        ),
      ],
    });
  }
  const days = lastDays(p.today, LEDGER_DAYS);
  const tracked = HEALTH_TYPES.filter((t) => isTracked(p.readings, t, p.today));
  const untracked = HEALTH_TYPES.filter((t) => !tracked.includes(t));
  const chip = (t) =>
    h(
      'button',
      { type: 'button', class: 'gb-ledger-chip', onclick: () => openLogForm(p, { type: t }) },
      Icon('plus', { size: 14 }),
      HEALTH_METRICS[t].label
    );

  if (!tracked.length) {
    return Card({
      className: 'gb-ledger is-empty',
      children: [
        h('h2', null, 'Your ledger'),
        h(
          'p',
          null,
          'Each thing you log becomes a row here, one column per day, so a change shows the day it starts. Start with one:'
        ),
        h(
          'div',
          { class: 'gb-ledger-chips' },
          ['weight', 'steps', 'bloodPressure', 'restingHeartRate'].map(chip)
        ),
      ],
    });
  }

  let order = 0;
  return Card({
    className: 'gb-ledger',
    children: [
      h(
        'div',
        { class: 'gb-ledger-top' },
        h(
          'h2',
          null,
          h('span', { class: 'gb-ledger-wide' }, 'Last 14 days'),
          h('span', { class: 'gb-ledger-narrow' }, 'Last 7 days')
        ),
        h('span', { class: 'gb-ledger-hint' }, 'Tap a row for its history')
      ),
      h(
        'div',
        { class: 'gb-ledger-body' },
        h('span', { class: 'gb-ledger-spine', 'aria-hidden': 'true' }),
        LedgerHead(days, p.today),
        ...HEALTH_GROUPS.flatMap((g) => {
          const rows = tracked.filter((t) => HEALTH_METRICS[t].group === g.id);
          if (!rows.length) return [];
          return [
            h('h3', { class: 'gb-ledger-group' }, g.label),
            ...rows.map((t) => LedgerRow(t, p, order++)),
          ];
        })
      ),
      untracked.length
        ? h(
            'div',
            { class: 'gb-ledger-foot' },
            h('span', null, 'Not tracking yet'),
            h('div', { class: 'gb-ledger-chips' }, untracked.map(chip))
          )
        : null,
    ],
  });
}

/* ---- detail sheet ------------------------------------------------------------ */

function openDetail(type, p) {
  const m = HEALTH_METRICS[type];
  let range = 30;
  let close = () => {};
  const view = h('div', { class: 'gb-health-detail' });
  const segs = h(
    'div',
    { class: 'gb-segmented gb-health-range', role: 'radiogroup', 'aria-label': 'Range' },
    RANGES.map((n) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-seg',
          role: 'radio',
          dataset: { n },
          onclick: () => {
            range = n;
            draw();
          },
        },
        n + ' days'
      )
    )
  );

  const describe = (r) => valText(type, r.value, r.value2) + ' ' + m.unit;
  async function deleteRow(r) {
    const ok = await confirmDialog({
      title: 'Delete this reading?',
      message: m.label + ' ' + describe(r) + ' on ' + fmtDate(r.day, 'weekdayDate') + '.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      danger: true,
    });
    if (!ok) return;
    try {
      await p.onDelete(r.id);
      close();
    } catch (err) {
      toast.error(err, 'Could not delete the reading.');
    }
  }

  const Row = (r) => {
    const when =
      fmtDate(r.day, 'weekdayDate') + (r.measuredAt ? ', ' + formatTime(r.measuredAt) : '');
    const what = describe(r);
    const tool = (icon, verb, onclick) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--icon',
          'aria-label': verb + ' ' + what + ', ' + when,
          onclick,
        },
        Icon(icon, { size: 18 })
      );
    return h(
      'li',
      { class: 'gb-health-row' },
      h(
        'div',
        { class: 'gb-health-row-main' },
        h('span', { class: 'gb-health-row-val' }, what),
        h('span', { class: 'gb-health-row-when' }, when),
        r.note ? h('span', { class: 'gb-health-row-note' }, r.note) : null
      ),
      r.source === 'phone'
        ? h('span', { class: 'gb-health-row-src' }, 'From your phone')
        : h(
            'div',
            { class: 'gb-health-row-tools' },
            tool('pencil', 'Edit', () => {
              close();
              openLogForm(p, { reading: r });
            }),
            tool('trash-2', 'Delete', () => deleteRow(r))
          )
    );
  };

  function draw() {
    for (const b of segs.children) {
      const on = Number(b.dataset.n) === range;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
    const pts = series(p.readings, type, p.today, range);
    const sc = chartScale(type, pts);
    const avgs = means(pts);
    const have = pts.filter((q) => q.value != null);
    const low = have.reduce((a, b) => (a && a.value <= b.value ? a : b), null);
    const high = have.reduce((a, b) => (a && a.value >= b.value ? a : b), null);
    const from = pts[0].day;
    const rows = entriesFor(p.readings, type).filter((r) => r.day >= from);

    const chart = h(
      'div',
      { class: 'gb-health-chart' },
      h(
        'div',
        { class: 'gb-health-yaxis', 'aria-hidden': 'true' },
        h('span', null, sc ? valText(type, sc.hi) : ''),
        h('span', null, sc ? valText(type, sc.lo) : '')
      ),
      Trace(type, pts, {
        w: 320,
        ht: 140,
        today: p.today,
        label: traceLabel(type, pts, range),
        sc,
        avgs,
      }),
      h(
        'div',
        { class: 'gb-health-xaxis', 'aria-hidden': 'true' },
        h('span', null, fmtDate(from, 'short')),
        h('span', null, fmtDate(p.today, 'short'))
      )
    );
    const stat = (label, pt) =>
      h(
        'div',
        { class: 'gb-health-sstat' },
        h('dt', null, label),
        h('dd', null, pt && pt.value != null ? valText(type, pt.value, pt.value2) : DASH)
      );
    const stats = h(
      'dl',
      { class: 'gb-health-stats' },
      stat('Average', { value: avgs[0], value2: avgs[1] }),
      stat('Lowest', low),
      stat('Highest', high)
    );
    view.replaceChildren(
      chart,
      stats,
      h('h3', { class: 'gb-health-sub' }, 'Readings'),
      rows.length
        ? h('ul', { class: 'gb-health-rows' }, rows.map(Row))
        : h('p', { class: 'gb-health-none' }, 'No readings yet')
    );
  }

  draw();
  close = openModal({
    title: m.label,
    modalClass: 'gb-health-sheet',
    body: h(
      'div',
      null,
      segs,
      view,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-health-add',
          onclick: () => {
            close();
            openLogForm(p, { type });
          },
        },
        Icon('plus', { size: 16 }),
        'Add reading'
      )
    ),
  });
}

/* ---- log form ---------------------------------------------------------------- */

let formSeq = 0;

/** A new reading (`type` preselects the metric) or an edit of a manual `reading`. */
function openLogForm(p, { type, reading } = {}) {
  const seq = ++formSeq;
  const id = (k) => 'gb-health-f-' + k + '-' + seq;
  const editing = !!reading;
  const label = (k, text) => h('label', { class: 'gb-field-label', for: id(k) }, text);
  const field = (k, text, control) => h('div', { class: 'gb-field' }, label(k, text), control);
  const input = (k, attrs) => h('input', { class: 'gb-input', id: id(k), ...attrs });

  const what = h(
    'select',
    { class: 'gb-input', id: id('type'), disabled: editing }, // the server keeps a reading's type
    HEALTH_GROUPS.map((g) =>
      h(
        'optgroup',
        { label: g.label },
        typesIn(g.id).map((t) => h('option', { value: t }, HEALTH_METRICS[t].label))
      )
    )
  );
  what.value = (reading && reading.type) || type || 'steps';
  const value = input('value', { type: 'number', inputmode: 'decimal', required: true });
  const value2 = input('value2', { type: 'number', inputmode: 'decimal' });
  const day = input('day', { type: 'date', max: p.today, required: true });
  const note = h('textarea', { class: 'gb-input', id: id('note'), rows: 2, maxlength: 280 });
  day.value = (reading && reading.day) || p.today;
  note.value = (reading && reading.note) || '';
  if (reading) {
    value.value = reading.value;
    if (reading.value2 != null) value2.value = reading.value2;
  }

  const unit = h('span', { class: 'gb-health-unit' });
  const valueLabel = label('value', '');
  const diaField = field(
    'value2',
    'Diastolic',
    h('div', { class: 'gb-health-valrow' }, value2, h('span', { class: 'gb-health-unit' }, 'mmHg'))
  );

  function sync() {
    const m = HEALTH_METRICS[what.value];
    valueLabel.textContent = m.pair ? 'Systolic' : 'Value';
    unit.textContent = m.unit;
    Object.assign(value, { step: m.step, min: m.min, max: m.max });
    diaField.hidden = !m.pair;
    if (m.pair) Object.assign(value2, { step: 1, min: m.pair.min, max: m.pair.max });
  }
  what.addEventListener('change', sync);
  sync();

  const inputs = { type: what, value, value2, day, note };
  openModal({
    title: editing ? 'Edit reading' : 'Log a reading',
    body: h(
      'div',
      { class: 'gb-health-form' },
      field('type', 'What', what),
      h(
        'div',
        { class: 'gb-field' },
        valueLabel,
        h('div', { class: 'gb-health-valrow' }, value, unit)
      ),
      diaField,
      field('day', 'Date', day),
      field('note', 'Note (optional)', note)
    ),
    primary: editing ? 'Save changes' : 'Save reading',
    errorMessage: 'Could not save the reading.',
    onPrimary: async () => {
      const t = what.value;
      const pair = !!HEALTH_METRICS[t].pair;
      const err = readingError(t, value.value, pair ? value2.value : undefined);
      if (err) throw fieldRefusal(value, err);
      if (!day.value || day.value > p.today) throw fieldRefusal(day, 'Pick a day up to today.');
      const out = {
        value: Number(value.value),
        value2: pair ? Number(value2.value) : null,
        day: day.value,
        note: note.value.trim(),
      };
      try {
        if (editing) await p.onUpdate(reading.id, out);
        else await p.onSave({ type: t, ...out });
      } catch (e) {
        // A server refusal names its field by key ('value', 'day', ...); show it under that input.
        if (e && typeof e.field === 'string')
          throw fieldRefusal(inputs[e.field] || value, e.message);
        throw e;
      }
    },
  });
  focusSoon(editing || type ? value : what);
}

/* ---- screen ------------------------------------------------------------------ */

function ScreenHealth(props = {}) {
  const entering = !entered && props.readings != null;
  if (entering) entered = true;
  const root = h(
    'div',
    { class: 'gb-health' + (entering ? ' is-entering' : '') },
    // The sentence is the screen's thesis: it leads, and where the numbers came
    // from (plus the way to add one) reads as its footnote.
    Hero(props),
    Header(props),
    LastNight(props),
    Ledger(props)
  );
  if (entering && !calm()) countUp(root);
  return root;
}

export { ScreenHealth };
