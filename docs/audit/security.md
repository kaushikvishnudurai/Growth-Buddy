# Security and privacy audit — feat/overhaul

Date: 2026-10-11. Static reading only (no servers run, no requests sent). Scope: authorization /
IDOR across every controller that takes an id, frontend XSS sinks, injection, input validation,
CORS, CSP, committed secrets, client-side storage, anonymous endpoints, rate limits, export and
deletion. Items already fixed in `SECURITY_AUDIT.md` / `SECURITY_FIXES_APPLIED.md` are not
repeated. Paths are relative to `backend/src/main/java/com/growthbuddy/` unless they start with
`scripts/`, `public/` or the repo root.

Summary: 2 High, 6 Medium, 12 Low. No Critical. No IDOR was found: every id-taking endpoint in
tasks, goals, habits, notes, reminders, food, focus, money (doc, ledger, accounts, bank), mentor
threads, custom sounds, notifications, family, circle and mentorship is scoped to `CurrentUser`
(details at the end). No SQL injection: every concatenated SQL string is built from constants or
the fixed `USER_OWNED_TABLES` list.

| ID | Title | Sev | Effort |
|---|---|---|---|
| SEC-01 | Per-IP rate limits are one global bucket behind the proxy (`TRUST_PROXY` is never bound) | High | S |
| SEC-02 | Family invite exposes any user's DOB, height, weight, gender and diet without consent | High | S |
| SEC-03 | Web Push subscription endpoint is an unvalidated outbound URL (blind SSRF with a status oracle) | Medium | S |
| SEC-04 | `ClientIp` trusts the leftmost `X-Forwarded-For` entry once proxy trust is on | Medium | S |
| SEC-05 | CSP cannot be validated or enforced as built: Report-Only with no report endpoint, none in the Capacitor shell | Medium | M |
| SEC-06 | User search is unthrottled, wildcard-unescaped and returns partial emails | Medium | S |
| SEC-07 | Session expiry (401) leaves the previous account's API cache and per-user caches on the device | Medium | S |
| SEC-08 | `ui_prefs` / `feature_prefs` merges are unbounded | Medium | S |
| SEC-09 | Bearer token and full profile kept in one-year, JS-readable cookies | Low | S |
| SEC-10 | Quick-add habit names are unbounded and go straight into the model prompt | Low | S |
| SEC-11 | Mentorship invite create/revoke loop spams any user | Low | S |
| SEC-12 | Family invite/remove loop spams any user | Low | S |
| SEC-13 | Rate-limit key is the raw request URI, so path-parameter variants get fresh buckets | Low | S |
| SEC-14 | Circle invite link joins without confirmation | Low | S |
| SEC-15 | Data export omits several tables the user owns | Low | M |
| SEC-16 | Bank webhook secret travels in the query string (lands in access logs) | Low | S |
| SEC-17 | Bank-connect URL opened without a scheme check | Low | S |
| SEC-18 | Notes `SAFE_HREF` accepts protocol-relative links | Low | S |
| SEC-19 | WhatsApp webhook has no message-id dedup | Low | S |
| SEC-20 | Anonymous ticket endpoints carry no per-IP limit | Low | S |

---

## High

### SEC-01 Per-IP rate limits are one global bucket behind the proxy
- **Where:** `common/ClientIp.resolve`, `common/RateLimitInterceptor`, `common/AiRateLimitInterceptor`,
  `common/SecurityHeadersFilter` (all read `growthbuddy.trust-proxy`); `.env.example` key `TRUST_PROXY`.
- **Issue:** the code reads the property `growthbuddy.trust-proxy`. No YAML maps it, and the env var
  the docs tell operators to set (`TRUST_PROXY`) does not bind to it under relaxed binding (that would
  need `GROWTHBUDDY_TRUST_PROXY`). There is no `server.forward-headers-strategy` either. So in every
  real deployment (Render, or Caddy in `docker-compose.yml`), `getRemoteAddr()` is the proxy.
- **Exploit condition:** every client shares one IP key. The limit is 10 requests per 5 minutes per
  endpoint, across all users. One script sending 10 `POST /api/auth/login` (or signup, forgot-password,
  verify) per 5 minutes locks the whole user base out of that flow, and normal traffic hits the limit
  on its own once there are more than a handful of users. The per-IP fallback on anonymous AI calls,
  and HSTS (`X-Forwarded-Proto` is never trusted), are dead the same way.
- **Fix:** add `trust-proxy: ${TRUST_PROXY:false}` under `growthbuddy:` in `application.yml` and set
  it in prod. Ship it together with SEC-04, or enabling it opens a spoofing hole.

### SEC-02 Family invite exposes any user's body and diet data without consent
- **Where:** `family/FamilyService.linkMember` (the new-invite `else` branch copies `dob`, `gender`,
  `heightCm`, `weightKg`, `dietPreference` from the target `User`). Surfaced through
  `buildResponse` / `toMemberResponse` and `getFamily`, which return `invited` rows too.
- **Exploit condition:** any verified user can find another user's id with `GET /api/family/search`
  or `/api/users/browse`, then call `POST /api/family/members/link`. The response includes the
  target's date of birth, height, weight, gender and diet straight away. The target never accepts, and
  every mapped member of the inviter's family can read the same row. Combined with SEC-06 this can be
  repeated across the whole user base. `generateMealPlan` / `generateMultiDay` also put an unaccepted
  invitee's profile into the inviter's AI prompt.
- **Fix:** create the invite row with only the name and `linkedUserId`, and copy the profile in
  `acceptInvite` when the status flips to `mapped`. Until then, have `toMemberResponse` blank those
  fields when `status == invited`.

## Medium

### SEC-03 Web Push endpoint is an unvalidated outbound URL
- **Where:** `push/PushController.subscribe` (`SubscribeRequest.endpoint` only has `@NotBlank`),
  `push/PushService.subscribe` / `sendToUser`; `POST /api/push/test` returns the delivered count.
- **Exploit condition:** an authenticated user can register any URL as their endpoint, including
  `http`, internal hosts, link-local metadata addresses or `app:8080`, along with keys they generated
  themselves so encryption succeeds. `POST /api/push/test` then makes the server POST to that URL and
  reports `delivered: 1` for a 2xx, which gives a reachability and status oracle for internal
  addresses (a 404/410 also deletes the row, a second signal). Each call is one server-side request,
  and the number of subscriptions per user has no cap, so one account can fan out many.
- **Fix:** accept only `https:` endpoints whose host is a known push service (`fcm.googleapis.com`,
  `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`). Cap subscriptions per
  user (for example 10, dropping the oldest).

### SEC-04 `ClientIp` trusts the leftmost `X-Forwarded-For` entry
- **Where:** `common/ClientIp.resolve`.
- **Exploit condition:** once trust is on (the SEC-01 fix), the code takes the first `X-Forwarded-For`
  value. Caddy and Render append the real peer to whatever the client sent, so the leftmost value is
  attacker-chosen. A fresh value per request gives a fresh bucket: unlimited login, OTP and signup
  attempts per IP, leaving only the per-account `LoginAttemptGuard` as a brake.
- **Fix:** take the rightmost entry (the one the trusted proxy added), or N-from-the-right for N
  trusted hops. Alternatively, set `server.forward-headers-strategy: native` with a
  `RemoteIpValve` `internalProxies` pattern and drop the manual parsing.

### SEC-05 CSP cannot be validated or enforced as built
- **Where:** `common/SecurityHeadersFilter` (`CSP`, `growthbuddy.csp.enforce` default false);
  `index.html`.
- **Issue:**
  - The policy is Report-Only, and it has no `report-uri` / `report-to`. A violation only appears in
    that one user's devtools console, so the precondition for flipping it ("watch it against a
    production build") cannot be met from production traffic.
  - The Capacitor shell loads `index.html` from the device, so the app store builds get no CSP at all.
    `index.html` has no `<meta http-equiv="Content-Security-Policy">`.
  - `connect-src 'self' ws: wss:` allows a socket to any host, an exfiltration channel the rest of
    the policy otherwise closes.
- **Not a blocker:** nothing found in the shell needs relaxing. There are no inline scripts
  (`injectRegister: false`, `global-shim.js` is external), no `eval` / `new Function`, all fetches are
  same-origin, and SockJS stays same-origin.
- **Fix:** add `report-uri /api/client-errors` (or a sibling `/api/csp-report`, anonymous and
  rate-limited like client-errors), narrow `connect-src` to `'self'` plus the same-origin socket, put
  the same policy in a `<meta>` tag in `index.html` for the Capacitor shell, watch it for a week, then
  set `CSP_ENFORCE=true`.

### SEC-06 User search is unthrottled, wildcard-unescaped and leaks partial emails
- **Where:** `user/UserRepository.searchForFamily` (LIKE `concat('%', :q, '%')`), used by
  `family/FamilyService.searchUsers`; `user/UserController` `/search` and `/browse`.
- **Exploit condition:**
  - Neither search endpoint is in `RateLimitInterceptor`'s path list.
  - `/api/family/search` has no minimum query length.
  - `%` and `_` are not escaped, so `_` matches everyone.
  - Each hit returns the user id, display name, and an email mask keeping the first and last
    local-part characters plus the full domain. A 2-3 character local part is close to fully revealed.
  - Walking short prefixes, plus `/browse` (30 newest verified accounts with no query), enumerates the
    user base, and the ids it yields feed SEC-02.
- **Fix:** require `q.trim().length() >= 2`, escape `%`, `_` and `\` (with an `ESCAPE` clause), add a
  per-user `RateLimiter` cap (for example 30 per 5 minutes) on both search paths, and drop the domain
  from the mask.

### SEC-07 Session expiry leaves the previous account's cached data on the device
- **Where:** `scripts/app.js` `handleAuthExpired()`; `vite.config.js` workbox `runtimeCaching`
  cache `gb-api-get`.
- **Issue:** every `/api/` GET is cached NetworkFirst for 24h, keyed by URL only (the Authorization
  header is not part of the key). `logout()` and account deletion delete `gb-api-get` and run
  `purgeUserCache()`. The 401 path runs only `clearSession()`.
- **Exploit condition:** on a shared or family device, user A's session expires or is revoked (for
  example from another device's session list). User B signs in while offline, or on a network slower
  than the NetworkFirst timeout, and is served A's cached responses (tasks, notes list, profile, money)
  for the same URLs. A's per-user Cache API entries (`gb.money.<id>`, `gb.wellness.<id>` with photos,
  `gb.trends.*`) also stay behind.
- **Fix:** in `handleAuthExpired()`, call `purgeUserCache()` before nulling `state.user` and
  `caches.delete('gb-api-get')`, as `logout()` does. Optionally add a `cacheKeyWillBeUsed` plugin that
  puts the user id into the cache key.

### SEC-08 `ui_prefs` / `feature_prefs` merges are unbounded
- **Where:** `user/AuthService.updateUiPrefs` and `updateFeatures` (`UpdateUiPrefsRequest(Map<String,Object>)`,
  no `@Valid` or size checks).
- **Exploit condition:** a user can merge in arbitrary keys and nested values up to the 8 MB request
  cap, again and again, and the column keeps growing. Every `AuthUserResponse` (`/me`, every settings
  write) carries it back. The delivery, digest and push schedulers read `ui_prefs` for every user on
  every tick. One account can therefore bloat its row to the TiDB entry limit (6 MB), slowing every
  scheduler pass for all users, until writes to that row fail.
- **Fix:** allow-list the known keys (or cap at 100 keys), cap the serialized map at 32 KB and refuse
  with a 400 beyond it. Apply the same caps to `feature_prefs` (boolean values, at most 50 keys).

## Low

### SEC-09 Bearer token and full profile in one-year, JS-readable cookies
- **Where:** `scripts/cache-storage.js` `cookieEligible` / `setCookie`; `scripts/app.js` `saveSession`.
- **Issue:**
  - `gb.token` (the bearer token) and `gb.session` (the full user object: email, WhatsApp number,
    timezone) are cookies with `max-age=31536000`, not HttpOnly (JS-set), so they go out on every
    same-origin request including static assets.
  - The backend never reads cookies, so this is not CSRF, but any XSS reads the token in one line.
  - The token and PII also land in any proxy or CDN log that records cookies.
  - The token lives a year client-side, though the server TTL is 60 days.
- **Fix:** keep the token in the Cache API (already used for everything else) or in memory, and keep
  only non-sensitive first-paint keys (theme, text scale) in cookies. If a cookie must remain, shrink
  `gb.session` to `{id, displayName}`.

### SEC-10 Quick-add habit names are unbounded and go into the prompt
- **Where:** `quickadd/QuickAddController.QuickAddRequest` (`@Size(max = 100) List<String> habits`,
  with no element size), `quickadd/QuickAddService.parse` (`String.join(", ", habitNames)` into the
  system prompt).
- **Exploit condition:** 100 names of about 80 KB each fill the 8 MB body, and each of the 40 calls an
  hour sends that to the model. That is a large token-cost amplifier per account, and it puts
  user-chosen text in the system-prompt position.
- **Fix:** `List<@Size(max = 80) String>` with `@Valid`, or clip each name and the joined string
  (for example 4 KB) in `parse`.

### SEC-11 Mentorship invite create/revoke loop spams any user
- **Where:** `mentorship/MentorshipService.create` with `revoke`; `checkCanInvite` ignores `cancelled` rows.
- **Exploit condition:** create, revoke, create against any user id. Each create delivers a bell card,
  a WebSocket frame and a web push carrying sender-chosen text (the `note`, up to 500 characters).
  Revoking removes the card only after it has been delivered. There is no limit per sender.
- **Fix:** `limiter.allow("mentorship-invite:" + from, 10, DAY_MS)` in `create`, or treat a recent
  self-cancelled invite like the reject cooldown.

### SEC-12 Family invite/remove loop spams any user
- **Where:** `family/FamilyService.linkMember`, `removeMember`, `declineInvite`.
- **Exploit condition:** anyone can become a family owner by opening Family, then invite, remove and
  re-invite any user id without limit. Each cycle sends notifications, and each also triggers SEC-02.
- **Fix:** rate-limit `linkMember` per owner and per (owner, target) pair, the same way Circle cheers
  are limited.

### SEC-13 Rate-limit key is the raw request URI
- **Where:** `common/RateLimitInterceptor.preHandle` (`ClientIp + ":" + request.getRequestURI()`).
- **Exploit condition:** Spring routes `/api/auth/export;x=1` (a path parameter) and percent-encoded
  spellings to the same handler, and the interceptor pattern still matches. The raw URI differs, so
  each spelling gets its own bucket. Anonymous paths are safe, because `CurrentUserInterceptor`
  exact-matches the raw URI and 401s the variants. Authenticated limited paths are not: `export`,
  `circles/join-code`, `email/change`, `email/confirm`, `2fa/verify`, `2fa/disable`, the WhatsApp OTP
  pair. Effect: export DoS and more join-code guesses; the code-checking paths still have
  `LoginAttemptGuard`. (Inferred from Spring 6 `PathPattern` semantics; confirm with one request.)
- **Fix:** key on the matched pattern (`request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE)`)
  or on `ServletRequestPathUtils.getParsedRequestPath(request).pathWithinApplication().value()`
  without path parameters.

### SEC-14 Circle invite link joins without confirmation
- **Where:** `scripts/circle.js` `joinFromLink()`, `scripts/circle-core.js` `inviteFromHash()`.
- **Exploit condition:** a signed-in user who opens a crafted `#/circle?circle=<id>` or `?join=<code>`
  link is added at once. The attacker's circle then sees the victim's name and daily check-in state
  (subject to progress-sharing).
- **Fix:** fetch the circle's name first and show a "Join <name>?" confirm before `api.join` /
  `api.joinByCode`.

### SEC-15 Data export omits tables the user owns
- **Where:** `user/DataExportController.export` (reads only `USER_OWNED_TABLES` by `user_id`).
- **Issue:** tables keyed by a parent or another column are not exported, though the purge deletes
  them: `mentor_messages` (every Buddy chat message), `mentorship_requests` / `mentorship_messages`,
  the user's own `family_members` row (profile, conditions), `habit_streaks`,
  `calendar_reminder_skips`. A portability request (GDPR Art. 20, India DPDP) gets an incomplete copy
  of the most personal data.
- **Fix:** add the child tables by join (`thread_id IN (SELECT id FROM mentor_threads WHERE user_id = ?)`
  and so on), reusing the same parent list the purge uses. Extend `AccountDeletionCoverageTest` to
  assert every purged table is also exported or explicitly listed as excluded.

### SEC-16 Bank webhook secret in the query string
- **Where:** `money/BankFeedController.webhook` (`?token=`); `Caddyfile` `log` block.
- **Exploit condition:** the secret URL lands in every access log that records the request line
  (Caddy's log as configured, and any host or CDN logs). Anyone with log access can post forged
  notifications. Impact is small, because the body is only a hint and the service re-reads from Setu.
- **Fix:** move the secret to a header if Bridge supports one, or else keep the query but exclude
  that path from access logging. Rotate `SETU_WEBHOOK_TOKEN` if logs were shared.

### SEC-17 Bank-connect URL opened without a scheme check
- **Where:** `scripts/app.js` `openConnectBank()` (`window.open(r.url, ...)` / `Browser.open`),
  `money/BankFeedService.connect` (`url` from the aggregator).
- **Exploit condition:** only a compromised or misconfigured upstream response could supply a
  `javascript:` or `data:` URL. Users cannot influence it.
- **Fix:** require `^https://` on the server before returning `url`.

### SEC-18 Notes `SAFE_HREF` accepts protocol-relative links
- **Where:** `scripts/notes.js` `SAFE_HREF = /^(https?:|mailto:|#|\/)/i`.
- **Exploit condition:** `//host/...` and `/\host` pass the check and resolve off-origin. Notes are
  per-user with no sharing path, so this is a self-only phishing-link class, not XSS. The rest of
  `sanitize()` held up: allow-listed tags over an inert DOMParser tree, SVG/MathML unwrapped, raw-text
  containers unwrapped, images limited to `data:image/(png|jpeg|webp|gif);base64`.
- **Fix:** `/^(https?:|mailto:|#|\/(?![\/\\]))/i`.

### SEC-19 WhatsApp webhook has no message-id dedup
- **Where:** `money/WhatsAppWebhookController.receive`.
- **Exploit condition:** the signature proves origin but not freshness. Meta redelivers when a
  response is slow (a quick-add text runs a model call inline), and a redelivered or replayed signed
  body re-runs `QuickAddApplier`, so expenses, food and reminders are logged twice. Origin spoofing is
  not possible.
- **Fix:** record `messages[].id` (unique key, 48h retention like `idempotency_keys`) and skip ones
  already seen. Answer 200 before doing slow work.

### SEC-20 Anonymous ticket endpoints carry no per-IP limit
- **Where:** `common/WebConfig.addInterceptors` (path list), for `/api/reminders/snooze-link`,
  `/api/reminders/done-link`, `/api/habits/done-link`, `/api/whatsapp/webhook`, `/api/money/bank/webhook`.
- **Exploit condition:** tickets are HMAC-signed and cannot be forged, but each anonymous request
  still costs a body parse, an HMAC and, for a well-formed ticket, database reads. These are the only
  anonymous routes with no limit (client-errors and vitals have one). Low-cost flooding.
- **Fix:** add the three ticket paths to the `RateLimitInterceptor` list with a looser limit (for
  example 60 per 5 minutes), after SEC-01 and SEC-04 make per-IP meaningful.

---

## Checked and found OK

- **Auth gate:** `CurrentUserInterceptor` denies by default with an exact-match `ANONYMOUS_PATHS` set,
  and clears the ThreadLocal on async hand-off. Session tokens: 32 bytes from `SecureRandom`, stored as
  HMAC. `revokeById` is owner-scoped. Reset, change-password and delete revoke all sessions; enabling
  2FA revokes the others.
- **CORS:** bearer-only, `allowCredentials` off, explicit origins plus the Capacitor origins. No cookie
  auth, so no CSRF.
- **IDOR:**
  - Tasks, goals and goal actions, habits (`require`), notes and drafts (`findByIdAndUserId`),
    reminders (`findByIdAndUserId`), food entries and favourites (owner check), focus links (JPQL
    scoped by user).
  - Money ledger: composite PK `(user_id, id)`, foreign account ids nulled, deletes scoped. Money
    accounts (`requireAccount`), bank consents (`WHERE id = ? AND user_id = ?`).
  - Custom sounds, notifications (owner check), mentor threads (`requireThread`).
  - Family, Circle and Mentorship endpoints are all membership- or role-checked.
  - STOMP: CONNECT needs a bearer token, SUBSCRIBE only to `/user/queue/notifications`, SEND refused.
- **Injection:** `DataCleanupJob`, `AuthService` purge and `DataExportController` concatenate only
  constants or fixed table names. Everything else is parameterized JDBC/JPQL.
- **XSS:**
  - `h()` (`scripts/gb-kit.js`) sets string props via `setAttribute`, renders children as text, and
    binds `on*` only for functions.
  - mentor.js `richParts` and streaming use `textContent`.
  - Every note-body `innerHTML` write goes through `sanitize()`.
  - The service worker opens only server-constant URLs, and there are no `postMessage` listeners.
- **Anonymous endpoints:**
  - The WhatsApp webhook verifies HMAC over the raw body in constant time, and the acting user comes
    from a verified number.
  - `SnoozeLinks` tickets are per-purpose keyed, expire, and check the day.
  - Client-errors and vitals are clipped and rate-limited.
- **Secrets:** no real-looking keys in tracked files. `.env` and `prod.env` are git-ignored;
  `.env.example` and `prod.env.example` hold placeholders only. CI uses obvious CI-only values
  (`.github/workflows/ci.yml`: `SESSION_HMAC_SECRET`, `GB_AUDIT_PASSWORD`, `DB_PASSWORD`).
  `growth_buddy.sql` is schema-only. Gitleaks runs over full history in CI.
- **Prod config:** actuator exposes health only (default). The prod profile never logs email bodies
  (OTPs). AI image endpoints accept only `data:image/` URLs under 2 MB.
