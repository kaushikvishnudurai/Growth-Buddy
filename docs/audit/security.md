# Security audit, 2026-10-11 (build 92, local instance only)

Scope: http://localhost:8591 (scratch DB gb_ov1011) and the Vite dev server at :5591, with three seeded
accounts: A (owner of the data), B (attacker), C (A's mentorship partner). Nothing was sent to
production. No secret values appear in this file.

## What was checked and held up

- **IDOR, about 95 attempts** (B against A's data): habits (history, PUT, checkin, toggle, protect,
  DELETE), tasks, notes (GET, PATCH, draft, restore, delete, forever), reminders (PATCH, done, snooze,
  DELETE), goals and goal actions, task-to-foreign-goal link, focus session linked to a foreign task,
  money accounts, family members/profile/invite/chores/pantry/shopping, private and public circle
  (members, posts, comments, kudos, join, delete, transfer, cheer), Buddy threads, health readings,
  water and food entries, custom sounds, notifications, sessions, mentorship chat/agreement/week/nudge/
  revoke/accept, mentor progress status. Every one answered 400/403/404, and A's rows were unchanged
  afterwards. `money_transactions` has PK `(user_id, id)`, so a foreign id in `POST /api/money/tx`
  upserts into the caller's own rows. A mentee cannot read the mentor's status (403), only the mentor
  can read the mentee's.
- **Sessions**: a token is dead right after logout (401, and still 401 1.5 s later). After a password
  change every older token is 401. `DELETE /api/auth/sessions/{other user's id}` is 404. Junk bearer
  values, `/%61pi/`, `//`, a trailing slash and `;` path tricks all 401/405.
- **Lockouts and rate limits**: a wrong password from 8 rotating IPs locks the account after 6 tries
  (429, and the correct password is refused too). The same goes for verify OTP and reset-password OTP.
  One IP is cut off after 10 logins. Forgot-password answers 204 for known and unknown emails alike.
- **Body limits**: a 9 MB body gets 413 and a chunked body gets 411. Every DTO probed refuses
  out-of-range numbers, overlong strings and wrong types with 400 (water, food, health, focus, money
  tx/accounts, reminders, habits, notes labels). Days parameters are clamped. No 5xx came back from any
  of the 70 malformed requests.
- **ICS export**: CR/LF, `;`, `,` and `\` in reminder text and notes are escaped (`\n`, `\;`, ...), so
  no property or VEVENT can be injected.
- **WebSocket**: CONNECT needs a live token, only `/user/queue/notifications` can be subscribed, SEND is
  refused, and the token is re-checked on every pushed frame (code read, `WebSocketConfig.AuthInterceptor`).
- **Push SW handlers** (`public/push-handlers.js`): `url` and `doneLink` come only from server code
  (`ReminderDeliveryScheduler`, `HabitReminderDeliveryScheduler`, constants). A forged snooze-link or
  done-link ticket gets 404.
- **Secrets**: no key patterns turned up in tracked files, in `git log -p --all`, or in `dist/assets`.
  No `.map` files exist in `dist/`. `.env` is in `.gitignore`. The prod image sets
  `SPRING_PROFILES_ACTIVE=prod` (`backend/Dockerfile`), and under it `SessionService.rejectWeakSecret`
  refuses the dev default HMAC secret and any secret shorter than 32 characters.
- **Earlier report (SECURITY_AUDIT.md), "fixed" claims checked**: Issue 1 (bad base64): it now returns
  400 "didn't upload cleanly". Issue 3 (access denial): a foreign sound id is 404 on GET/PUT/PATCH, and
  DELETE is scoped by `deleteByIdAndUserId`. MIME allow-list: a `data:text/html` upload is refused with
  400. Export: `Cache-Control: no-store` is present. The open item "flip CSP to enforcing" is still open
  (SEC-3).
- **Frontend HTML sinks**: the only user-controlled `innerHTML` is the notes body, and it always goes
  through `sanitize()`. Circle posts, comments, chat, display names and reminder text are all rendered
  through `h()` as text nodes. `sanitize()` was reviewed in code: it uses an allow-list over a DOMParser
  tree, unwraps foreign-namespace elements (their lowercase `tagName` never matches `ALLOWED`), drops
  raw-text containers, and allows image `src` only as raster data URLs. **Not done in this pass**:
  rendering hostile payloads in a browser and watching for execution. Only the href gap below was found.

## Findings

### SEC-1: Reminder occurrences accept an unbounded date range (one request = 725 MB, 16 s)
- Severity: Medium
- Where: `backend/.../reminder/ReminderController.occurrences` -> `ReminderService.occurrences`
- Repro / evidence: account A has 3 reminders. `GET /api/reminders/occurrences?from=0001-01-01&to=9999-12-31`
  returns 200 with 725,127,946 bytes in 16.5 s. The range 1900..2900 returns 79 MB in 1.1 s. The full
  list is built in memory before it is serialised, so a few parallel calls from one signed-in account
  can exhaust the heap of a free-tier instance. `day/{date}` is fine (one day).
- Cause: `occurrences()` only checks `to >= from`. The loop runs once per day times once per reminder,
  with no cap.
- Fix: clamp the span in `ReminderService.occurrences`. The calendar asks for a month or so, so refuse
  (400) anything over, say, 400 days, like `habits/history`. One unit test.

### SEC-2: Opening a circle invite link joins the circle without asking
- Severity: Medium
- Where: `scripts/circle.js:joinFromLink` (with `circle-core.js:inviteFromHash`), Circle screen
- Repro / evidence: B was not a member of A's public circle (checked through the API). B opens
  `http://localhost:5591/#/circle?circle=<circleId>`. Four seconds later B is a member, and the members
  list B now shares reports each member's `doneToday`. Screenshot:
  `docs/evidence/audit-security/circle-autojoin.jpg`. A `#/circle?join=<code>` link does the same for a
  private circle.
- Cause: `joinFromLink()` calls `api.join` / `api.joinByCode` as soon as the screen mounts. There is no
  confirmation.
- Impact: anyone can drop a link in a chat and quietly pull the person who taps it into a circle they
  run. The victim's daily progress then shows to that circle (unless they keep progress private), and
  they start getting its posts and cheers. This is a cross-site action triggered by a link, the same
  class of problem as CSRF.
- Fix: in `joinFromLink`, fetch the circle (name, owner, member count) and show a "Join <name>?"
  dialog. Join only when the user confirms. No backend change is needed.

### SEC-3: CSP is still Report-Only, and nothing collects the reports
- Severity: Medium
- Where: `backend/.../common/SecurityHeadersFilter` (`CSP_ENFORCE` default false)
- Repro / evidence: `curl -D - http://localhost:8591/` returns `Content-Security-Policy-Report-Only:
  default-src 'self'; script-src 'self'; ...`. The policy has no `report-uri` or `report-to` directive,
  and no endpoint exists to receive reports.
- Cause: the 2026-10-10 addendum left enforcement until the policy "has been watched against a
  production build". With no reporting directive, violations appear only in each visitor's own
  console, so that watching can never happen and the open item can never close. For now the header
  gives no protection against XSS.
- Fix: two options. (a) Add `report-uri /api/client-errors` (it is already anonymous, rate-limited and
  clipped; accept `application/csp-report` there), watch the log for a few days, then set
  `CSP_ENFORCE=true`. (b) Enforce now: `index.html` already has no inline script (`global-shim.js` is
  external) and the bundle loads nothing from third-party origins (only w3.org/example.com strings
  appear in it). While there, consider narrowing `img-src https:` to `'self' data: blob:`, because notes
  already refuse remote images.

### SEC-4: Offline API cache survives a remote sign-out; no-store responses are cached anyway
- Severity: Medium
- Where: `scripts/app.js:handleAuthExpired` and `clearSession`; `vite.config.js` workbox `runtimeCaching`
  (`gb-api-get`)
- Repro / evidence (code read; the SW is disabled on the dev server, so this was not reproduced in a
  browser): `logout()` and delete-account call `caches.delete('gb-api-get')`. `handleAuthExpired()`,
  which runs on any 401, calls `clearSession()`, and neither function touches that cache. A 401 is what
  a device gets after the user signs it out from another device (`DELETE /api/auth/sessions/{id}`),
  changes their password, or resets it: exactly the cases where a lost or stolen phone should lose
  the data. The runtime route caches every `GET /api/**` with status 200 for 24 h. Workbox's
  NetworkFirst does not honour `Cache-Control: no-store`, so `/api/auth/export` (the whole account as
  JSON), `/api/auth/sessions`, notes, money and health readings all stay in Cache Storage on that device.
- Fix: delete `gb-api-get` inside `clearSession()`, so every path that ends the session clears it. Also
  exclude `/api/auth/` from the `gb-api-get` `urlPattern` in `vite.config.js`: export and sessions have
  no offline use.

### SEC-5: Session token sits in a script-readable, year-long cookie sent on every request
- Severity: Low
- Where: `scripts/cache-storage.js:setCookie` / `cookieEligible` (`gb.token`, `gb.session`)
- Repro / evidence: a Playwright context after sign-in shows `gb.token httpOnly=false sameSite=Lax`.
  `max-age=31536000` is a year, while server sessions last 60 days. The cookie goes to the server with
  every same-origin request, static assets included, even though the API authenticates only by the
  `Authorization` header.
- Impact: any script injection can read the token, and with SEC-3 there is no CSP to stop that script.
  The token also appears in the `Cookie` header of every request, where proxies and logs can see it.
  CSRF is not possible, because the server ignores the cookie.
- Fix (smallest step): set the cookie's `max-age` to the 60-day session TTL. Longer term, keep the
  token out of `document.cookie` (memory plus a non-cookie store, which the Cache API path already
  provides), since the server never reads the cookie.

### SEC-6: With trust-proxy on, the client-supplied left-most X-Forwarded-For entry is trusted
- Severity: Low (depends on deploy config)
- Where: `backend/.../common/ClientIp.resolve`, used by `RateLimitInterceptor` and `SessionService`
- Repro / evidence: the local backend runs with `growthbuddy.trust-proxy=true`. Every request carrying
  a different `X-Forwarded-For` got a fresh per-IP budget (the seeder depends on this), and the session
  list shows the spoofed IP. Render and most proxies append the real client address to the right of
  whatever the client sent, so taking the first entry hands the choice of IP to the client. With the
  default (`false`) behind Render, every client shares the proxy's address, and one noisy user can
  trigger the 10-per-5-min auth limit for everyone. The production value could not be checked from
  the repo; DEPLOYING.md does not mention it.
- Fix: in `ClientIp.resolve`, take the right-most entry (or right-most minus a configured number of
  trusted hops) instead of the first. Document `GROWTHBUDDY_TRUST_PROXY=true` for Render in
  DEPLOYING.md.

### SEC-7: Note link filter lets a tab-prefixed path through to another site
- Severity: Low
- Where: `scripts/notes.js:SAFE_HREF` (used by `sanitize()` and the link dialog)
- Repro / evidence: `SAFE_HREF.test('/\t/other.example/x')` is true. The pattern only stops `//` and
  `/\`. `new URL('/\t/other.example/x', 'https://app.example/')` resolves to
  `https://other.example/x`, because the URL parser strips tab and newline characters. A note link
  that looks like an in-app path therefore opens another origin. Impact is small: notes are only ever
  shown to their author, and the link gets `target=_blank rel=noopener noreferrer`.
- Fix: in `sanitize()` and the link dialog, remove `[\t\n\r]` from the href before testing, or resolve
  it with `new URL(href, location.href)` and accept either an http(s)/mailto URL or the same origin.

### SEC-8: Sleep and mood fields are stored without format checks
- Severity: Low
- Where: `backend/.../wellness/WellnessDtos.SleepRequest` / `MoodRequest`
- Repro / evidence: `POST /api/daily-logs/sleep {bedtime:"99:99", wakeTime:"-1", quality:"x"}` and
  `POST /api/daily-logs/mood {mood:"<b>", energy:"x", stress:"y"}` both return 204, and
  `GET /api/daily-logs` hands back exactly those strings. They are also written into the Buddy AI
  context (`WellnessService` check-in summary). Task titles likewise accept a NUL character and a
  lone UTF-16 surrogate (201). All of these are rendered as text, so no XSS was found. The problem is
  bad data plus a small path into the model's prompt.
- Fix: add `@Pattern("^([01]\\d|2[0-3]):[0-5]\\d$")` on bedtime/wakeTime and an allow-list for
  quality/mood/energy/stress (the values the UI offers), in `WellnessDtos`.

## Counts

Critical 0, High 0, Medium 4, Low 4.
