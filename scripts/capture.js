/* Money's automatic capture, the phone side. Lazy: app.js imports it only in
   the app with Money on, and settings.js's capture section pulls it in.

   What the phone read (bank and UPI app notifications, bank SMS, a message shared
   into the app) is parsed HERE by bank-msg.js; only the fields it found go to
   POST /api/capture, never the text. The server (money/CaptureService) decides
   whether the payment is new, the same as one it already has (the SMS and the
   notification of one payment), or the same as one the user typed, and books it.

   Checked by node scripts/capture.test.mjs (toItem, the payload shape). */
import { parseBankMessage, cleanMessage } from './bank-msg.js';
import { suggestCategory } from './money-core.js';
import { capturePlugin } from './native.js';

export const SMS_BACKFILL_DAYS = 90;
// 100 a POST: each payment is a few queries under the user's lock, and a 90-day
// SMS read can be thousands; smaller calls stay well inside any request timeout.
const BATCH = 100;

/* SHA-256 of the folded text, first 32 hex: the server's "same message again"
   check (a repost, the SMS backfill meeting the live receiver). The same
   formula as CaptureService.ingestText, so a shared copy of a message the
   iPhone Shortcut already sent is one too. Null where Web Crypto is missing. */
export async function messageHash(text, eventAt) {
  try {
    // A notification is hashed with the app's own event time: two payments whose
    // notifications read alike ("\u20b910 paid to Chai Point") are two, a repost of one
    // (same event time) is one. An SMS is its text alone, so the 90-day read and the
    // live receiver, which date it differently, still meet.
    const body = cleanMessage(text) + (eventAt ? '|' + eventAt : '');
    const bytes = new TextEncoder().encode(body);
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  } catch (_) {
    return null;
  }
}

/* One raw capture {via, origin, text, at} -> the item POST /api/capture takes,
   or null when the text reports no payment. The tag is Money's own guess from
   the payee (the user's past corrections first); none = the server's keywords. */
export async function toItem(raw, money) {
  const p = parseBankMessage(raw && raw.text);
  if (!p) return null;
  const tag = p.kind === 'debit' && p.merchant && money ? suggestCategory(p.merchant, money) : null;
  return {
    via: raw.via,
    origin: raw.origin || raw.via,
    kind: p.kind,
    amount: p.amount,
    merchant: p.merchant,
    last4: p.last4,
    ref: p.ref,
    date: p.date,
    at: Number(raw.at) || Date.now(),
    msgHash: await messageHash(raw.text, raw.via === 'notif' ? raw.at : null),
    confidence: p.confidence,
    channel: p.channel,
    ...(tag && tag !== 'others' ? { category: tag } : {}),
  };
}

/* Items to the server, BATCH at a time; the summed {added, merged, review, skipped}. */
export async function sendCaptures(api, items) {
  const total = { added: 0, merged: 0, review: 0, skipped: 0 };
  for (let i = 0; i < items.length; i += BATCH) {
    const r = await api('/api/capture', {
      method: 'POST',
      body: JSON.stringify({ items: items.slice(i, i + BATCH) }),
    });
    for (const k of Object.keys(total)) total[k] += Number((r && r[k]) || 0);
  }
  return total;
}

async function parseAll(raws, money) {
  const out = [];
  for (const r of raws || []) {
    const it = await toItem(r, money);
    if (it) out.push(it);
  }
  return out;
}

/* What the phone queued since the app was last open (notifications, live SMS).
   Read with peek(), and forgotten with ack() only once the server has taken the
   batch: an app opened offline, or onto a server still waking up, keeps it for
   the next open instead of losing it (the native side still drops anything
   older than three days). Texts that are no payment are acked at once. */
export async function drainPhoneCaptures({ api, money }) {
  const plugin = capturePlugin();
  if (!plugin) return null;
  let raws;
  try {
    raws = ((await plugin.peek()) || {}).items || [];
  } catch (_) {
    return null;
  }
  const items = await parseAll(raws, money);
  const res = items.length
    ? await sendCaptures(api, items)
    : { added: 0, merged: 0, review: 0, skipped: 0 };
  // Reached only when every batch was taken; a throw above keeps the queue as it is.
  const ids = raws.map((r) => r && r.id).filter(Boolean);
  if (ids.length) await plugin.ack({ ids });
  return res;
}

/* The last SMS_BACKFILL_DAYS of bank SMS, read once when SMS capture is switched
   on. The server knows every payment it has seen, so running it again is a no-op. */
export async function backfillSms({ api, money, days = SMS_BACKFILL_DAYS }) {
  const plugin = capturePlugin();
  if (!plugin) return null;
  const raws =
    ((await plugin.readSmsInbox({ sinceMs: Date.now() - days * 86400000 })) || {}).items || [];
  const items = await parseAll(raws, money);
  return { read: raws.length, ...(await sendCaptures(api, items)) };
}

/* A message shared into the app (long-press a bank SMS > Share), read but not
   sent: the caller shows it and sends it only on the user's tap, because a
   share can come from anywhere (any app's intent, any web page's link to the
   share target) and must never book a payment by itself. Null = no payment. */
export function readShared(text, money) {
  return toItem({ via: 'share', origin: 'share', text, at: Date.now() }, money);
}

export async function captureShared({ api, item }) {
  return { item, result: await sendCaptures(api, [item]) };
}
