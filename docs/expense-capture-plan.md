# Automatic expense capture: options and plan

Status: **Phase 1, for approval. Nothing here is built yet.** Written 2026-10-21 on branch
`kaushik/expense-capture`. Policy facts were checked against the official pages linked in each
section on that date. Anything not from an official source is marked *(unofficial)*.

## The problem in one paragraph

Buyers want "my spends fill in on their own". Most of them (13 of 20 in the founder panel) won't link
a bank to a new app run by one developer, and the top complaint about every competitor is missed or
**duplicated** transactions. Pro is Rs 99/month, so capture has to cost close to Rs 0 per user. In
India the good news is that **every bank already sends the user a text for every debit**. RBI requires
those alerts, so the data is already on the user's phone or in their inbox. The job is to read it
there, with the user's consent, store as little as possible, and never book the same spend twice.

## Summary table

| # | Source | Android | iPhone | Web | Cost to me per user/month | User setup | Accuracy | Duplicate risk | Policy / privacy risk | Build effort |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Account Aggregator (Setu) | yes | yes | yes | n/a: **not allowed for me** | consent flow | high | low | **blocked by RBI** | built, inert |
| 2 | Bank/UPI SMS, read on the device | **yes** | no | no | Rs 0 | 1 permission tap | high (every debit is texted) | medium (several texts per spend) | **Play review needed; may be refused** | M |
| 3 | Notification listener | yes | no | no | Rs 0 | 1 system toggle | medium (only apps that notify) | high (overlaps SMS) | low (no declaration form) | M |
| 4 | Bank alert emails forwarded to us | yes | **yes** | **yes** | Rs 0 (+ Rs ~800/yr fixed for a domain) | 5-min mail filter | high for banks that email | medium (overlaps SMS) | low | M |
| 5 | iPhone Shortcut on incoming SMS | no | **yes** | no | Rs 0 | 3-min automation | high | medium | low | S |
| 6a | Statement import (CSV exists; add PDF/XLS) | yes | yes | yes | Rs 0 | monthly upload | high | low (dedup exists) | low | M (PDF) |
| 6b | Share an SMS / receipt screenshot into the app | yes | partly | yes | Rs 0 (text); AI cost per screenshot | per spend | high (text) / medium (image) | low | none | S (text), S (image, reuses receipt scan) |

**Recommendation: build 2, 3, 4, 5, 6b (text) on one shared parser and one dedup engine, and park 1.**
The build order is at the end.

---

## 1. Account Aggregator via Setu: park it

**How it works.** The user approves a consent in an AA app. We become a *Financial Information User*
(FIU) and fetch transactions from their bank. `money/BankFeedService` already does this through
Setu. It is inert until Setu keys are set.

**Can I be an FIU?** **No.** RBI's NBFC-AA Master Direction, para 3(1)(xii), says:
*"'Financial information user' means an entity registered with and regulated by any financial sector
regulator"* ([rbi.org.in](https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=10598); I
checked the quote myself). Sahamati's onboarding starts with *"Get registered and regulated by at
least one of the Financial Service Regulators (FSR), namely RBI, SEBI, IRDAI, PFRDA"*
([sahamati.org.in](https://sahamati.org.in/?p=1224)), and Setu's go-live checklist begins with
*"Submission of FIU's license"*. Setu is a technology provider. It does not lend its licence. An
individual or an unregistered company can't go live, directly or through Setu.

- **The only legal route:** a contract with a regulated entity (an NBFC, a SEBI-registered
  investment adviser) where *they* are the FIU and we are their technology vendor. That means a
  business agreement plus Sahamati review. It isn't realistic now.
- **Setu pricing:** not published. *(Unofficial)* AA fees run about Rs 1 to Rs 60 per account per
  fetch, depending on data type.
- **Sandbox:** sign-up at bridge.setu.co. It is fine for prototyping, but production needs KYC and a
  licence.

**Verdict: parked.** Keep the code, since it costs nothing while inert. It was also the option buyers
trusted least ("linking my bank").

## 2. Android: reading bank and UPI SMS on the device

**How it works.** A small native plugin in `../Growth-Buddy-Mobile` does two things:
- **backfill:** reads the SMS inbox once, back 90 days, filtered to bank sender IDs (`XX-HDFCBK`,
  `XX-ICICIT`, …);
- **live:** listens for new SMS (`RECEIVE_SMS`).

The text is handed to the shared JS parser in the WebView. Only the parsed fields (amount, debit or
credit, merchant/VPA, last 4, date, a hash of the reference) go to the server, never the message. No
maintained Capacitor plugin does live receive *(npm check: `capacitor-sms-inbox` reads the inbox and
was last published 2025-04)*. The repo already has three custom Java plugins, so a ~200-line one of our
own is the safer choice.

**Policy.** Google Play's SMS and Call Log policy
([answer/10208820](https://support.google.com/googleplay/android-developer/answer/10208820), quote
checked myself) lists **"SMS-based money management — For example, apps that track and manage
budget"** as an exception covering `READ_SMS`, `RECEIVE_SMS`, `RECEIVE_MMS` and `RECEIVE_WAP_PUSH`.
The catches:
- It is a *"temporary exception"* for apps that aren't the default SMS app. It is subject to review
  and only when *"there's currently no alternative method"*. The SMS Retriever / User Consent APIs are
  OTP-only, so they aren't an alternative for bank alerts.
- *"personal loans or budgeting apps may not exfiltrate or share non-financial or personal SMS history
  of a user."* Selling SMS-derived data is listed as invalid use.
- **The declaration form** ([answer/9214102](https://support.google.com/googleplay/android-developer/answer/9214102))
  asks for:
  - the use case;
  - review instructions;
  - **a video demonstration**;
  - test login credentials.
- Review *"may require up to several weeks"*, and **the whole release waits in pending publication**.
  That's why SMS must ship in its own release, never mixed into a bug-fix build.
- **User Data policy**
  ([answer/10144311](https://support.google.com/googleplay/android-developer/answer/10144311)): an
  in-app prominent disclosure, shown before the permission prompt, that names the data and its use and
  requires an affirmative tap.
- **Financial features declaration**
  ([answer/9876821](https://support.google.com/googleplay/android-developer/answer/9876821)): Play
  requires it from any app with financial features. Money likely counts, so it may already be due.

**Does parsing on the device help?** The policy text doesn't say it changes eligibility. It does
satisfy the "no exfiltration" clause outright, simplifies the Data safety form ("SMS: processed on
device, not collected"), and makes the privacy card honest. *(Unofficial)* Play has rejected Indian
expense trackers whose video didn't show SMS as the core feature, while established budgeting apps
ship with `READ_SMS`. So approval is plausible, not certain.

**Accuracy:** the best of any free source. RBI requires an alert per transaction, so every debit
arrives, including card, UPI, ATM, NEFT and auto-debit. **Duplicate risk:** one spend often produces
two texts: the bank's debit alert, plus a UPI app's or the merchant's. That is handled by the
reference number (below). **iPhone:** impossible, since iOS gives apps no SMS access. Use #5.
**Cost:** Rs 0. **User setup:** one consent card, one permission tap, an optional 90-day backfill.

**Effort:** M. The plugin and permission flow are about a day. The Play video and declaration are
your job.

## 3. Android: notification listener

**How it works.** A `NotificationListenerService` in a native plugin reads notifications from an
allow-list of packages: GPay, PhonePe, Paytm, BHIM, CRED, and bank apps (HDFC, ICICI iMobile, SBI
YONO, Axis, Kotak). Each notification's text goes to the same parser. Everything else is ignored
without being read. *(npm: `capacitor-notifications-listener` 0.6.1 is maintained, Capacitor 8; or
roll our own.)*

**Policy.** Google has **no declaration form** for `BIND_NOTIFICATION_LISTENER_SERVICE`. It isn't in
the SMS / Call Log or restricted-permission policies. The User Data prominent-disclosure rule still
applies, since this is other apps' content.
- Android 15
  ([behavior changes](https://developer.android.com/about/versions/15/behavior-changes-all)) hides
  notifications that contain an **OTP** from third-party listeners. Plain debit alerts come through.
- Android 13+ "restricted settings" only bite sideloaded APKs, so they matter for testing, not for Play
  installs.

**Accuracy: medium.**
- It only sees apps the user has installed, and only when they notify.
- *(Unofficial, to verify on a phone)* GPay and PhonePe notify for *received* money more reliably than
  for *sent*.
- Not every bank app pushes debit alerts.
- OEM battery killers (the OnePlus issue in memory) can stop the listener.

**Duplicate risk:** high. The same spend usually also arrives by SMS, which is why dedup matters more
than the source. **Cost:** Rs 0. **Setup:** one system settings toggle, which is scarier-looking than
the SMS prompt.

**Role:** the no-review fallback for Android. It ships first and works even if Play refuses SMS.

## 4. Bank alert emails forwarded to a per-user address

**How it works.**
1. The user adds one Gmail/Outlook filter: from `alerts@hdfcbank.net OR …` → forward to
   `in+<token>@<our domain>`.
2. Cloudflare Email Routing hands the mail to an **Email Worker**.
3. The Worker parses the mail with the **same JS parser** (so the raw email never reaches our
   server).
4. The Worker POSTs only the fields to `/api/capture` with the token.

No Gmail API is involved: `gmail.readonly` is a restricted scope that needs an annual CASA
assessment, *(unofficial)* from about $540/yr
([scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)).

**Constraints found:**
- Cloudflare Email Routing needs the domain on Cloudflare DNS.
- **A catch-all works only on an apex domain**, not on a subdomain.
- Subaddressing (`in+token@example.com`) does work.
- Workers Free: 100,000 requests/day and 10 ms CPU each. A text email parses well inside that.

**Fixed cost:** we have no domain today (`*.onrender.com`). A `.in` or `.com` costs about Rs 800/yr.
That's the one fixed cost in this plan, and it's not per user. The Cloudflare free plan needs no card.

**Two traps:**
- **Forwarding verification.** Gmail sends a confirmation code to the target address before it will
  auto-forward. The Worker must recognise that mail and show the code in the app.
- **Render sleeps.** A cold start takes about 30 to 60 s. The Worker must wait or retry: keep-awake
  helps, and on a failed POST the Worker should retry once and then drop the mail. The bank still
  sends SMS.

**Accuracy:** high where banks email, which most do for cards; UPI coverage varies by bank.
**Duplicate risk:** overlaps SMS, so dedup again. **Platforms:** works for iPhone and web users, which
is the main point. **Privacy:** the raw mail sits in Cloudflare's memory for one Worker run. Nothing is
logged or stored. The user's own mailbox keeps the original. **Effort:** M.

## 5. iPhone: Shortcuts personal automation on bank SMS

**How it works.** We publish one shortcut ("Send to Growth Buddy") as an iCloud link. It takes the
message text and POSTs it to `/api/capture/sms` with the user's capture token in a header. The server
parses with the **Java mirror** of the parser and drops the text.

**What iOS allows** *(unofficial, but consistent since iOS 17)*:
- Personal automations can be set to **"Run Immediately"**, with no tap needed.
- iOS still shows a "running your automation" banner each time.
- **Automations can't be shared, only shortcuts**, so each user creates the trigger by hand: Message →
  Message Contains "debited" → Run Shortcut. That's about 3 minutes with a guided screen.
- The Sender filter only takes contacts, not bank short codes, so the trigger uses keywords ("debited",
  "spent", "sent Rs").
- The Wallet "Transaction" trigger exists. Apple Pay reached India only recently and covers a narrow
  set of cards, so it isn't worth building now.

**Accuracy:** high, the same texts as Android. **Cost:** Rs 0. **Risk:** the user sees a banner per
SMS, and a keyword trigger also fires on non-bank texts; the parser rejects those without storing
anything. **Effort:** S. It needs a phone test on iOS 26.

## 6a. Statement import (CSV exists; PDF and XLS)

**What exists:** `csv-import.js` + `import-ui.js` already import CSV, with duplicate marking and stable
`csv-<hash>` ids.

**What to add:**
- **XLS/XLSX**, since all five banks offer an Excel download in netbanking. A lazy-loaded reader
  converts it to rows and then reuses `readRows`.
- **PDF e-statements** from HDFC, ICICI, SBI, Axis and Kotak:
  - They are password-protected. The format varies by bank, *(unofficial)* usually name + DDMM or a
    customer ID, so we ask for the password and keep it in memory only.
  - We decrypt and extract text **in the browser** with pdf.js as a lazy chunk, which keeps it out of
    the boot bundle and inside `bundle-budget.mjs`.
  - Then a per-bank column layout turns the text into rows. This is the brittle part: layouts change,
    so each bank gets a fixture test.

**Accuracy:** high. **Duplicates:** low. CSV already dedups, and capture dedup (below) will also match
statement rows to captured ones. **Cost:** Rs 0. **Effort:** XLS S, PDF M to L (five layouts).
**Role:** monthly catch-up for anything the live sources missed, and the history import on day one.

## 6b. Share an SMS or a UPI receipt into the app

- **Text:** long-press a bank SMS, Share, then Growth Buddy.
  - Web/PWA on Android: the manifest's `share_target` already exists, and `launch-intent.js` already
    reads `?text=`.
  - Capacitor Android: a `SEND text/plain` intent filter in a small native hook.
  - The parser turns the text into a To-review row. **No permission at all**, so it's useful even for
    a user who refuses every automatic source.
- **Screenshot** of a GPay/PhonePe receipt: reuse `openReceiptModal` / `POST /api/money/receipt-scan`.
  It costs AI tokens per image, so it's an optional feature, and it already falls back to typing.
- **iPhone:** the share sheet into a Capacitor app needs a native Share Extension, which is extra
  Xcode work. #5 covers iPhone better, so this is deferred.

---

## The shared pieces every source uses

### One parser (`scripts/bank-msg.js`, DOM-free) + Java mirror

`parseBankMessage(text, {sender?, receivedAt})` returns
`{kind: 'debit'|'credit', amount, currency, merchant, vpa, last4, date, ref, bank, channel: 'upi'|'card'|'atm'|'neft'|'imps'|'autodebit', confidence}`
or `null` when the text isn't a transaction.

It returns `null` for:
- OTPs;
- promos ("pre-approved loan of Rs 5,00,000");
- balance-only texts;
- failed or reversed payments, which become a credit when the message says "reversed".

Cases live in **`scripts/bank-msg.cases.json`**: anonymised samples from 8+ banks (HDFC, ICICI, SBI,
Axis, Kotak, PNB, Bank of Baroda, IDFC First, Yes) plus GPay, PhonePe and Paytm. All numbers, names
and VPAs are invented. `scripts/bank-msg.test.mjs` and a Java `BankMessageParserTest` both read that
file, the same way `recurrence.cases.json` keeps two implementations in step. The Java side is needed
only for the iPhone path; the email Worker imports the JS file.

### One dedup engine

Every captured spend is matched in this order:

1. **Reference / UTR.** UPI's 12-digit RRN appears in both the bank's SMS and the UPI app's
   notification. We store `sha256(ref)`, never the ref itself. A match means the same row, and the
   new source only adds what the row lacked (a merchant name, last 4).
2. **Else amount + last 4 + a ±15-minute window**, same kind.
3. **Else amount + same day** against a **manual** entry (quick add, WhatsApp, typed) with no
   captured partner. This is a *suggested* merge, not an automatic one.

**Ids are stable:** `cap-<sha256(ref)>`, or `cap-<sha256(amount|last4|minute-bucket)>` when there is
no ref. They go in through `MoneyLedger.importIgnore`, which already never overwrites an existing id
(so user edits survive) and never re-inserts a tombstoned id (so a deleted row stays deleted). The
tombstone window is 120 days today. Capture needs it to be at least the backfill window (90 days),
which already fits.

### The "To review" inbox in Money

- Captured rows land in the ledger with `extra.review: 'new'` and **count in totals right away**,
  because "fills in on its own" means the numbers are right without the user doing anything.
- A row the engine thinks *may* duplicate another (rule 3) is held **out of totals** as
  `review: 'maybe-dup'`, beside the row it resembles.
- Inbox actions:
  - **Confirm** (one tap, clears the flag);
  - **re-tag** (the existing tag picker);
  - **Merge** (keep one, tombstone the other);
  - **Not a spend** (tombstone).
- Category starts on `predictCategory(merchant)`, so a user's past corrections steer it.
- A quick-add or WhatsApp sentence ("200 at Chai Point") that matches an unconfirmed captured row by
  amount and day **fixes that row** (note and tag) instead of adding a second one. The quick-add
  preview says so: "Matches a captured ₹200 at 10:42, will update it".

### Consent and the privacy card

- Every source is **off by default** and switched on per source, under Settings → Money → Automatic
  capture.
- Each setup screen opens with the same plain card, which doubles as Play's prominent disclosure:
  - **What is read:** only messages from banks and payment apps.
  - **What is stored:** amount, date, merchant, the last 4 digits and a fingerprint of the reference
    number.
  - **What never leaves the phone:** the message itself (Android). For email and iPhone it is read
    on the server and discarded.
  - **How to turn it off:** one switch.
  - **Delete what it captured:** one button, which tombstones every `cap-` row from that source.
- **Nothing raw is ever persisted.** The new server state is one table, `capture_sources`
  (user, source, enabled, a token hash for email/iPhone, last-seen timestamp). It goes in
  `USER_OWNED_TABLES`, `tableCreationQueries.sql` and `migrations.sql`.

---

## Recommended combination and build order

**"Fills in on its own" without bank linking:**
- **Android** (most Indian users): SMS, with the notification listener as the fallback if Play refuses
  or the user prefers it.
- **iPhone:** the Shortcut, with email as the alternative.
- **Web-only users:** email.
- **Everyone:** share-to-app and statement import catch whatever slips through, and the To-review
  inbox plus dedup keep it to one row per spend.

Per-user cost is **Rs 0 for every source**. The only money is about Rs 800/yr for a domain, and only
if you want email.

| Step | What | Why this order | Phone test needed |
|---|---|---|---|
| 1 | Parser + cases JSON (JS + Java), dedup engine, `/api/capture`, To-review inbox, quick-add matching, privacy card shell | Everything else is a thin source on top. Testable now with no phone. | no |
| 2 | Share-to-app for text (PWA share target + Android SEND intent) | Zero permissions and zero policy risk; proves the pipeline end to end | Android |
| 3 | Android notification listener | No Play declaration; ships in a normal release | **yes** (per OEM, Android 15 redaction) |
| 4 | iPhone Shortcut endpoint + setup screen | Small; covers iPhone | **yes** (iOS 26) |
| 5 | Android SMS (backfill + live), **in its own release** | Best data but blocks a release for weeks in review; build after 3 so a refusal costs nothing | **yes** |
| 6 | Email forwarding (Worker + domain) | Needs you to buy a domain; covers web and iPhone users who skip the Shortcut | needs a real mailbox |
| 7 | Statement XLS, then PDF (5 banks) | Catch-up and history; PDF layouts are the most brittle work | no |
| — | Receipt screenshot via AI | Optional; already mostly exists | no |
| parked | Account Aggregator | Needs an RBI/SEBI-regulated partner | — |

## What you will have to do by hand (later, not now)

- **Play Console** (step 5):
  - the SMS permission declaration (use case "SMS-based money management");
  - a demo video showing SMS import as core;
  - test credentials;
  - the Financial features declaration;
  - updated Data safety answers.
- **Domain** (step 6): buy one, move DNS to Cloudflare, enable Email Routing with a catch-all to the
  Worker, and deploy it with `wrangler`. I'll write the steps.
- **Shortcut** (step 4): build the shortcut on an iPhone from my recipe, share it, and paste the iCloud
  link into config. I can't produce an iCloud link from here.
- Phone tests listed in the table.

## Open questions for you

1. Approve steps 1 to 4 for this branch, with 5 to 7 after? Or a different cut?
2. Is the Android app on Play today, or sideloaded? This decides whether the SMS review applies yet.
3. Will you buy a domain for email (about Rs 800/yr), or skip email for now?
4. Should captured rows count in totals before you confirm them? (Recommended: yes; a likely duplicate
   doesn't.)
