# scripts/health.js — Health screen

View only. Every number comes from `health-logic.js` (pure, `node scripts/health-logic.test.mjs`);
every write goes out through the props `app.js` passes, and `app.js` re-renders after a write
resolves, so a sheet just closes on success. Lazily imported by the `health` entry in `SCREENS`.
A missing value is a muted dash, never a zero. CSS: the "Health screen" section of `app.css`.

## Entry

`ScreenHealth({native, today, readings, sleepByDate, phone, layout, onSaveLayout, onSave, onUpdate, onDelete, onEditSleep, onConnect, onSync})`
→ `div.gb-health`: `Hero` (the sentence leads), `Header` (its footnote: source line + actions), then the three cards `Insights`, `LastNight`, `Ledger` **in the user's order, minus the ones they hid** (`resolveHealthLayout(layout).sections`). `props.shown(type)` (added here) is false for a hidden metric: it drops out of the sentence, the ledger, its chips and the insights.

| Prop | Shape / use |
|---|---|
| `native` | inside the phone app: the header names the store and offers Sync / Connect |
| `today` | `'YYYY-MM-DD'`, the end day of every series and the date input's `max` |
| `readings` | the rows described at the top of `health-logic.js`; **`null` while loading** → a skeleton ledger card (and a blank-height hero, no layout shift). The sleep card does not wait for it |
| `sleepByDate` | `{ wakeDay: {bedtime, wakeTime, quality, note} }`, read through `nights()` |
| `phone` | native only: `{available, syncing, syncedAt: Date, store}`. Connect shows when `available` isn't `true` **and** nothing has synced; otherwise Sync (disabled while `syncing`) |
| `onSave({type, value, value2, day, note})` / `onUpdate(id, {value, value2, day, note})` | promises. `value2` is `null` except for blood pressure; `note` is the trimmed text (`''` clears) |
| `onDelete(id)` | after `confirmDialog` (danger, "Delete" / "Keep") |
| `onEditSleep` | the app's own sleep dialog; both "Edit last night" and the empty state's "Log last night" |
| `layout` / `onSaveLayout(layout)` | `ui_prefs.healthLayout` = `{sections: [{id, on}], metrics: [{type, on}]}`, made whole by health-logic `resolveHealthLayout` (unknown ids dropped, new ones appended and shown). app.js saves it with `saveUiPrefs` and re-renders. No `onSaveLayout` → no Customise button |

A rejected save whose Error has a **string** `.field` (`'value'`, `'value2'`, `'day'`, `'note'`,
`'type'`) is rethrown as `fieldRefusal(thatInput, message)` so `openModal` shows it under the
input; any other rejection toasts. An unknown key lands under the value field.

## Pieces

| Symbol | What |
|---|---|
| `valText(type, v, v2)` | locale number at the metric's `dp` (`fmtNumber`), `sys/dia` for a `pair` metric |
| `bandClock(min)` | minutes after 18:00 → clock text through gb-kit `formatTime` (honours 12/24h) |
| `syncedText(at)` | "Synced just now / N min ago / N h ago / 12 Oct" |
| `s(tag, attrs)` | `createElementNS` for SVG; `h` makes HTML elements only |
| `chartScale(type, pts)` | `{lo, hi}` over `value` and `value2`: sum metrics from 0, latest ones hug their own range; flat data gets a 1-unit spread so nothing divides by zero |
| `Trace(type, pts, {w, ht, today, label, sc, avgs})` | the one chart, tile and sheet alike: sum → bars (today `is-today`), latest → a path that breaks at gaps plus dots (only today's past 30 points); blood pressure draws two lines. `avgs` adds dashed `.gb-health-avg` lines. `role=img` with `label` |
| `means(pts)` | `[mean(value), mean(value2)]` via `health-logic` `mean` |
| `traceLabel` | "14-day average 7,920 steps", also the tile's and the sheet's chart label |
| `Header` | source line + optional Sync/Connect + Customise + the primary "Log a reading". On the web the source line reads the readings' `source`: "From your phone and typed in by you" / "From your phone" / "Typed in by you" (it used to say "typed in" for phone rows too) |
| `Insights` | health-logic `healthInsights` (the user against their own recent days: steps this week vs last, resting heart rate / HRV vs the 30 days before, weight across 4 weeks, blood pressure's 2-week average against 120/80 naming the number that tripped it, steps vs the next night's sleep). Watch items first, at most 3, each a button into `openDetail(metric)`; too little data says when they appear |
| `openCustomise(p)` | `openModal` of Home's layout rows (`gb-home-cust-*`): Cards, then each group's metrics, each with up/down (`moveHealthSection` / `moveHealthMetric`: a metric moves within its group) and a show switch. Saves on every change and redraws in place, focus back on the arrow that moved (its partner at an end) |
| `LastNight` | the signature card, below |
| `current(readings, type, today)` | sum metric → today's `dayValue`; latest → `latestValue` (90-day lookback), whose `day` drives "as of 9 Oct" |
| `Hero` | **today as a sentence** in display type: movement first ("Slept 6h 58m, walked 6,120 steps (4.6 km) and worked out 25 min."), then today's measurements ("Resting heart 61 bpm, blood pressure 114/72 and weight 71.6 kg."). Every number is a `.gb-health-fact` button (sleep → `onEditSleep`, the rest → `openDetail`). Today only, never an older reading. No movement but a measurement → the measurement is the headline (it once said "Nothing logged" above a weight). `.gb-health-keep` keeps "(4.6 km)" on one line |
| `Ledger` | **the signature**: every tracked, shown metric, in the user's order within each group, (`isTracked`: any reading in 90 days) as one `LedgerRow` across the last 14 days, grouped by `HEALTH_GROUPS` (`h3.gb-ledger-group`), under one `LedgerHead` of day columns, with `.gb-ledger-spine` lighting today's column through every row. Untracked metrics leave the ledger for the "Not tracking yet" chips (each opens `openLogForm` on that metric). Nothing tracked → an empty card with four starter chips |
| `LedgerRow(type, p)` | a `<button>` → `openDetail`: the metric's icon (`HEALTH_METRICS.icon`, one each, tinted by group via `.gb-health-ic.is-<group>`), name, today's / latest value (+ "as of"), and `LedgerMarks`. `aria-label` carries value, unit, day and the 14-day summary |
| `LedgerMarks(type, pts, today)` | `.gb-ledger-cells` = one cell per day (bars for sums, dots for measurements, BP draws two), plus, for measurements, the joining line as an SVG **drawn twice** (`is-wide` 14 days, `is-narrow` 7) because its end points move with the window. A sum's empty day gets a small gap dot; a measurement's doesn't (a day without a reading isn't a fact) |
| `typesIn(group)` | metrics of one group in `HEALTH_METRICS` order (the log form's `optgroup`s) |
| `openDetail(type, p)` | `openModal` with no primary (dismiss reads "Close"). 7 / 30 / 90-day `.gb-segmented` radiogroup (default 30) redraws chart, stats (average / lowest / highest; the extremes pick the day by systolic for BP) and the "Readings" list, which is `entriesFor` cut to the same range. Manual rows: Edit (closes, reopens `openLogForm` prefilled) and Delete; phone rows say "From your phone" and have neither. "Add reading" closes and opens the form on this metric |
| `openLogForm(p, {type, reading})` | `openModal`: What (`select` with an `optgroup` per group; disabled when editing, since `onUpdate` takes no type), value + unit, Diastolic (hidden unless `pair`), Date (`max` today), Note (280). `sync()` re-applies label, unit, `step`/`min`/`max` on a type change. `readingError` runs before any call; its message goes under the value field |

## The "Last night" card

- `nights(sleepByDate, today, 14)`: the last entry is last night (keyed on today, the wake day).
- The nights are **columns**: evening at the top, morning at the bottom, oldest left, last night the
  one `--brand-fill` column (`.gb-sleep-col.is-last`); the rest are `--fg3`. Positions use the
  band minutes `nightOnBand` gives (`from`/`to`, minutes after 18:00), mapped onto a 20:00-10:00
  window that widens to the nearest hour for an outlier. Hour axis at 21/00/03/06/09
  (`HOUR_TICKS`, through `bandClock`), wake dates under the columns.
- Behind them, the **usual window** (`.gb-sleep-usual`): average bedtime to average wake over the
  known nights, shown once there are 3+. Same pair is the "Usual window" stat.
- The head compares last night with the nights before it: "36m less than usual" / "more" /
  "right on your usual" (under 5 minutes).
- 14 columns, 7 when the card is under 560px (container query on `.gb-health-sleep`).
- **Motion:** once per load (`grown`), each night falls from bedtime to wake (`gb-sleep-fall`,
  scaleY from the top, staggered by `--i` oldest first); none under reduced motion.

## The entrance

Once per page load (`entered`), on the first render that has readings: `ScreenHealth` adds
`.is-entering` and, unless reduced motion (`calm()`), runs `countUp(root)`, which counts every
`.gb-health-fact` that carries `_count = {to, fmt}` up from zero (ease-out cubic, 900ms after a
160ms beat; Space Mono's equal-width digits mean no reflow). The rest is CSS under
`prefers-reduced-motion: no-preference`: the Today spine draws down, bars and dots rise column by
column oldest first (`--c` per cell, offset by `--c0` = the first visible column, so the 7-day view
starts at once) with each row a beat later (`--r` per row), lines draw via `pathLength="1"` +
dashoffset, today's mark settles with `--ease-bounce`, and the sleep card's nights fall in column by column
(`.gb-sleep-chart.is-entering`, keyed on the card's own `grown`). Re-renders
after a save never replay it.

## Narrow screens

The ledger is a size container. Under 560px it shows **7 days**: `--n: 7`, a slimmer `--label`,
`.gb-ledger-day` / `.gb-ledger-cell` `:nth-child(-n + 7)` hidden (the cells sit in their own
`.gb-ledger-cells` wrapper so plain `nth-child` works; `:nth-child(of S)` is too new for older phone
WebViews), the `is-narrow` line shown, and the title swaps "Last 14 days" for "Last 7 days". The scale
stays the 14-day one, so a row's marks don't jump between widths.

## Traps

- `gb-field` is `display: flex`, which beats the `hidden` attribute; the form section restores it
  (`.gb-health-form .gb-field[hidden]`).
- `fieldError` inserts its note right after the input, i.e. inside `.gb-health-valrow`; CSS
  `order` + `flex-basis: 100%` drops it under the input and unit.
- The sheets live in `body`, outside `.gb-health`, so `.gb-health h2/h3 { margin: 0 }` doesn't
  reach them; their own heads set margins directly.
