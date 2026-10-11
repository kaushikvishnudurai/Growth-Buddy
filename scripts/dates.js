/* Local-day keys ("YYYY-MM-DD" in the device's zone), shared by every module
   that used to carry its own copy. Pure, no imports, so node tests load it.
   Not here, on purpose: goals.js `todayKey` (the ACCOUNT's zone, not the
   device's), the UTC day-number walkers in review.js / insights.js (`dayKey`,
   DST-proof arithmetic), and the two `relativeTime`s (app.js and notes.js round
   and format the date differently). */
export function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/** Key from y / m (0-11) / d. */
export function dateKey(y, m, d) {
  return y + '-' + pad2(m + 1) + '-' + pad2(d);
}

/** Local key of a Date or an instant. */
export function localKey(d) {
  const t = d instanceof Date ? d : new Date(d);
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
}

export function todayKey() {
  return localKey(new Date());
}

/* ---- "Call plumber tomorrow 5pm": the when inside a title ----
   The words a task's title can carry for its due time, read the way Quick add's
   plain patterns read a reminder (QuickAddFallback DAY / AT_TIME / IN_TIME /
   NAMED_TIME): today, tonight, tomorrow, a weekday ("next" = the one after this
   week's), "at 5pm", "17:30", "in 2 hours", morning / noon / evening. A bare
   "at 5" with no am/pm is 17:00 for hours 1-7: nobody's task is due at 5 am.
   A day alone is due 18:00 (23:59 when that has gone today); a time alone is
   today, or tomorrow once it has passed. Checked by `node scripts/when.test.mjs`. */
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const IN_RE = /\bin\s+(\d{1,3}|an?|half\s+an)\s*(min|mins|minutes?|h|hrs?|hours?)\b/i;
const DAY_RE =
  /\b(?:(?:by|on|due)\s+)?(today|tonight|tomorrow|tmrw|tmr|day\s+after\s+tomorrow|(?:(next|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i;
const TIME_RE =
  /\b(?:(?:at|by)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s|$|[,.])|\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\b|\b(\d{1,2}):(\d{2})\b/i;
const NAMED_RE = /\b(?:in\s+the\s+|this\s+)?(morning|noon|afternoon|evening|night)\b/i;
const NAMED_AT = { morning: 540, noon: 720, afternoon: 900, evening: 1080, night: 1200 };

/**
 * @param {string} text  a title as typed
 * @param {Date} now
 * @returns {{at: Date, rest: string, phrase: string} | null} the due instant, the
 *   title without the when words, and those words as typed; null when there are none.
 */
export function parseWhen(text, now = new Date()) {
  let s = ' ' + String(text || '') + ' ';
  const said = [];
  const cut = (m) => {
    said.push(m[0].trim());
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
  };
  let dayOffset = null;
  let min = null;
  let m;
  if ((m = IN_RE.exec(s))) {
    const n = /^half/i.test(m[1]) ? 0.5 : /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
    const at = new Date(now.getTime() + n * (/^h/i.test(m[2]) ? 60 : 1) * 60000);
    at.setSeconds(0, 0);
    cut(m);
    return finish(at);
  }
  if ((m = DAY_RE.exec(s))) {
    const d = m[1].toLowerCase();
    if (d === 'today') dayOffset = 0;
    else if (d === 'tonight') {
      dayOffset = 0;
      min = NAMED_AT.night;
    } else if (d.startsWith('day')) dayOffset = 2;
    else if (d.startsWith('t') && !m[3]) dayOffset = 1;
    else {
      const diff = (WEEKDAYS.indexOf(m[3].toLowerCase()) - now.getDay() + 7) % 7;
      dayOffset = m[2] && m[2].toLowerCase() === 'next' && diff === 0 ? 7 : diff;
    }
    cut(m);
  }
  if ((m = TIME_RE.exec(s))) {
    let hh;
    let mm;
    if (m[1]) {
      hh = Number(m[1]) % 12 + (/^p/i.test(m[3]) ? 12 : 0);
      mm = Number(m[2] || 0);
    } else if (m[4]) {
      hh = Number(m[4]);
      mm = Number(m[5] || 0);
      if (hh >= 1 && hh <= 7 && !m[5]) hh += 12;
    } else {
      hh = Number(m[6]);
      mm = Number(m[7]);
    }
    if (hh <= 23 && mm <= 59) {
      min = hh * 60 + mm;
      cut(m);
    }
  } else if (min === null && (m = NAMED_RE.exec(s))) {
    min = NAMED_AT[m[1].toLowerCase()];
    cut(m);
  }
  if (dayOffset === null && min === null) return null;
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (dayOffset || 0));
  if (min === null) min = 18 * 60;
  at.setMinutes(min);
  if (at <= now) {
    if (dayOffset === null) at.setDate(at.getDate() + 1); // "at 9am", said at noon: tomorrow
    else if (dayOffset === 0 && !said.some((w) => TIME_RE.test(w) || NAMED_RE.test(w)))
      at.setHours(23, 59); // "today", said in the evening: by the end of it
  }
  return finish(at);

  function finish(at) {
    const rest = s
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s+(?:by|on|at|due)$/i, '')
      .trim();
    return rest ? { at, rest, phrase: said.join(' ') } : null;
  }
}
