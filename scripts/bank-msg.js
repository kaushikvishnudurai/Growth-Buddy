/* The one reader of Indian bank and UPI message text: a bank SMS, a UPI app's or
   bank app's notification, a shared message. In: the text. Out: the transaction it
   reports, or null when it reports none (an OTP, an offer, a bill reminder, a failed
   payment, a balance alert, an ATM withdrawal, a card bill payment).

     { kind: 'debit'|'credit', amount, merchant, last4, ref, date, channel, confidence }

   merchant / last4 / ref / date / channel are null when the text doesn't say them.
   date is 'YYYY-MM-DD' from the text (day first); the capture's own time decides the
   day when it is missing. confidence is 'low' when nothing ties the text to a real
   payment (no merchant, account or reference); low rows go to Money's "To review"
   and nothing else does.

   DOM-free. Mirrored in Java (money/capture/BankMessageParser.java) for the iPhone
   path, which parses on the server; both are tested against bank-msg.cases.json.
   Change a rule here, change it there, and add the case. Never log the text. */

const MONEY_RE = /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
// "debited by 120.0" (SBI) carries no currency word.
const VERB_AMOUNT_RE =
  /\b(?:debited|credited)\s+(?:by|with|for)\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i;
// An amount right after one of these is a balance or a limit, not the payment.
const BALANCE_BEFORE_RE = /(?:bal|balance|limit|lmt|avl\.?|avail|available)\W*$/i;

const OTP_RE = /\b(?:otp|one[\s-]?time\s+password|verification\s+code|passcode)\b/;
const NOTICE_RE =
  /\bwill\s+be\s+(?:debited|deducted|charged)\b|\bis\s+due\b|\bdue\s+(?:on|date|by)\b|\bminimum\s+(?:amount\s+)?due\b|\bpre-?approved\b|\bapply\s+now\b|\beligible\b|\bhas\s+requested\b|\bcollect\s+request\b|\brequested\s+(?:rs|inr|money|₹)/;
const FAILED_RE =
  /\b(?:failed|declined|unsuccessful|not\s+successful|could\s+not\s+be\s+(?:processed|completed))\b/;
const REVERSAL_RE = /\b(?:reversed|refunded|refund)\b/;
const ATM_RE = /\batm\b/;
const CARD_BILL_RE =
  /\b(?:credit\s+card|cc)\s+(?:bill|payment|dues)\b|\bpayment\b[^.]{0,60}\breceived\b[^.]{0,40}\bcard\b|\breceived\b[^.]{0,30}\btowards\b[^.]{0,40}\bcard\b|\btowards\b[^.]{0,30}\bcredit\s+card\b/;
const PAID_YOU_RE = /\b(?:paid|sent)\s+you\b/;
const DEBIT_RE = /\b(?:debited|debit|spent|sent|paid|withdrawn|deducted|dr|purchase|charged)\b/;
const CREDIT_RE = /\b(?:credited|credit|received|deposited|cr|refunded|refund|reversed)\b/;

const LAST4_RES = [
  /\b(?:a\/?c|acct|account|ac|card)\b\.?\s*(?:no\.?|number)?\s*(?:ending\s*(?:with|in)?)?\s*[:-]?\s*[x*]*\s*([0-9]{3,6})\b/i,
  /[•*]{2,}\s*([0-9]{3,4})\b/,
];
const REF_RES = [
  /\b(?:upi\s*ref(?:erence)?|ref(?:erence)?|rrn|utr|txn(?:\s*(?:id|no\.?))?|transaction\s*id|imps\s*ref)\s*(?:no\.?|number|#|id)?\s*[:.-]?\s*([0-9]{9,18})\b/i,
  /\bupi\s*[:-]?\s*([0-9]{9,18})\b/i,
  /\bupi\/(?:[a-z0-9]+\/)?([0-9]{9,18})\//i,
];

// A name runs until one of these: end of sentence or line, punctuation, a word that
// starts the next clause ("on", "ref", "avl"...), or a number.
const TERM =
  '(?=\\s*(?:\\.(?:\\s|$)|$|\\n|;|,|\\(|:)|[ ]+(?:on|ref|refno|rrn|utr|upi|avl|avail|available|bal|balance|total|not|dt|date|via|using|if|info|for|is|has|was|thru|txn|and)\\b|[ ]+[0-9])';
const NAME = "([A-Za-z0-9][A-Za-z0-9&'.\\- ]{0,40}?)";
const MERCHANT_RES = {
  upiPath:
    /\bupi\/(?:[a-z0-9]+\/)?[0-9]{6,}\/([A-Za-z0-9&'.\- ]{2,40}?)(?=\.(?:\s|$)|$|\n|\/|;|,)/i,
  // "@NETFLIX", never the @ inside a VPA ("paytmqr123@paytm").
  at: new RegExp('(?:\\bat\\s+|(?<![A-Za-z0-9._-])@\\s*)' + NAME + TERM, 'gi'),
  to: new RegExp('\\bto\\s+(?:vpa\\s+)?' + NAME + TERM, 'gi'),
  from: new RegExp('\\bfrom\\s+(?:vpa\\s+)?' + NAME + TERM, 'gi'),
  semiCredited: /;\s*([A-Za-z0-9][A-Za-z0-9&'.\- ]{1,40}?)\s+credited\b/i,
  towards: new RegExp('\\btowards\\s+(?!upi\\b)' + NAME + TERM, 'gi'),
  onCaps: new RegExp("\\b(?:on|at)\\s+([A-Z][A-Z0-9&'.\\- ]{1,40}?)" + TERM, 'g'),
};
const VPA_RE = /\b([a-z0-9][a-z0-9._-]{1,64})@([a-z][a-z0-9]{1,20})\b/i;
// Words that start a phrase about the user's own account, never a merchant.
const NOT_MERCHANT_RE =
  /^(?:your|you|a\/?c|ac|acct|account|the|card|vpa|upi|beneficiary|self|bank|mobile|date|dt)\b|\ba\/?c\b|\baccount\b|\bcard\b|\bbank\s+a\/?c\b/i;
// A VPA's local part that names a payment gateway or a QR code, not a payee.
const JUNK_VPA_RE = /^(?:paytmqr|bharatpe|gpay-|mab\.|upi|pay|q[0-9])/i;
const DATE_LINE_RE =
  /^[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}(?:,?\s+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:\s*[ap]m)?)?$/i;

const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/* Whitespace folded the way BankMessageParser.clean does: the message hash is taken over this. */
export function cleanMessage(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

function readNumber(s) {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function findAmount(text) {
  for (const m of text.matchAll(MONEY_RE)) {
    const before = text.slice(Math.max(0, m.index - 20), m.index);
    if (BALANCE_BEFORE_RE.test(before)) continue;
    const n = readNumber(m[1]);
    if (n) return { amount: n };
  }
  const v = VERB_AMOUNT_RE.exec(text);
  const n = v && readNumber(v[1]);
  return n ? { amount: n } : null;
}

function direction(lower) {
  if (PAID_YOU_RE.test(lower)) return 'credit';
  const d = DEBIT_RE.exec(lower);
  const c = CREDIT_RE.exec(lower.replace(/credit\s+card/g, 'card'));
  if (!d && !c) return null;
  if (!c) return 'debit';
  if (!d) return 'credit';
  return d.index <= c.index ? 'debit' : 'credit';
}

function firstGroup(res, text) {
  for (const re of res) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return null;
}

function titleCase(s) {
  if (/[a-z]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[ .&'-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

function tidyName(raw) {
  const s = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.,:;-]+$/, '')
    .trim();
  // A phone number ("SMS BLOCK to 9264092640") is never a payee.
  if (s.length < 2 || /^[0-9]{4,}|^[0-9 ]+$/.test(s) || NOT_MERCHANT_RE.test(s)) return null;
  return titleCase(s).slice(0, 40);
}

function vpaName(text) {
  const m = VPA_RE.exec(text);
  if (!m) return { found: false, name: null };
  const local = m[1];
  if (JUNK_VPA_RE.test(local)) return { found: true, name: null };
  const words = local
    .replace(/[0-9]+/g, ' ')
    .split(/[._\-\s]+/)
    .filter(Boolean);
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return { found: true, name: name.length >= 2 ? name : null };
}

function firstName(re, text) {
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const name = tidyName(m[1]);
    if (name) return name;
  }
  return null;
}

function lineAfterDate(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!DATE_LINE_RE.test(lines[i])) continue;
    const next = lines[i + 1];
    if (
      /^[A-Za-z][A-Za-z0-9&'.\- ]{1,40}$/.test(next) &&
      !/^(?:avl|avail|not|sms|bal|info|call)\b/i.test(next)
    )
      return tidyName(next);
  }
  return null;
}

function findMerchant(text, kind) {
  const path = MERCHANT_RES.upiPath.exec(text);
  if (path && tidyName(path[1])) return tidyName(path[1]);
  const vpa = vpaName(text);
  if (vpa.name) return vpa.name;
  const order =
    kind === 'credit'
      ? [MERCHANT_RES.from, MERCHANT_RES.at, MERCHANT_RES.to]
      : [MERCHANT_RES.at, MERCHANT_RES.to, MERCHANT_RES.towards];
  for (const re of order) {
    const name = firstName(re, text);
    if (name) return name;
  }
  if (kind === 'debit') {
    const semi = MERCHANT_RES.semiCredited.exec(text);
    if (semi && tidyName(semi[1])) return tidyName(semi[1]);
    const caps = firstName(MERCHANT_RES.onCaps, text);
    if (caps) return caps;
  }
  return lineAfterDate(text);
}

function isoDay(y, m, d) {
  const year = y < 100 ? 2000 + y : y;
  if (m < 1 || m > 12 || d < 1 || d > 31 || year < 2000 || year > 2099) return null;
  const dt = new Date(Date.UTC(year, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return year + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function findDate(text) {
  const iso = /\b(20[0-9]{2})[-:/]([0-9]{2})[-:/]([0-9]{2})\b/.exec(text);
  if (iso) {
    const v = isoDay(+iso[1], +iso[2], +iso[3]);
    if (v) return v;
  }
  for (const m of text.matchAll(/\b([0-9]{1,2})[-/]([0-9]{1,2})[-/]([0-9]{2,4})\b/g)) {
    if (m[3].length === 3) continue;
    const v = isoDay(+m[3], +m[2], +m[1]);
    if (v) return v;
  }
  for (const m of text.matchAll(/\b([0-9]{1,2})[- ]?([A-Za-z]{3})[a-z]*[- ,]? ?([0-9]{2,4})\b/g)) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (!mon || m[3].length === 3) continue;
    const v = isoDay(+m[3], mon, +m[1]);
    if (v) return v;
  }
  return null;
}

function findChannel(lower) {
  if (
    /\b(?:e-?mandate|mandate|autopay|auto[- ]?debit|nach|ecs|standing\s+instruction)\b/.test(lower)
  )
    return 'autodebit';
  if (/\bupi\b|\bvpa\b|[a-z0-9]@[a-z]{2,}/.test(lower)) return 'upi';
  if (/\bcard\b/.test(lower)) return 'card';
  if (/\bneft\b/.test(lower)) return 'neft';
  if (/\bimps\b/.test(lower)) return 'imps';
  if (/\brtgs\b/.test(lower)) return 'rtgs';
  return null;
}

export function parseBankMessage(raw) {
  const text = cleanMessage(raw).replace(/₹/g, 'Rs ');
  if (!text || text.length > 2000) return null;
  const lower = text.toLowerCase().replace(/\n/g, ' ');
  if (OTP_RE.test(lower) || NOTICE_RE.test(lower) || CARD_BILL_RE.test(lower)) return null;
  if (FAILED_RE.test(lower) && !REVERSAL_RE.test(lower)) return null;
  // ponytail: an ATM withdrawal moves money to cash, it is not spending. Skipped
  // rather than booked as a bank -> cash transfer; add that if balances need it.
  if (ATM_RE.test(lower) && /\b(?:withdrawn|withdrawal|cash)\b/.test(lower)) return null;
  const amt = findAmount(text);
  const kind = direction(lower);
  // Over 1,000,000,000 is no payment anyone was texted about (a phone or card number misread).
  if (!amt || !kind || amt.amount > 1e9) return null;
  const merchant = findMerchant(text, kind);
  const l4 = firstGroup(LAST4_RES, text);
  const last4 = l4 ? l4.slice(-4) : null;
  const ref = firstGroup(REF_RES, text);
  const confidence = merchant || last4 || ref ? 'high' : 'low';
  return {
    kind,
    amount: amt.amount,
    merchant,
    last4,
    ref,
    date: findDate(text),
    channel: findChannel(lower),
    confidence,
  };
}
