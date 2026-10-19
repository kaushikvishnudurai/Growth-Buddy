/* =====================================================================
   Growth Buddy — reading another calendar's .ics into reminders

   DOM-free (scripts/ics-import.test.mjs runs it under node). Turns VEVENTs
   into the body POST /api/reminders takes, plus the days to skip after
   (EXDATE → DELETE ?scope=this&date=). Nothing here talks to the server.

   Times: a reminder's time is a LOCAL time that follows the user (see
   CLAUDE.md), so every DTSTART — UTC (…Z), TZID'd or floating — becomes a
   wall-clock time in the user's zone, and the date with it. A floating time
   is taken as already local.

   Rules: what recurrence.js can express (DAILY / WEEKLY / MONTHLY / YEARLY,
   INTERVAL, BYDAY for weekly, an nth weekday for monthly, a month day,
   COUNT, UNTIL). Anything else comes in as its first date, flagged. A
   series that started in the past starts again at its next occurrence
   (the server takes no reminder before today), COUNT reduced by what has
   gone. Past one-offs are reported, never sent.
   ===================================================================== */

import { occursOn, DAY_CODES, WEEK_ORDER } from './recurrence.js';

export const MAX_EVENTS = 10_000;
const TAGS = ['work', 'personal', 'health', 'urgent', 'other'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ---- Lines and properties ---- */

/** Unfolded content lines (RFC 5545 3.1: a CRLF + space/tab continues the line). */
export function unfold(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((l) => l.trim());
}

/** "DTSTART;TZID=Asia/Kolkata:20261012T090000" → {name, params, value}. */
function property(line) {
  let q = false;
  let i = 0;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ':' && !q) break;
  }
  const head = line.slice(0, i).split(';');
  const params = {};
  for (const p of head.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: head[0].toUpperCase(), params, value: line.slice(i + 1) };
}

/** TEXT unescaping (RFC 5545 3.3.11), the reverse of ReminderIcs.text. */
export function unescapeText(s) {
  return String(s || '').replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Every VEVENT as its raw parts. Throws a readable Error when it isn't a calendar. */
export function parseIcs(text) {
  const lines = unfold(text);
  if (!lines.some((l) => /^BEGIN:VCALENDAR/i.test(l)))
    throw new Error('That isn’t a calendar file (.ics). Export it from your calendar app first.');
  const events = [];
  let ev = null;
  let alarm = null;
  for (const line of lines) {
    const p = property(line);
    if (p.name === 'BEGIN' && /^VEVENT$/i.test(p.value)) {
      ev = { exdates: [], alarms: [], categories: '' };
      alarm = null;
    }
    else if (p.name === 'END' && /^VEVENT$/i.test(p.value)) {
      if (ev) events.push(ev);
      ev = null;
    } else if (!ev) continue;
    else if (p.name === 'BEGIN' && /^VALARM$/i.test(p.value)) alarm = {};
    else if (p.name === 'END' && /^VALARM$/i.test(p.value)) {
      if (alarm) ev.alarms.push(alarm); // a stray END:VALARM has nothing to push
      alarm = null;
    } else if (alarm) {
      if (p.name === 'TRIGGER') alarm.trigger = p;
      else if (p.name === 'ACTION') alarm.action = p.value.toUpperCase();
    } else if (p.name === 'SUMMARY') ev.summary = unescapeText(p.value);
    else if (p.name === 'DESCRIPTION') ev.description = unescapeText(p.value);
    else if (p.name === 'CATEGORIES') ev.categories = unescapeText(p.value);
    else if (p.name === 'UID') ev.uid = p.value;
    else if (p.name === 'STATUS') ev.status = p.value.toUpperCase();
    else if (p.name === 'DTSTART') ev.start = p;
    else if (p.name === 'DTEND') ev.end = p;
    else if (p.name === 'RRULE') ev.rrule = p.value;
    else if (p.name === 'RECURRENCE-ID') ev.recurrenceId = p;
    else if (p.name === 'EXDATE') for (const v of p.value.split(',')) ev.exdates.push({ ...p, value: v });
  }
  if (events.length > MAX_EVENTS)
    throw new Error('This calendar has ' + events.length + ' events. Import up to ' + MAX_EVENTS + ' at a time.');
  return events;
}

/* ---- Time zones (Intl, no data of our own) ---- */

const fmts = new Map();
function zoneFmt(zone) {
  if (!fmts.has(zone))
    fmts.set(
      zone,
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  return fmts.get(zone);
}
/** Is `zone` a time zone this runtime knows? (Outlook writes Windows names.) */
function knownZone(zone) {
  try {
    zoneFmt(zone);
    return true;
  } catch (_) {
    return false;
  }
}
/** The wall clock in `zone` at a UTC instant, as a UTC-based ms count. */
function wallAt(utcMs, zone) {
  const parts = {};
  for (const x of zoneFmt(zone).formatToParts(new Date(utcMs))) parts[x.type] = x.value;
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
}
/** A wall clock in `zone` → the UTC instant. Two passes settle a DST edge. */
function instantOf(wallMs, zone) {
  let u = wallMs - (wallAt(wallMs, zone) - wallMs);
  u = wallMs - (wallAt(u, zone) - u);
  return u;
}

const pad = (n) => String(n).padStart(2, '0');
const keyOfMs = (ms) => {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
};
const hhmmOfMs = (ms) => {
  const d = new Date(ms);
  return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
};
const epochDay = (key) => Math.round(Date.parse(key + 'T00:00:00Z') / 86400000);
const keyOfDay = (e) => keyOfMs(e * 86400000);

/**
 * A DATE / DATE-TIME property read into the user's zone: `{date, time|null,
 * unknownZone?}`. `time` is null for an all-day value.
 */
export function readTime(p, zone) {
  if (!p) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(p.value).trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (m[4] === undefined || (p.params && p.params.VALUE === 'DATE'))
    return { date: m[1] + '-' + m[2] + '-' + m[3], time: null };
  const wall = Date.UTC(y, mo - 1, d, +m[4], +m[5], +(m[6] || 0));
  let utc = null;
  let unknownZone = false;
  if (m[7]) utc = wall;
  else if (p.params && p.params.TZID) {
    if (knownZone(p.params.TZID)) utc = instantOf(wall, p.params.TZID);
    else unknownZone = true;
  }
  const local = utc === null ? wall : wallAt(utc, zone);
  return { date: keyOfMs(local), time: hhmmOfMs(local), unknownZone };
}

/* ---- Alarms ---- */

/** "-PT15M" → 15; "-P1D" → 1440; "PT0S" → 0. Null for an alarm after the start or at a fixed time. */
export function triggerMinutes(t) {
  if (!t || (t.params && (t.params.VALUE === 'DATE-TIME' || t.params.RELATED === 'END'))) return null;
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(t.value).trim());
  if (!m) return null;
  const mins = (+m[2] || 0) * 10080 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0) + Math.floor((+m[6] || 0) / 60);
  if (m[1] !== '-' && mins !== 0) return null; // after the start: nothing to ring ahead
  return mins;
}

/* ---- Rules ---- */

/**
 * RRULE → our rule fields, with the anchor the rule needs. `{repeat, interval,
 * days?, nth?, monthDay?, count?, until?, unsupported?}`. `monthDay` is the
 * month day a by-date rule means (31 for "the last day", our export's
 * BYMONTHDAY=28,29,30,31;BYSETPOS=-1); `lastDay` marks a rule that means the
 * month's last day, which is exactly what the app's clamp does.
 */
export function readRule(rrule) {
  const r = {};
  for (const part of String(rrule || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) r[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase();
  }
  const out = { interval: Number(r.INTERVAL || 1) };
  const why = (s) => Object.assign(out, { unsupported: s });
  const known = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'COUNT', 'UNTIL', 'WKST']);
  const extra = Object.keys(r).filter((k) => !known.has(k));
  if (r.COUNT) out.count = Number(r.COUNT);
  if (r.UNTIL) out.until = r.UNTIL;
  if (!(out.interval >= 1 && out.interval <= 99)) return why('repeats every ' + r.INTERVAL + ', more than 99');
  if (extra.length) return why('uses ' + extra.join(', '));
  const byday = r.BYDAY ? r.BYDAY.split(',') : [];
  const plainDays = byday.every((d) => DAY_CODES.includes(d));
  const monthDays = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : [];
  // Our export's month-end clamp: BYMONTHDAY=28,29[,30[,31]];BYSETPOS=-1 = day 29/30/31, clamped.
  const clamp =
    r.BYSETPOS === '-1' && monthDays.length > 1 && monthDays[0] === 28 && monthDays.every((d, i) => d === 28 + i)
      ? monthDays[monthDays.length - 1]
      : 0;
  switch (r.FREQ) {
    case 'DAILY':
      if (byday.length && out.interval === 1 && plainDays) return Object.assign(out, { repeat: 'weekly', days: byday });
      if (byday.length || monthDays.length || r.BYMONTH) return why('repeats daily on some days only');
      return Object.assign(out, { repeat: 'daily' });
    case 'WEEKLY': {
      if (!plainDays || monthDays.length || r.BYMONTH || r.BYSETPOS) return why('a weekly pattern the app can’t follow');
      // recurrence.js counts every-N weeks from Monday; another WKST groups the days differently
      // when BYDAY falls on both sides of it.
      const wk = WEEK_ORDER.indexOf(r.WKST);
      const pos = byday.map((d) => WEEK_ORDER.indexOf(d));
      if (out.interval > 1 && wk > 0 && pos.some((x) => x < wk) && pos.some((x) => x >= wk))
        return why('counts its weeks from ' + DAY_NAMES[DAY_CODES.indexOf(r.WKST)]);
      return Object.assign(out, { repeat: 'weekly', days: byday });
    }
    case 'MONTHLY': {
      if (r.BYMONTH) return why('repeats in some months only');
      if (byday.length === 1 && !monthDays.length) {
        const m = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(byday[0]);
        const nth = m && m[1] ? Number(m[1]) : r.BYSETPOS && !r.BYSETPOS.includes(',') ? Number(r.BYSETPOS) : 0;
        if (m && (nth === -1 || (nth >= 1 && nth <= 5)))
          return Object.assign(out, { repeat: 'monthly', nth, dow: DAY_CODES.indexOf(m[2]) });
        const day = DAY_NAMES[DAY_CODES.indexOf(byday[0].replace(/^[+-]?\d+/, ''))];
        return why('repeats on every ' + (day || byday[0]) + ' of the month');
      }
      if (byday.length) return why('repeats on several weekdays a month');
      if (clamp) return Object.assign(out, { repeat: 'monthly', monthDay: clamp, lastDay: true });
      if (monthDays.length === 1 && monthDays[0] === -1) return Object.assign(out, { repeat: 'monthly', monthDay: 31, lastDay: true });
      if (monthDays.length === 1 && monthDays[0] >= 1 && monthDays[0] <= 31 && !r.BYSETPOS)
        return Object.assign(out, { repeat: 'monthly', monthDay: monthDays[0] });
      if (monthDays.length || r.BYSETPOS) return why('repeats on several days a month');
      return Object.assign(out, { repeat: 'monthly' });
    }
    case 'YEARLY': {
      if (byday.length || (r.BYMONTH && r.BYMONTH.includes(','))) return why('a yearly pattern the app can’t follow');
      const month = r.BYMONTH ? Number(r.BYMONTH) : 0;
      if (clamp === 29 && month === 2) return Object.assign(out, { repeat: 'yearly', month, monthDay: 29, lastDay: true });
      if (monthDays.length > 1 || r.BYSETPOS) return why('repeats on several days a year');
      // -1: the month's longest last day (Feb 29), which the clamp brings back to the real one.
      if (monthDays[0] === -1)
        return Object.assign(out, { repeat: 'yearly', month, monthDay: new Date(Date.UTC(2024, month || 12, 0)).getUTCDate(), lastDay: true });
      return Object.assign(out, { repeat: 'yearly', month, monthDay: monthDays[0] || 0 });
    }
    default:
      return why(r.FREQ ? 'repeats ' + r.FREQ.toLowerCase() : 'has no FREQ');
  }
}

/* The day a rule's anchor must sit on: the first day at or after `startKey`
   that the rule itself picks (RFC: DTSTART should be one, but needn't be). */
function anchorFor(rule, startKey) {
  const s = epochDay(startKey);
  for (let e = s; e < s + 366 * 8; e++) {
    const k = keyOfDay(e);
    const [y, m, d] = k.split('-').map(Number);
    const dow = new Date(e * 86400000).getUTCDay();
    if (rule.repeat === 'monthly' && rule.nth) {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (dow === rule.dow && (rule.nth === -1 ? d + 7 > last : Math.ceil(d / 7) === rule.nth)) return k;
    } else if (rule.repeat === 'monthly' && rule.monthDay) {
      if (d === rule.monthDay) return k;
    } else if (rule.repeat === 'yearly' && (rule.month || rule.monthDay)) {
      if ((!rule.month || m === rule.month) && (!rule.monthDay || d === rule.monthDay)) return k;
    } else return k;
  }
  return null;
}

/** Shift weekday codes by `shift` days (a time zone moved the start across midnight). */
function shiftDays(days, shift) {
  return days.map((c) => DAY_CODES[(DAY_CODES.indexOf(c) + shift + 7) % 7]);
}

/* ---- Events → reminders ---- */

/**
 * Every event, ready for the preview:
 *   {key, title, when, body, skips[], status: 'new'|'past'|'ended'|'bad', reason?, flags[], dup?}
 * `body` is the POST /api/reminders body; `skips` are the dates to delete with
 * scope=this after creating it. `opts`: {zone, today 'YYYY-MM-DD', now 'HH:MM',
 * existing (the user's reminders, for duplicates)}.
 */
export function toReminders(events, opts) {
  const { zone, today, now = '00:00', existing = [] } = opts;
  // Moved / cancelled instances of a series (RECURRENCE-ID): the series skips that
  // day, and a moved one comes in as a one-off of its own.
  const overrides = new Map();
  for (const ev of events)
    if (ev.recurrenceId && ev.uid) {
      const t = readTime(ev.recurrenceId, zone);
      if (t) (overrides.get(ev.uid) || overrides.set(ev.uid, []).get(ev.uid)).push(t.date);
    }
  const out = [];
  const seen = new Set();
  events.forEach((ev, i) => {
    // A cancelled instance of a series only takes its day out of the series (above).
    if (ev.recurrenceId && ev.status === 'CANCELLED') return;
    const title = (ev.summary || '').trim().slice(0, 255) || 'Untitled event';
    const item = { key: 'ev' + i, title, flags: [], skips: [], status: 'new' };
    out.push(item);
    if (ev.status === 'CANCELLED') {
      Object.assign(item, { status: 'bad', reason: 'Cancelled in the calendar it came from.' });
      return;
    }
    const start = readTime(ev.start, zone);
    if (!start) {
      Object.assign(item, { status: 'bad', reason: 'No start date.' });
      return;
    }
    if (start.unknownZone) item.flags.push('Time zone “' + ev.start.params.TZID + '” unknown: time kept as written.');
    const end = start.time ? readTime(ev.end, zone) : null;
    const body = {
      text: title,
      date: start.date,
      time: start.time,
      endTime: end && end.time && end.date === start.date && end.time > start.time ? end.time : null,
      tag: TAGS.find((t) => ev.categories.toLowerCase().split(',').map((c) => c.trim()).includes(t)) || 'personal',
      repeat: 'none',
      until: null,
      notes: ev.description ? ev.description.trim().slice(0, 1000) || null : null,
      notifyBefore: null,
      notifyBefore2: null,
    };
    if (start.time) {
      const leads = [...new Set(ev.alarms.map((a) => triggerMinutes(a.trigger)).filter((m) => m !== null))];
      if (leads.some((m) => m > 1440)) item.flags.push('An alert more than a day ahead is set to one day.');
      const capped = [...new Set(leads.map((m) => Math.min(m, 1440)))];
      body.notifyBefore = capped.length ? capped[0] : null;
      body.notifyBefore2 = capped.length > 1 ? capped[1] : null;
    }

    if (ev.rrule && !ev.recurrenceId) {
      const rule = readRule(ev.rrule);
      // The zone moved the start to another day: weekday rules move with it.
      const v = String(ev.start.value);
      const shift = epochDay(start.date) - epochDay(v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8));
      // Every-N-weeks counts weeks from Monday: shifted days of one week can straddle
      // Monday and fall a week apart. ponytail: refused whenever it might; a per-day check is the upgrade.
      const straddles = rule.repeat === 'weekly' && rule.interval > 1 && rule.days && rule.days.length > 1;
      if (shift && (rule.nth || rule.monthDay || rule.month || straddles))
        rule.unsupported = 'lands on another day in your time zone';
      if (rule.unsupported) item.flags.push('Repeats in a way the app can’t (' + rule.unsupported + '): only its first date is added.');
      else series(item, body, rule, start, shift, ev, overrides.get(ev.uid) || [], zone, today);
    }
    item.body = body;
    if (item.status === 'new' && body.repeat === 'none') {
      if (body.date < today || (body.date === today && body.time && body.time <= now)) item.status = 'past';
    }
    item.when = body.date;
    // A duplicate: same title, time and day as one you have (or as an earlier event here).
    const sig = body.text.toLowerCase() + '|' + (body.time || '') + '|' + body.date;
    if (seen.has(sig)) item.dup = 'file';
    seen.add(sig);
    const mine = existing.find(
      (r) =>
        String(r.text || '').trim().toLowerCase() === body.text.toLowerCase() &&
        (r.time || '').slice(0, 5) === (body.time || '') &&
        occursOn(r, body.date)
    );
    if (mine) item.dup = 'existing';
  });
  return out;
}

/* A repeating event: fills body's rule, moves a past start to the next
   occurrence, and lists the skips. Marks the item 'ended' when nothing is left. */
function series(item, body, rule, start, shift, ev, overridden, zone, today) {
  const anchor = anchorFor(rule, start.date);
  if (!anchor) {
    Object.assign(item, { status: 'bad', reason: 'The repeat never lands on a date.' });
    return;
  }
  // A by-date rule keeps its day: a clamped 30th must not become the anchor of a 31st series.
  if ((rule.repeat === 'monthly' && !rule.nth) || rule.repeat === 'yearly') rule.monthDay = +anchor.slice(8);
  // RFC skips a month without the day; the app clamps. Same series otherwise, so say it.
  if (rule.repeat === 'monthly' && rule.monthDay > 28 && !rule.lastDay)
    item.flags.push('Months without day ' + rule.monthDay + ' get the last day instead.');
  Object.assign(body, {
    repeat: rule.repeat,
    date: anchor,
    repeatInterval: rule.interval > 1 ? rule.interval : null,
    repeatDays: rule.days && rule.days.length ? shiftDays(rule.days, shift).join(',') : null,
    repeatNth: rule.nth || null,
    repeatCount: null,
  });
  if (rule.until) {
    const u = readTime({ value: rule.until, params: /Z$/.test(rule.until) ? {} : ev.start.params }, zone);
    // A UTC UNTIL can land before the start time on its local day: that day's occurrence is past it.
    if (u) body.until = u.time && start.time && u.time < start.time ? keyOfDay(epochDay(u.date) - 1) : u.date;
  }
  if (rule.count) {
    if (rule.count > 999) item.flags.push('Ends after 999 times here (the file says ' + rule.count + ').');
    body.repeatCount = Math.min(rule.count, 999);
  }
  // The rule as recurrence.js reads it, to walk it.
  const rem = { ...body, skip: [] };
  const occurs = (k) => occursOn(rem, k);
  const exdates = ev.exdates.map((x) => readTime(x, zone)).filter(Boolean).map((t) => t.date).concat(overridden);
  const from = Math.max(epochDay(anchor), epochDay(today));
  let next = null;
  for (let e = from; e < from + 366 * 5; e++) {
    const k = keyOfDay(e);
    if (rule.monthDay && +k.slice(8) !== rule.monthDay) continue; // a clamped day can't anchor a by-date rule
    if (occurs(k) && !exdates.includes(k)) {
      next = k;
      break;
    }
  }
  if (!next) {
    Object.assign(item, { status: 'ended', reason: 'The series has ended.' });
    return;
  }
  // The app's clamp needs a real day-31 (Feb 29) anchor, so a last-day series can't start on a
  // shorter month's end: say which month-ends it misses. ponytail: flagged, not added; a one-off
  // per missed date is the upgrade.
  const begin = keyOfDay(Math.max(epochDay(start.date), epochDay(today)));
  if (rule.lastDay && next.slice(0, 7) !== begin.slice(0, 7))
    item.flags.push('Starts on ' + next + ' here: the app can only start a last-day repeat on day ' + rule.monthDay + ', so the month-ends before it are left out.');
  if (next !== anchor) {
    if (body.repeatCount) {
      let used = 0;
      for (let e = epochDay(anchor); e < epochDay(next); e++) if (occurs(keyOfDay(e))) used++;
      body.repeatCount -= used;
    }
    body.date = next;
  }
  item.skips = [...new Set(exdates)].filter((k) => k > body.date && occursOn({ ...body, skip: [] }, k)).sort().slice(0, 50);
}
