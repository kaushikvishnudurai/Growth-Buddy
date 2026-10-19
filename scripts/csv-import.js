/* =====================================================================
   Growth Buddy — reading another app's CSV into Money

   DOM-free, so `scripts/csv-import.test.mjs` can run it under node. The
   dialog (import-ui.js) shows what this works out and saves through the
   normal ledger path; nothing here writes anything.

   What it reads: an RFC 4180 table (quoted fields, "" inside quotes,
   newlines inside quotes, CRLF / LF / CR), split by a comma, semicolon or
   tab, with or without a header row, with preamble lines above the header
   (bank statements open with the account holder's details). Amounts with
   currency symbols, Indian grouping (1,23,456.00), European decimals
   (1.234,56), brackets or a trailing Dr/Cr for the sign. Dates in
   DD/MM/YYYY, DD-MM-YY, YYYY-MM-DD, "12 Oct 2026", "Oct 12, 2026";
   day-first unless a column proves it is month-first. Our own `ledgerCsv`
   export reads back as it was written.
   ===================================================================== */

export const MAX_ROWS = 10_000;
/** Same cap as MoneyLedger.EXPENSE_MAX: the server refuses a bigger expense. */
export const EXPENSE_MAX = 10_000_000;
/** MoneyLedger.MAX_AMOUNT: the cap on any amount, income included. */
export const INCOME_MAX = 1_000_000_000;

/** What a column can be. `ignore` is everything else (balance, cheque number…). */
export const ROLES = {
  date: 'Date',
  amount: 'Amount',
  debit: 'Money out',
  credit: 'Money in',
  note: 'Description',
  category: 'Category',
  type: 'Type (expense / income)',
  account: 'Account',
  ignore: 'Not used',
};

/* ---- The table ---- */

/** RFC 4180 rows. A BOM is dropped; blank lines (and lines of only delimiters, Excel's `,,,`) are dropped. Each row carries
    `.line`, the 1-based line of the file it starts on, for the preview. */
export function parseCsv(text, delim = ',') {
  const s = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  let line = 1;
  let start = 1;
  const endRow = () => {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) {
      row.line = start;
      rows.push(row);
    }
    row = [];
    field = '';
  };
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        if (c === '\n' || (c === '\r' && s[i + 1] !== '\n')) line++;
        field += c;
      }
      i++;
      continue;
    }
    if (c === '"' && field.trim() === '') {
      // A quote opens a field only at its start; one mid-field is a literal.
      quoted = true;
      field = '';
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\r' || c === '\n') {
      endRow();
      if (c === '\r' && s[i + 1] === '\n') i++;
      start = ++line;
    } else field += c;
    i++;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

/** The delimiter that splits the first lines most consistently. Quotes are skipped. */
export function sniffDelimiter(text) {
  const lines = String(text || '')
    .replace(/"[^"]*"/g, '""')
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim())
    .slice(0, 20);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const tail = counts.slice(-Math.min(counts.length, 10)); // past any preamble
    const most = Math.max(0, ...tail);
    if (!most) continue;
    const agree = tail.filter((c) => c === most).length;
    const score = agree * 100 + most;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/* ---- Values ---- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n) => String(n).padStart(2, '0');

function validDate(y, m, d) {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1)) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return y + '-' + pad(m) + '-' + pad(d);
}
function fullYear(y) {
  if (y >= 100) return y;
  const nowYY = new Date().getFullYear() % 100;
  return y <= nowYY + 1 ? 2000 + y : 1900 + y;
}

/** The two leading numbers of a numeric date ("12/10/2026" → [12, 10]), or null. */
function numericParts(s) {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T,].*)?$/.exec(String(s).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 'dmy' (the default: India) unless a value only reads month-first. */
export function dateOrder(values) {
  let dayFirst = false;
  let monthFirst = false;
  for (const v of values) {
    const p = numericParts(v);
    if (!p) continue;
    if (p[0] > 12) dayFirst = true;
    if (p[1] > 12) monthFirst = true;
  }
  return monthFirst && !dayFirst ? 'mdy' : 'dmy';
}

/** 'YYYY-MM-DD' or null. A time after the date is ignored. */
export function parseDate(raw, order = 'dmy') {
  const s = String(raw || '').trim().replace(/^'/, '');
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  const p = numericParts(s);
  if (p) {
    const y = fullYear(p[2]);
    return order === 'mdy' ? validDate(y, p[0], p[1]) : validDate(y, p[1], p[0]);
  }
  // 12 Oct 2026, 12-Oct-26, 12 October 2026, Oct 12, 2026, October 12 2026
  m = /^(\d{1,2})[\s/-]+([a-z]{3,9})\.?[\s/,-]+(\d{2}|\d{4})\b/i.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mo < 0 ? null : validDate(fullYear(+m[3]), mo + 1, +m[1]);
  }
  m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})\b/i.exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mo < 0 ? null : validDate(fullYear(+m[3]), mo + 1, +m[2]);
  }
  return null;
}

/** 'comma' when the column writes decimals with a comma (1.234,56), else 'dot'. */
export function decimalStyle(values) {
  let comma = 0;
  let dot = 0;
  for (const v of values) {
    const s = String(v || '').replace(/[^\d.,]/g, '');
    if (/\.\d{3},\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) comma++;
    else if (/,\d{2,3}\.\d{1,2}$/.test(s) || /^\d+\.\d{1,2}$/.test(s)) dot++;
  }
  return comma > dot ? 'comma' : 'dot';
}

/** A signed number, or null. `(12.50)`, `-12.50`, `12.50 Dr` are negative; `Cr` is positive. */
export function parseAmount(raw, style = 'dot') {
  let s = String(raw == null ? '' : raw).trim().replace(/^'/, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  const drcr = /\s*(dr|cr)\.?$/i.exec(s);
  if (drcr) {
    if (drcr[1].toLowerCase() === 'dr') neg = true;
    s = s.slice(0, drcr.index);
  }
  // Currency words and symbols, either side, and spaces (incl. NBSP / thin) between groups.
  s = s.replace(/(inr|rs|usd|eur|gbp|aed)\.?/gi, '').replace(/[₹$€£¥\s\u00a0\u202f]/g, '');
  if (/^[-−–]/.test(s)) {
    neg = !neg;
    s = s.slice(1);
  } else if (/-$/.test(s)) {
    neg = !neg;
    s = s.slice(0, -1);
  } else if (/^\+/.test(s)) s = s.slice(1);
  if (style === 'comma') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/* ---- Columns ---- */

// First match wins, so the narrower names come before the broad ones
// ("value date" before "value", "closing balance" before everything).
const HEADER_RULES = [
  ['ignore', /balance|ref(erence)?\s*no|cheque|chq|^ref$|^s\.?\s*no|^sr|^#$|original/],
  // Before debit / credit: "Debit/Credit" names the kind, not an amount.
  ['type', /^type$|transaction type|^kind$|(dr|debit)\s*\/\s*(cr|credit)|(cr|credit)\s*\/\s*(dr|debit)|income\s*\/\s*expense|^direction$/],
  ['debit', /debit|withdraw|paid out|money out|^dr$|outflow|spent|^expenses?$/],
  ['credit', /credit|deposit|paid in|money in|^cr$|inflow|received|^income$/],
  ['date', /date|^day$|^when$|^dt$|posted/],
  ['amount', /amount|^amt|^value$|^sum$|^price$|^cost$|^total$/],
  ['category', /categor|^tag|^group$|^head$/],
  ['account', /account|wallet|payment mode|^mode$|paid (from|with)|^method$/],
  ['note', /note|desc|narration|detail|remark|memo|particular|^title$|^name$|payee|merchant|^item|purpose/],
];

function headerRole(name) {
  const n = String(name || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z/.#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) return null;
  for (const [role, re] of HEADER_RULES) if (re.test(n)) return role;
  return null;
}

/** Index of the header row among the first lines (bank preamble above it), or -1 for none. */
function findHeader(table) {
  const limit = Math.min(table.length, 30);
  for (let r = 0; r < limit; r++) {
    const roles = table[r].map(headerRole).filter((x) => x && x !== 'ignore');
    const looksLikeData = table[r].some((c) => parseDate(c) || parseAmount(c) !== null);
    if (!looksLikeData && roles.length >= 2 && new Set(roles).size >= 2) return r;
  }
  // Names in no language we know: still a header when it holds no date or amount
  // and the row under it does.
  const has = (row) => row && row.some((c) => parseDate(c) || parseAmount(c) !== null);
  return table.length > 1 && !has(table[0]) && has(table[1]) ? 0 : -1;
}

/** One role per column. From the header names, then from the values for what is still missing. */
function detectColumns(header, rows) {
  // With a header, its width: a longer row is an error in readRows, not an extra column.
  const width = header ? header.length : Math.max(...rows.slice(0, 50).map((r) => r.length));
  const roles = new Array(width).fill('ignore');
  const taken = new Set();
  if (header) {
    header.forEach((name, i) => {
      const role = headerRole(name);
      if (role && (role === 'ignore' || !taken.has(role))) {
        roles[i] = role;
        if (role !== 'ignore') taken.add(role);
      }
    });
  }
  const sample = rows.slice(0, 200);
  const share = (i, test) => {
    const vals = sample.map((r) => r[i]).filter((v) => v != null && String(v).trim() !== '');
    return vals.length ? vals.filter(test).length / vals.length : 0;
  };
  const free = (i) => roles[i] === 'ignore' && !(header && headerRole(header[i]) === 'ignore');
  if (!taken.has('date')) {
    for (let i = 0; i < width; i++)
      if (free(i) && share(i, (v) => parseDate(v)) >= 0.6) {
        roles[i] = 'date';
        taken.add('date');
        break;
      }
  }
  if (!taken.has('amount') && !(taken.has('debit') || taken.has('credit'))) {
    for (let i = 0; i < width; i++)
      if (free(i) && share(i, (v) => !parseDate(v) && parseAmount(v) !== null) >= 0.6) {
        roles[i] = 'amount';
        taken.add('amount');
        break;
      }
  }
  if (!taken.has('type')) {
    for (let i = 0; i < width; i++)
      if (free(i) && share(i, (v) => INCOME_WORDS.test(v.trim()) || EXPENSE_WORDS.test(v.trim())) >= 0.9) {
        roles[i] = 'type';
        taken.add('type');
        break;
      }
  }
  if (!taken.has('note')) {
    let best = -1;
    let bestLen = 0;
    for (let i = 0; i < width; i++) {
      if (!free(i) || share(i, (v) => parseAmount(v) === null && !parseDate(v)) < 0.6) continue;
      const len = sample.reduce((a, r) => a + String(r[i] || '').length, 0);
      if (len > bestLen) {
        best = i;
        bestLen = len;
      }
    }
    if (best >= 0) roles[best] = 'note';
  }
  return roles;
}

/** Everything the dialog needs from the raw text. Throws a readable Error on input it can't use. */
export function detect(text) {
  const src = String(text || '');
  if (!src.trim()) throw new Error('The file is empty.');
  const head = src.trimStart().slice(0, 5);
  if (head.startsWith('PK\u0003\u0004') || head.startsWith('%PDF') || head.startsWith('{\\rtf') || src.includes('\u0000'))
    throw new Error('That isn’t a CSV file. Export or save it as CSV first (in Excel: File → Save As → CSV).');
  const delimiter = sniffDelimiter(src);
  const table = parseCsv(src, delimiter);
  const h = findHeader(table);
  const header = h >= 0 ? table[h] : null;
  const rows = table.slice(h + 1);
  if (!rows.length) throw new Error('There are no rows under the header.');
  if (rows.length > MAX_ROWS)
    throw new Error(
      'This file has ' +
        rows.length.toLocaleString('en-IN') +
        ' rows. Import up to ' +
        MAX_ROWS.toLocaleString('en-IN') +
        ' at a time: split it into smaller files and import each one.'
    );
  const roles = detectColumns(header, rows);
  return { delimiter, header, rows, roles, firstLine: rows[0].line };
}

/* ---- Rows ---- */

const INCOME_WORDS = /^(income|credit|cr|deposit|in|received|refund|salary|inflow|\+)$/i;
const EXPENSE_WORDS = /^(expense|debit|dr|withdrawal|out|spent|payment|purchase|outflow|-)$/i;

/* Our export defuses a leading = + - @ with a ' so a spreadsheet doesn't run it. */
const undefuse = (s) => String(s == null ? '' : s).trim().replace(/^'(?=[=+\-@])/, '');

/**
 * The rows as entries to save: `{line, kind: 'expense'|'income', date, amount (> 0),
 * note, category (as written), account (as written)}`, and the ones that can't be
 * read as `{line, reason}`. `line` is the 1-based line in the file, for the user.
 * `mixedSign` is true when the kind rests on the sign alone (one amount column, no
 * type column, both signs): `positiveIs` then says which way a plus goes — 'in' for
 * a bank statement, 'out' for a card export (purchase positive, payment negative).
 */
export function readRows(rows, roles, firstLine = 1, { positiveIs = 'in' } = {}) {
  const col = (role) => roles.indexOf(role);
  const c = {
    date: col('date'),
    amount: col('amount'),
    debit: col('debit'),
    credit: col('credit'),
    note: col('note'),
    category: col('category'),
    type: col('type'),
    account: col('account'),
  };
  const out = { entries: [], errors: [], mixedSign: false };
  if (c.date < 0) {
    out.errors.push({ line: 0, reason: 'No column is set as the date.' });
    return out;
  }
  if (c.amount < 0 && c.debit < 0 && c.credit < 0) {
    out.errors.push({ line: 0, reason: 'No column is set as the amount.' });
    return out;
  }
  const order = dateOrder(rows.map((r) => r[c.date]));
  const styleOf = (i) => (i < 0 ? 'dot' : decimalStyle(rows.slice(0, 500).map((r) => r[i])));
  const style = { amount: styleOf(c.amount), debit: styleOf(c.debit), credit: styleOf(c.credit) };
  // No type column and every amount positive: an expense tracker's export, all spending.
  // Mixed signs: a statement, where minus is money out (or a card, where plus is: positiveIs).
  let mixed = false;
  if (c.amount >= 0 && c.type < 0) {
    let pos = false;
    let neg = false;
    for (const r of rows) {
      const n = parseAmount(r[c.amount], style.amount);
      if (n > 0) pos = true;
      else if (n < 0) neg = true;
    }
    mixed = pos && neg;
  }
  out.mixedSign = mixed;
  rows.forEach((r, idx) => {
    const line = r.line || firstLine + idx;
    const cell = (i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    if (r.slice(roles.length).some((v) => String(v).trim())) {
      out.errors.push({ line, reason: 'This row has more columns than the header (an unquoted 1,234?).' });
      return;
    }
    const date = parseDate(cell(c.date), order);
    if (!date) {
      out.errors.push({ line, reason: cell(c.date) ? 'Can’t read the date “' + cell(c.date) + '”.' : 'No date.' });
      return;
    }
    let kind = null;
    let amount = null;
    const typeText = cell(c.type).toLowerCase();
    if (/^transfer|^move/.test(typeText)) {
      out.errors.push({ line, reason: 'Transfers between accounts aren’t imported.' });
      return;
    }
    const debit = c.debit >= 0 ? parseAmount(cell(c.debit), style.debit) : null;
    const credit = c.credit >= 0 ? parseAmount(cell(c.credit), style.credit) : null;
    if (debit) {
      kind = 'expense';
      amount = Math.abs(debit);
    } else if (credit) {
      kind = 'income';
      amount = Math.abs(credit);
    } else if (c.amount >= 0) {
      const n = parseAmount(cell(c.amount), style.amount);
      if (n !== null && n !== 0) {
        amount = Math.abs(n);
        if (INCOME_WORDS.test(typeText)) kind = 'income';
        else if (EXPENSE_WORDS.test(typeText)) kind = 'expense';
        else if (/cr\.?$/i.test(cell(c.amount))) kind = 'income'; // an explicit marker beats the sign guess
        else if (/dr\.?$/i.test(cell(c.amount))) kind = 'expense';
        else kind = mixed && (n > 0) === (positiveIs !== 'out') ? 'income' : 'expense';
      }
    }
    if (!kind) {
      const raw = cell(c.amount) || cell(c.debit) || cell(c.credit);
      out.errors.push({
        line,
        reason: raw && parseAmount(raw) === null ? 'Can’t read the amount “' + raw + '”.' : 'No amount.',
      });
      return;
    }
    amount = Math.round(amount * 100) / 100;
    if (!amount) {
      out.errors.push({ line, reason: 'The amount rounds to zero.' });
      return;
    }
    if (kind === 'expense' && amount > EXPENSE_MAX) {
      out.errors.push({ line, reason: 'An expense can be at most 10,000,000.' });
      return;
    }
    if (amount > INCOME_MAX) {
      out.errors.push({ line, reason: 'An amount can be at most 1,000,000,000.' });
      return;
    }
    out.entries.push({
      line,
      kind,
      date,
      amount,
      note: undefuse(cell(c.note)).slice(0, 255),
      category: undefuse(cell(c.category)),
      account: cell(c.account),
    });
  });
  return out;
}

/* ---- Duplicates and ids ---- */

const dupKey = (kind, date, amount, note) =>
  kind + '|' + date + '|' + Number(amount).toFixed(2) + '|' + String(note || '').trim().toLowerCase();

/**
 * Marks each entry `dup: 'existing'` (same date + amount + note as a transaction
 * already in Money) or `dup: 'file'` (a repeat of an earlier line in this file),
 * and gives it a stable `id`: the same file imported twice upserts the same rows
 * instead of doubling them.
 */
export function markDuplicates(entries, money) {
  const have = new Map(); // key -> how many Money already holds
  const add = (k) => have.set(k, (have.get(k) || 0) + 1);
  for (const e of (money && money.expenses) || []) add(dupKey('expense', e.date, e.amount, e.note));
  for (const i of (money && money.income) || []) add(dupKey('income', i.date, i.amount, i.label));
  const seen = new Map();
  for (const e of entries) {
    const k = dupKey(e.kind, e.date, e.amount, e.note);
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    const m = have.get(k) || 0;
    e.dup = m ? 'existing' : n ? 'file' : null;
    // A ticked 'existing' row is a second copy: the count keeps its id off the one already saved.
    e.id = 'csv-' + hash(k + '|' + n + (m ? '|' + m : ''));
  }
  return entries;
}

/* FNV-1a, two rounds for 64 bits' worth of base36. Ids only; not security. */
function hash(s) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
