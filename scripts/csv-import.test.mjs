/* Run: node scripts/csv-import.test.mjs

   csv-import.js: another app's CSV read into Money entries. Every format the
   import promises, our own export read back, and input it must refuse. */
import assert from 'node:assert/strict';
import {
  parseCsv,
  sniffDelimiter,
  parseDate,
  dateOrder,
  parseAmount,
  decimalStyle,
  detect,
  readRows,
  markDuplicates,
  MAX_ROWS,
} from './csv-import.js';
import { ledgerCsv } from './money.js';

const read = (text) => {
  const d = detect(text);
  return { d, ...readRows(d.rows, d.roles, d.firstLine) };
};

const plain = (rows) => rows.map((r) => [...r]);
// RFC 4180: quotes, "" inside quotes, a newline inside quotes, CRLF, a BOM, blank lines.
const t1 = parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\n"line\nbreak",2\nlast,1');
assert.deepEqual(plain(t1), [
  ['a', 'b'],
  ['x, y', 'say "hi"'],
  ['line\nbreak', '2'],
  ['last', '1'],
]);
assert.deepEqual(
  t1.map((r) => r.line),
  [1, 2, 4, 6],
  'each row knows its line in the file, past blank lines and quoted newlines'
);
assert.deepEqual(plain(parseCsv('a;b\n1;2', ';')), [['a', 'b'], ['1', '2']]);
assert.deepEqual(plain(parseCsv('a,b,\n')), [['a', 'b', '']], 'a trailing empty field stays');
assert.deepEqual(plain(parseCsv('a,5" pipe\n')), [['a', '5" pipe']], 'a quote mid-field is a literal');

// Delimiters.
assert.equal(sniffDelimiter('date,amount\n1,2'), ',');
assert.equal(sniffDelimiter('Datum;Betrag\n12.10.2026;1.234,56'), ';');
assert.equal(sniffDelimiter('date\tnote\tamount\n2026-10-01\tTea, sugar\t20'), '\t');
assert.equal(sniffDelimiter('"a;b",c\n"d;e",f'), ',', 'a delimiter inside quotes does not count');

// Dates: day-first by default, month-first only when a column proves it.
assert.equal(parseDate('12/10/2026'), '2026-10-12');
assert.equal(parseDate('05-03-26'), '2026-03-05');
assert.equal(parseDate('2026-10-12'), '2026-10-12');
assert.equal(parseDate('2026/1/5'), '2026-01-05');
assert.equal(parseDate('12 Oct 2026'), '2026-10-12');
assert.equal(parseDate('12-Oct-26'), '2026-10-12');
assert.equal(parseDate('3 September 2026'), '2026-09-03');
assert.equal(parseDate('Oct 12, 2026'), '2026-10-12');
assert.equal(parseDate('12.10.2026'), '2026-10-12');
assert.equal(parseDate('12/10/2026 14:30'), '2026-10-12');
assert.equal(parseDate('2026-10-12T09:15:00Z'), '2026-10-12');
assert.equal(parseDate('31/02/2026'), null, 'not a real day');
assert.equal(parseDate('13/13/2026'), null);
assert.equal(parseDate('soon'), null);
assert.equal(parseDate(''), null);
assert.equal(dateOrder(['01/02/2026', '03/04/2026']), 'dmy', 'ambiguous: India reads day first');
assert.equal(dateOrder(['01/02/2026', '10/25/2026']), 'mdy', 'a 25 in second place proves month-first');
assert.equal(dateOrder(['25/10/2026', '10/25/2026']), 'dmy', 'contradicting values: keep the default');
assert.equal(parseDate('10/25/2026', 'mdy'), '2026-10-25');

// Amounts.
assert.equal(parseAmount('₹1,23,456.00'), 123456);
assert.equal(parseAmount('Rs. 250'), 250);
assert.equal(parseAmount('INR 1,250.50'), 1250.5);
assert.equal(parseAmount('$12.99'), 12.99);
assert.equal(parseAmount('-250'), -250);
assert.equal(parseAmount('−250'), -250, 'unicode minus');
assert.equal(parseAmount('(1,200.00)'), -1200);
assert.equal(parseAmount('1,234.00 Dr'), -1234);
assert.equal(parseAmount('1,234.00Cr'), 1234);
assert.equal(parseAmount('1.234,56', 'comma'), 1234.56);
assert.equal(parseAmount('1 234,56 €', 'comma'), 1234.56);
assert.equal(parseAmount('12,50', 'comma'), 12.5);
assert.equal(parseAmount('abc'), null);
assert.equal(parseAmount('2026-10-12'), null, 'a date is not an amount');
assert.equal(parseAmount(''), null);
assert.equal(decimalStyle(['1.234,56', '12,50']), 'comma');
assert.equal(decimalStyle(['1,234.56', '₹1,23,456.00']), 'dot');

// A plain expense tracker export: header, all positive = all spending, no category.
{
  const { d, entries, errors } = read('Date,Description,Amount\n12/10/2026,Swiggy dinner,450\n13/10/2026,"Uber, office","₹1,200.00"\n');
  assert.deepEqual(d.roles, ['date', 'note', 'amount']);
  assert.equal(errors.length, 0);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.date, e.amount, e.note]),
    [
      ['expense', '2026-10-12', 450, 'Swiggy dinner'],
      ["expense", "2026-10-13", 1200, "Uber, office"],
    ]
  );
}

// A bank statement: preamble lines, then Withdrawal / Deposit columns and a balance that must be ignored.
{
  const csv = [
    'HDFC BANK Ltd.,,,,,,',
    'Account No: XXXX1234,,,,,,',
    '',
    'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    '01/10/26,UPI-ZOMATO-12345,0000123,01/10/26,"1,250.00",,"98,750.00"',
    '02/10/26,SALARY OCT,0000124,02/10/26,,"1,00,000.00","1,98,750.00"',
    '03/10/26,ATM WDL,0000125,03/10/26,"2,000.00",,"1,96,750.00"',
  ].join('\n');
  const { d, entries, errors } = read(csv);
  assert.deepEqual(d.roles, ['date', 'note', 'ignore', 'ignore', 'debit', 'credit', 'ignore']);
  assert.equal(d.firstLine, 5, 'line numbers count the preamble');
  assert.equal(errors.length, 0);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.date, e.amount]),
    [
      ['expense', '2026-10-01', 1250],
      ['income', '2026-10-02', 100000],
      ['expense', '2026-10-03', 2000],
    ]
  );
}

// Semicolons + European decimals + a Dr/Cr type column.
{
  const { entries } = read('Datum;Text;Betrag;Typ\n12.10.2026;Miete;1.234,56;Dr\n13.10.2026;Gehalt;3.000,00;Cr\n');
  assert.deepEqual(
    entries.map((e) => [e.kind, e.amount]),
    [
      ['expense', 1234.56],
      ['income', 3000],
    ]
  );
}

// Tabs, no header at all: the columns come from the values.
{
  const { d, entries } = read('2026-10-01\tChai\t20\n2026-10-02\tMetro card recharge\t500\n');
  assert.equal(d.header, null);
  assert.deepEqual(d.roles, ['date', 'note', 'amount']);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].note, 'Metro card recharge');
}

// Mixed signs and no type column: a statement, minus is money out.
{
  const { entries } = read('date,amount,memo\n2026-10-01,-300,Groceries\n2026-10-02,5000,Refund\n');
  assert.deepEqual(entries.map((e) => e.kind), ['expense', 'income']);
}

// Month-first dates are noticed from the column.
{
  const { entries } = read('Date,Amount,Note\n10/02/2026,10,a\n10/25/2026,20,b\n');
  assert.deepEqual(entries.map((e) => e.date), ['2026-10-02', '2026-10-25']);
}

// Bad rows are listed with the reason; good rows around them still read.
{
  const { entries, errors } = read(
    'Date,Note,Amount\nyesterday,Tea,20\n2026-10-02,Lunch,abc\n2026-10-03,Snack,\n2026-10-04,Dinner,300\n2026-10-05,Car,20000000\n'
  );
  assert.equal(entries.length, 1);
  assert.deepEqual(
    errors.map((e) => e.line),
    [2, 3, 4, 6]
  );
  assert.match(errors[0].reason, /date “yesterday”/);
  assert.match(errors[1].reason, /amount “abc”/);
  assert.match(errors[2].reason, /No amount/);
  assert.match(errors[3].reason, /at most/);
}

// Input it must refuse with a sentence, not a crash.
assert.throws(() => detect(''), /empty/);
assert.throws(() => detect('PK\u0003\u0004binary'), /isn’t a CSV/);
assert.throws(() => detect('Date,Amount,Note\n'), /no rows/);
assert.throws(() => detect('a\n' + '2026-10-01,1,x\n'.repeat(MAX_ROWS + 1)), /up to 10,000/);
{
  const d = detect('foo,bar\nhello,world\n');
  const r = readRows(d.rows, d.roles, d.firstLine);
  assert.equal(r.entries.length, 0);
  assert.match(r.errors[0].reason, /date/);
}

// Edge rows from real exports.
assert.deepEqual(plain(parseCsv('a,b\n,,\n , \n1,2\n')), [['a', 'b'], ['1', '2']], "Excel's trailing ,,, rows are blank lines");
for (const name of ['Debit/Credit', 'Credit/Debit', 'Debit / Credit']) {
  const { d, entries } = read(`Date,Note,Amount,${name}\n2026-10-01,Salary,50000,Credit\n2026-10-02,Rent,9000,Debit\n`);
  assert.equal(d.roles[3], 'type', name + ' is the type column');
  assert.deepEqual(entries.map((e) => e.kind), ['income', 'expense'], name);
}
{
  const { d, entries } = read('Date,Note,Expense,Income\n2026-10-01,Rent,9000,\n2026-10-02,Salary,,50000\n');
  assert.deepEqual(d.roles, ['date', 'note', 'debit', 'credit']);
  assert.deepEqual(entries.map((e) => e.kind), ['expense', 'income']);
  assert.deepEqual(read('Date,Expenses,Note\n2026-10-01,10,x\n').d.roles, ['date', 'debit', 'note']);
}
assert.deepEqual(
  read('Date,Note,Amount\n2026-10-01,Pay,1200 Cr\n2026-10-02,Tea,20\n').entries.map((e) => e.kind),
  ['income', 'expense'],
  'an explicit Cr is income even when no amount is negative'
);
{
  const { entries, errors } = read('Date,Note,Amount\n2026-10-01,Laptop,1,234\n2026-10-02,Tea,20,\n');
  assert.deepEqual(entries.map((e) => e.amount), [20], 'a trailing empty cell is not an extra column');
  assert.deepEqual([errors[0].line, errors[0].reason], [2, 'This row has more columns than the header (an unquoted 1,234?).']);
}
{
  const { entries, errors } = read('Date,Type,Amount\n2026-10-01,income,2000000000\n2026-10-02,income,500000000\n');
  assert.deepEqual(entries.map((e) => e.amount), [500000000]);
  assert.deepEqual([errors[0].line, errors[0].reason], [2, 'An amount can be at most 1,000,000,000.']);
}

// Duplicates: one already in Money, one repeated in the file. Ids are stable.
{
  const { entries } = read('date,amount,note\n2026-10-01,20,Chai\n2026-10-01,20,Chai\n2026-10-02,50,Bus\n');
  const money = { expenses: [{ id: 'x', date: '2026-10-02', amount: 50, note: 'bus ' }], income: [] };
  markDuplicates(entries, money);
  assert.deepEqual(entries.map((e) => e.dup), [null, 'file', 'existing']);
  assert.notEqual(entries[0].id, entries[1].id, 'two real chais are two rows');
  const again = markDuplicates(read('date,amount,note\n2026-10-01,20,Chai\n').entries, { expenses: [] });
  assert.equal(again[0].id, entries[0].id, 'the same file imported twice upserts, not doubles');
  assert.ok(entries.every((e) => e.id.length <= 64));
  const fresh = markDuplicates(read('date,amount,note\n2026-10-02,50,Bus\n').entries, { expenses: [] });
  assert.notEqual(entries[2].id, fresh[0].id, 'a ticked "already in Money" row is a second copy, not an overwrite of the first');
}

// 5,000 rows read fast.
{
  const big = 'Date,Note,Amount\n' + Array.from({ length: 5000 }, (_, i) => `0${(i % 9) + 1}/10/2026,Item ${i},"${i + 1}.50"`).join('\n');
  const t = Date.now();
  const { entries } = read(big);
  markDuplicates(entries, { expenses: [] });
  assert.equal(entries.length, 5000);
  assert.ok(Date.now() - t < 1500, 'parse of 5,000 rows took ' + (Date.now() - t) + 'ms');
}

// Our own export reads back as it was written.
{
  const money = {
    accounts: [{ id: 'a1', name: 'Cash' }],
    expenses: [
      { id: 'e1', date: '2026-10-03', amount: 450.5, category: 'food', note: 'Lunch, with "team"', accountId: 'a1' },
      { id: 'e2', date: '2026-10-02', amount: 99, category: 'others', note: '=SUM(A1)' },
      { id: 'e3', date: '2026-10-01', amount: 1200, category: 'shopping', note: 'two\nlines' },
    ],
    income: [{ id: 'i1', date: '2026-10-01', amount: 50000, source: 'salary', label: 'October pay' }],
    transfers: [{ id: 't1', date: '2026-10-02', amount: 100, from: 'a1', note: 'to Ravi' }],
  };
  const { d, entries, errors } = read('\uFEFF' + ledgerCsv(money));
  assert.deepEqual(d.roles, ['date', 'type', 'amount', 'category', 'note', 'account', 'ignore']);
  assert.equal(errors.length, 1, 'only the transfer is left out');
  assert.match(errors[0].reason, /Transfers/);
  const byNote = Object.fromEntries(entries.map((e) => [e.note, e]));
  assert.deepEqual(
    [byNote['Lunch, with "team"'].kind, byNote['Lunch, with "team"'].amount, byNote['Lunch, with "team"'].category, byNote['Lunch, with "team"'].account],
    ['expense', 450.5, 'food', 'Cash']
  );
  assert.equal(byNote['=SUM(A1)'].amount, 99, "the ' that defused the formula is taken off again");
  assert.equal(byNote['two\nlines'].date, '2026-10-01');
  assert.deepEqual([byNote['October pay'].kind, byNote['October pay'].category], ['income', 'salary']);
  // Re-importing what is already there: everything is a duplicate.
  markDuplicates(entries, money);
  assert.ok(entries.every((e) => e.dup === 'existing'));
}

// One amount column, both signs: a bank statement (plus = in) or a card export (plus = out).
{
  const card = '01/02/2026,Amazon,1200.00\n05/02/2026,Payment thank you,-1200.00\n';
  const d = detect(card);
  const bank = readRows(d.rows, d.roles, d.firstLine);
  assert.equal(bank.mixedSign, true, 'the sign alone decides, so the preview offers the toggle');
  assert.deepEqual(bank.entries.map((e) => e.kind), ['income', 'expense'], 'default: plus is money in');
  const out = readRows(d.rows, d.roles, d.firstLine, { positiveIs: 'out' });
  assert.deepEqual(out.entries.map((e) => e.kind), ['expense', 'income'], 'card: the purchase is spending, the payment comes in');
  assert.deepEqual(out.entries.map((e) => e.amount), [1200, 1200]);
  const allPos = detect('Date,Note,Amount\n2026-10-01,Tea,20\n2026-10-02,Lunch,250\n');
  const r = readRows(allPos.rows, allPos.roles, allPos.firstLine, { positiveIs: 'out' });
  assert.equal(r.mixedSign, false, 'all positive: no toggle');
  assert.ok(r.entries.every((e) => e.kind === 'expense'));
  const typed = detect('Date,Note,Amount,Type\n2026-10-01,Salary,500,Credit\n2026-10-02,Refund,-20,Debit\n');
  assert.equal(readRows(typed.rows, typed.roles, typed.firstLine).mixedSign, false, 'a type column decides: no toggle');
  const marked = detect('Date,Note,Amount\n2026-10-01,Refund,20 Cr\n2026-10-02,Shop,-30\n');
  assert.equal(
    readRows(marked.rows, marked.roles, marked.firstLine, { positiveIs: 'out' }).entries[0].kind,
    'income',
    'a Cr marker still beats the sign convention'
  );
}

// A statement line for a payment automatic capture already booked (payee note vs the
// bank's narration) is unticked as already in Money; each captured row covers one line.
{
  const money = { expenses: [{ id: 'cap-1', date: '2026-10-20', amount: 250, note: 'Swiggy', capture: { via: 'sms' } }], income: [] };
  const lines = markDuplicates(
    read('date,amount,note\n2026-10-20,-250,UPI/629312345678/SWIGGY\n2026-10-20,-250,UPI/629399999999/SWIGGY\n', { positiveIs: 'in' }).entries,
    money
  );
  assert.deepEqual(lines.map((e) => e.dup), ['existing', null], 'one captured row answers for one line');
  // The same captured row matched by its own note first does not mark a second line too.
  const exact = markDuplicates(
    read('date,amount,note\n2026-10-20,-250,Swiggy\n2026-10-20,-250,UPI/Zomato/629300000001\n', { positiveIs: 'in' }).entries,
    money
  );
  assert.deepEqual(exact.map((e) => e.dup), ['existing', null], 'a captured row matched exactly is used up');
}

console.log('csv-import: all checks passed');
