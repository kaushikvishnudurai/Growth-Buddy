/* =====================================================================
   Growth Buddy — the two import dialogs

   Money's "Import from CSV" and the Calendar's "Import .ics". Each is pick
   (or paste) → preview with ticks → save, with progress. The reading is in
   csv-import.js / ics-import.js (DOM-free, tested); this is only the sheet.
   Lazy: money.js imports it, and app.js loads it on tap, so neither dialog
   is in the boot chunk.

   Money saves through the `save` it is handed (app.js saveMoney: ledger
   diff → POST /api/money/tx, pending queue, idempotency key), one batch at
   a time, waiting on `settled()` between batches so a 5,000-row file is
   several ordinary saves rather than one the server refuses (2,000 a POST).
   Reminders are POSTed one by one in small parallel groups; whatever saved
   stays, and what didn't is named.
   ===================================================================== */

import { h, openOverlay, refreshIcons } from './gb-kit.js';
import { toast } from './toast.js';
import { mergedCats, predictCategory, fmt, fmtDateShort, uid } from './money-core.js';
import { detect, readRows, markDuplicates, ROLES } from './csv-import.js';
import { parseIcs, toReminders } from './ics-import.js';
import { describeRepeat } from './calendar.js';

const LIST_MAX = 50;
const BATCH = 500;
const plural = (n, one, many) => n.toLocaleString('en-IN') + ' ' + (n === 1 ? one : many || one + 's');
const offlineText = 'You’re offline. Nothing was imported: try again once you’re connected.';

/* Title, scrolling body, primary + secondary under it, Cancel. The body and the
   buttons are handed back so a step can swap what the sheet shows. */
function shell(title, sub) {
  const { sheet, close } = openOverlay({ label: title, className: 'gb-import-modal' });
  const body = h('div', { class: 'gb-modal-body gb-import' });
  const primary = h('button', { type: 'button', class: 'gb-btn gb-btn--primary gb-import-primary' });
  const secondary = h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-import-secondary' });
  const cancel = h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close }, 'Cancel');
  sheet.append(
    h('div', { class: 'gb-modal-head' }, h('div', { class: 'gb-modal-title' }, title), h('div', { class: 'gb-modal-sub' }, sub)),
    body,
    primary,
    secondary,
    cancel
  );
  const set = (btn, label, onclick) => {
    btn.hidden = !label;
    btn.textContent = label || '';
    btn.onclick = onclick || null;
  };
  return {
    sheet,
    close,
    cancel,
    // Native replaceChildren writes a null argument out as the text "null".
    show: (...nodes) => body.replaceChildren(...nodes.filter(Boolean)),
    setPrimary: (label, onclick, disabled) => {
      set(primary, label, onclick);
      primary.disabled = !!disabled;
    },
    setSecondary: (label, onclick) => set(secondary, label, onclick),
    busy: (on) => {
      primary.disabled = on;
      secondary.disabled = on;
    },
  };
}

function fileField(label, accept, onText) {
  const id = 'gb-import-file-' + uid();
  const input = h('input', { type: 'file', id, class: 'gb-input gb-import-file', accept });
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => onText(String(reader.result || ''), f.name);
    reader.onerror = () => onText(null, f.name);
    reader.readAsText(f);
  });
  return [h('label', { class: 'gb-field-label', for: id }, label), input];
}

function status() {
  return h('p', { class: 'gb-import-status', role: 'status', 'aria-live': 'polite' });
}
function sayError(el, msg) {
  el.textContent = msg;
  el.classList.add('is-error');
}
function say(el, msg) {
  el.textContent = msg;
  el.classList.remove('is-error');
}

/* One preview row: a real checkbox in a label, so the whole row toggles it. */
function tickRow(checked, title, detail, onChange, extraClass) {
  const box = h('input', {
    type: 'checkbox',
    class: 'gb-qa-check',
    checked,
    onchange: (e) => onChange(e.target.checked),
  });
  return h(
    'label',
    { class: 'gb-qa-row gb-import-row' + (extraClass ? ' ' + extraClass : '') },
    box,
    h('span', { class: 'gb-qa-copy' }, h('strong', null, title), h('span', null, detail))
  );
}

function section(label, children) {
  return h('div', { class: 'gb-import-sec' }, h('div', { class: 'gb-field-label' }, label), children);
}

function progressBar(max) {
  return h('progress', { class: 'gb-import-progress', max: Math.max(1, max), value: 0, 'aria-label': 'Progress' });
}

/* ===================================================================
   Money: CSV
   =================================================================== */

/**
 * `money` the document the screen holds, `known` the same plus any "Load older"
 * pages (duplicates are looked for in both), `save(next, base)` = onSaveMoney,
 * `settled()` resolves once the save queue is idle: true when nothing is left
 * unsent.
 */
export function openCsvImport({ money, known, save, settled }) {
  const ui = shell('Import from CSV', 'From another money app, a bank statement or a spreadsheet. You check everything before it’s saved.');
  const cats = mergedCats(money);
  const catByText = new Map();
  for (const c of cats) {
    catByText.set(c.key.toLowerCase(), c.key);
    catByText.set(c.label.toLowerCase(), c.key);
  }
  const catLabel = new Map(cats.map((c) => [c.key, c.label]));
  const accounts = new Map(
    (money.accounts || []).filter((a) => !a.archived).map((a) => [String(a.name).trim().toLowerCase(), a.id])
  );
  const guessMemo = new Map();
  const guess = (raw, note) => {
    const k = raw.toLowerCase() + '|' + note.toLowerCase();
    if (!guessMemo.has(k))
      guessMemo.set(
        k,
        catByText.get(raw.trim().toLowerCase()) || predictCategory((raw + ' ' + note).trim(), money.expenses, cats) || 'others'
      );
    return guessMemo.get(k);
  };

  let det = null;
  let read = null;
  const off = new Set(); // ids the user unticked (or duplicates left unticked)
  const on = new Set(); // duplicates the user ticked

  const picked = (e) => (e.dup ? on.has(e.id) : !off.has(e.id));

  function source(initialError) {
    const msg = status();
    const paste = h('textarea', {
      id: 'gb-import-paste',
      class: 'gb-input gb-import-paste',
      rows: 5,
      spellcheck: false,
      placeholder: 'Date, Description, Amount\n12/10/2026, Lunch, 250',
    });
    const go = (text, name) => {
      if (text === null) return sayError(msg, 'Couldn’t read ' + name + '.');
      try {
        det = detect(text);
      } catch (err) {
        return sayError(msg, err.message);
      }
      off.clear();
      on.clear();
      preview();
    };
    ui.show(
      ...fileField('Choose a CSV file', '.csv,text/csv,text/plain', go),
      h('label', { class: 'gb-field-label', for: 'gb-import-paste' }, 'Or paste rows from a sheet'),
      paste,
      msg
    );
    if (initialError) sayError(msg, initialError);
    ui.setPrimary('Preview', () => {
      if (!paste.value.trim()) return sayError(msg, 'Choose a file or paste some rows first.');
      go(paste.value);
    });
    ui.setSecondary(null);
  }

  function entryLine(e) {
    const cat = e.kind === 'income' ? 'Income' : catLabel.get(guess(e.category, e.note)) || 'Others';
    return fmtDateShort(e.date) + ' · ' + cat + ' · ' + (e.kind === 'income' ? '+' : '') + fmt(e.amount);
  }

  function preview() {
    read = readRows(det.rows, det.roles, det.firstLine);
    markDuplicates(read.entries, known || money);
    const fresh = read.entries.filter((e) => !e.dup);
    const dups = read.entries.filter((e) => e.dup);
    const count = () => read.entries.filter(picked).length;
    const summary = h('p', { class: 'gb-import-summary', 'aria-live': 'polite' });
    const msg = status();
    const paint = () => {
      const n = count();
      summary.textContent =
        plural(det.rows.length, 'row') +
        ' found. ' +
        plural(n, 'transaction') +
        ' to import' +
        (dups.length ? ', ' + plural(dups.length, 'duplicate') + ' left out' : '') +
        (read.errors.length ? ', ' + plural(read.errors.length, 'row') + ' can’t be read' : '') +
        '.';
      ui.setPrimary(n ? 'Import ' + plural(n, 'transaction') : 'Nothing to import', () => run(msg), !n);
    };

    const width = det.roles.length;
    const sample = (i) => {
      const r = det.rows.find((row) => row[i] && String(row[i]).trim());
      return r ? String(r[i]).trim().slice(0, 40) : '';
    };
    const columns = h(
      'div',
      { class: 'gb-import-cols' },
      Array.from({ length: width }, (_, i) => {
        const name = (det.header && det.header[i] && String(det.header[i]).trim()) || 'Column ' + (i + 1);
        const id = 'gb-import-col-' + i;
        const sel = h(
          'select',
          {
            id,
            class: 'gb-input gb-input--inline',
            onchange: (e) => {
              const role = e.target.value;
              // One column per role: the one it replaces goes back to "Not used".
              if (role !== 'ignore') det.roles = det.roles.map((r, j) => (j !== i && r === role ? 'ignore' : r));
              det.roles[i] = role;
              preview();
            },
          },
          Object.entries(ROLES).map(([k, label]) => h('option', { value: k, selected: det.roles[i] === k }, label))
        );
        return h(
          'div',
          { class: 'gb-import-col' },
          h('label', { for: id, class: 'gb-import-col-name' }, h('strong', null, name), h('span', null, sample(i))),
          sel
        );
      })
    );

    const first = fresh.slice(0, 10).map((e) =>
      tickRow(!off.has(e.id), e.note || (e.kind === 'income' ? 'Income' : 'Expense'), entryLine(e), (v) => {
        if (v) off.delete(e.id);
        else off.add(e.id);
        paint();
      })
    );
    const dupRows = dups.slice(0, LIST_MAX).map((e) =>
      tickRow(
        on.has(e.id),
        e.note || (e.kind === 'income' ? 'Income' : 'Expense'),
        entryLine(e) + (e.dup === 'existing' ? ' · already in Money' : ' · repeated in this file'),
        (v) => {
          if (v) on.add(e.id);
          else on.delete(e.id);
          paint();
        }
      )
    );
    const errRows = read.errors.slice(0, LIST_MAX).map((x) =>
      h('li', null, (x.line ? 'Line ' + x.line + ': ' : '') + x.reason)
    );
    const more = (list, shown) => (list.length > shown ? h('p', { class: 'gb-field-hint' }, 'and ' + plural(list.length - shown, 'more') + '.') : null);

    ui.show(
      summary,
      section('Columns', [h('p', { class: 'gb-field-hint' }, 'Worked out from the file. Change any that look wrong.'), columns]),
      fresh.length
        ? section(fresh.length > 10 ? 'First 10 of ' + plural(fresh.length, 'row') : 'Rows', [h('div', { class: 'gb-qa-preview' }, first)])
        : null,
      dups.length
        ? section('Duplicates, not ticked', [h('div', { class: 'gb-qa-preview' }, dupRows), more(dups, LIST_MAX)])
        : null,
      read.errors.length ? section('Can’t be read', [h('ul', { class: 'gb-import-errors' }, errRows), more(read.errors, LIST_MAX)]) : null,
      msg
    );
    ui.setSecondary('Back', () => source());
    paint();
  }

  async function run(msg) {
    if (!navigator.onLine) return sayError(msg, offlineText);
    const chosen = read.entries.filter(picked);
    const now = Date.now();
    const rows = chosen.map((e, i) => {
      const accountId = accounts.get(e.account.toLowerCase());
      if (e.kind === 'income')
        return {
          list: 'income',
          item: {
            id: e.id,
            amount: e.amount,
            source: /salary|payroll|wage/i.test(e.category + ' ' + e.note) ? 'salary' : 'other',
            label: e.note || e.category || 'Income',
            date: e.date,
            ...(accountId ? { accountId } : {}),
          },
        };
      return {
        list: 'expenses',
        item: {
          id: e.id,
          amount: e.amount,
          category: guess(e.category, e.note),
          note: e.note,
          date: e.date,
          createdAt: now + i,
          ...(accountId ? { accountId } : {}),
        },
      };
    });
    const bar = progressBar(rows.length);
    ui.show(h('p', { class: 'gb-import-summary' }, 'Importing ' + plural(rows.length, 'transaction') + '…'), bar, msg);
    ui.busy(true);
    ui.setPrimary(null);
    ui.setSecondary(null);
    ui.cancel.disabled = true;
    let base = money;
    let done = 0;
    let synced = true;
    for (let i = 0; i < rows.length; i += BATCH) {
      const part = rows.slice(i, i + BATCH);
      const next = Object.assign({}, base, {
        expenses: base.expenses.concat(part.filter((r) => r.list === 'expenses').map((r) => r.item)),
        income: base.income.concat(part.filter((r) => r.list === 'income').map((r) => r.item)),
      });
      save(next, base);
      base = next;
      done += part.length;
      synced = await settled();
      bar.value = done;
      say(msg, 'Imported ' + done.toLocaleString('en-IN') + ' of ' + rows.length.toLocaleString('en-IN') + '.');
      if (!synced || !navigator.onLine) break;
    }
    ui.cancel.disabled = false;
    if (done === rows.length && synced) {
      ui.close();
      toast.success('Imported ' + plural(done, 'transaction') + '.');
      return;
    }
    // Offline or the server down partway: what was handed over is on this phone and
    // syncs by itself; the rest was never sent. Ids are stable, so importing the same
    // file again skips what is already in.
    ui.busy(false);
    sayError(
      msg,
      'The connection dropped after ' +
        plural(done, 'transaction') +
        '. Those are saved on this phone and will sync. ' +
        (rows.length - done
          ? (rows.length - done).toLocaleString('en-IN') +
            ' more ' +
            (rows.length - done === 1 ? 'was' : 'were') +
            ' not imported: import the same file again later and what’s already in is skipped.'
          : '')
    );
    ui.setPrimary('Close', ui.close);
  }

  source();
  refreshIcons();
}

/* ===================================================================
   Calendar: .ics
   =================================================================== */

/**
 * `api(path, options)` = app.js's fetch wrapper, `existing` = the user's
 * reminders (for duplicates), `zone` = their time zone, `onDone()` reloads the
 * reminders once anything was added.
 */
export function openIcsImport({ api, existing, zone, today, now, onDone }) {
  const ui = shell('Import a calendar', 'An .ics file from Google, Apple or Outlook Calendar. Events become reminders at your local time.');
  let items = [];
  const chosen = new Set();

  function source(initialError) {
    const msg = status();
    ui.show(
      ...fileField('Choose an .ics file', '.ics,text/calendar', (text, name) => {
        if (text === null) return sayError(msg, 'Couldn’t read ' + name + '.');
        try {
          items = toReminders(parseIcs(text), { zone, today: today(), now: now(), existing });
        } catch (err) {
          return sayError(msg, err.message);
        }
        chosen.clear();
        for (const i of items) if (i.status === 'new' && !i.dup) chosen.add(i.key);
        preview();
      }),
      h('p', { class: 'gb-field-hint' }, 'In Google Calendar: Settings → Import & export → Export. Repeats, alerts and notes come along.'),
      msg
    );
    if (initialError) sayError(msg, initialError);
    ui.setPrimary(null);
    ui.setSecondary(null);
  }

  const detail = (i) => {
    const b = i.body;
    return [
      fmtDateShort(b.date) + (b.time ? ' ' + b.time + (b.endTime ? '–' + b.endTime : '') : ', all day'),
      describeRepeat(b),
      i.dup === 'existing' ? 'already in your calendar' : i.dup === 'file' ? 'repeated in this file' : '',
      ...i.flags,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  function preview() {
    const add = items.filter((i) => i.status === 'new');
    const past = items.filter((i) => i.status === 'past');
    const ended = items.filter((i) => i.status === 'ended');
    const bad = items.filter((i) => i.status === 'bad');
    const summary = h('p', { class: 'gb-import-summary', 'aria-live': 'polite' });
    const msg = status();
    const paint = () => {
      const n = chosen.size;
      summary.textContent =
        plural(items.length, 'event') + ' in the file. ' + plural(n, 'reminder') + ' to add.';
      ui.setPrimary(n ? 'Add ' + plural(n, 'reminder') : 'Nothing to add', () => run(msg), !n);
    };
    const rows = add.map((i) =>
      tickRow(
        chosen.has(i.key),
        i.title,
        detail(i),
        (v) => {
          if (v) chosen.add(i.key);
          else chosen.delete(i.key);
          paint();
        },
        i.flags.length ? 'is-flagged' : ''
      )
    );
    const left = [
      past.length ? plural(past.length, 'past event') + ' (reminders are for today and later)' : '',
      ended.length ? plural(ended.length, 'series that ended', 'series that ended') : '',
      bad.length ? plural(bad.length, 'event') + ' that can’t be read' : '',
    ].filter(Boolean);
    const leftList = past
      .concat(ended, bad)
      .slice(0, LIST_MAX)
      .map((i) => h('li', null, i.title + (i.body ? ' · ' + fmtDateShort(i.body.date) : '') + (i.reason ? ': ' + i.reason : '')));
    ui.show(
      summary,
      add.length
        ? section('To add', [h('div', { class: 'gb-qa-preview' }, rows)])
        : h('p', { class: 'gb-field-hint' }, 'Nothing in this file is today or later.'),
      left.length
        ? h(
            'details',
            { class: 'gb-import-left' },
            h('summary', null, 'Left out: ' + left.join(', ')),
            h('ul', { class: 'gb-import-errors' }, leftList)
          )
        : null,
      msg
    );
    ui.setSecondary('Choose another file', () => source());
    paint();
  }

  async function run(msg) {
    if (!navigator.onLine) return sayError(msg, offlineText.replace('imported', 'added'));
    const todo = items.filter((i) => chosen.has(i.key));
    const bar = progressBar(todo.length);
    ui.show(h('p', { class: 'gb-import-summary' }, 'Adding ' + plural(todo.length, 'reminder') + '…'), bar, msg);
    ui.busy(true);
    ui.setPrimary(null);
    ui.setSecondary(null);
    ui.cancel.disabled = true;
    const failed = [];
    let added = 0;
    const one = async (i) => {
      let created;
      try {
        created = await api('/api/reminders', {
          method: 'POST',
          body: JSON.stringify(i.body),
        });
      } catch (err) {
        failed.push({ title: i.title, reason: (err && err.message) || 'Not saved.' });
        return;
      }
      added++;
      // EXDATE: the series is made, then those days are taken out of it.
      for (const day of i.skips) {
        try {
          await api('/api/reminders/' + created.id + '?scope=this&date=' + day, { method: 'DELETE' });
        } catch (_err) {
          failed.push({ title: i.title, reason: 'Added, but ' + fmtDateShort(day) + ' could not be skipped.' });
        }
      }
    };
    // ponytail: 4 at a time, sequential groups. Enough for a calendar's worth; no queue.
    for (let k = 0; k < todo.length; k += 4) {
      await Promise.all(todo.slice(k, k + 4).map(one));
      bar.value = Math.min(k + 4, todo.length);
      say(msg, 'Added ' + added + ' of ' + todo.length + '.');
    }
    ui.cancel.disabled = false;
    if (added) await Promise.resolve(onDone()).catch(() => {});
    if (!failed.length) {
      ui.close();
      toast.success('Added ' + plural(added, 'reminder') + '.');
      return;
    }
    ui.busy(false);
    ui.show(
      h('p', { class: 'gb-import-summary' }, 'Added ' + added + ' of ' + todo.length + '. ' + plural(failed.length, 'problem') + ':'),
      h('ul', { class: 'gb-import-errors' }, failed.slice(0, LIST_MAX).map((f) => h('li', null, f.title + ': ' + f.reason)))
    );
    ui.setPrimary('Close', ui.close);
  }

  source();
  refreshIcons();
}

