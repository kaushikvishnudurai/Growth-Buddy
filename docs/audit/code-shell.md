# Code review: frontend shell (CRS)

Scope: scripts/app.js (with docs/scripts/app.js.md), gb-kit.js, cache-storage.js, outbox.js, a11y.js,
toast.js, push.js, native.js, error-report.js, vitals.js, dashboard.js, home-order.js, achievements.js.

Checks run on build 92:
- `npm run lint`: clean.
- Every `scripts/*.test.mjs` (30 files, including outbox, push, money-ledger, money-merge, recurrence,
  insights, review, tokens, icons, app-logic): all pass, exit 0.

Traced and found sound (no finding): outbox collapse/flush rules and the single-flight flush;
`queueWrite` / `flushOutbox` waiting on `CacheStorage.ready()`; the toggle paths against a flush in
flight (two flips stay two flips, the post-flush refetch corrects the paint); WebSocket reconnect
(`beforeConnect` re-reads the token, `wsConnecting` guards the import window); `popoverCleanup`;
a11y.js observers (disconnected when their dialog leaves); the recorder intervals in Settings and
the tone dialog (both cleared, both cancel on close); the money ETag (a content hash, so a stale
`moneyVersion` after an account switch can only 409 and merge, never overwrite).

### CRS-1: Signing out from Settings leaves the Settings dialog open over the sign-in screen, showing the old account
- Severity: High
- Where: app.js `logout`, `handleAuthExpired`, `resetUserState`; Settings > Account > Sign out, 390x844
- Repro / evidence: seeded account, Account menu > Settings > Account tab > Sign out. The sign-in form
  renders under it, and `.gb-modal-overlay.is-open` stays at 1, with the text "Settings / Asha Rao /
  e2e.1791740045444.5273@example.com / Level 1 · 0 XP / ... Sign out / PRIVACY ...". So the previous
  account's name, email, devices and every settings pane stay up on a signed-out device until someone
  closes them. Screenshot: docs/evidence/audit-crs/settings-signout.jpg
- Cause: `logout()` and `handleAuthExpired()` never call gb-kit's `closeOverlays()`. Only `setScreen`
  does, and neither path goes through it. `handleAuthExpired` has the same gap: any dialog open when a
  401 lands (session revoked from another device, password changed elsewhere) stays over the sign-in
  screen. A control touched in that orphaned sheet then fires a request with no token, gets a 401, and
  runs `handleAuthExpired` again.
- Fix: in app.js `resetUserState()`, which both paths share, close every live overlay next to
  `popoverCleanup?.()`. Use each entry's `close()`, not `dismiss`. The note editor's `onDismiss` commits
  through `api()`, and with the token gone that is one more 401 round. `clearSession` already drops the
  note draft. This needs a small gb-kit.js change: `closeOverlays({ discard: true })` calls
  `entry.close()` for every entry.

### CRS-2: Signing out while the second boot wave is in flight saves the old account's data to `.guest` keys and shows "Your session ended"
- Severity: Medium
- Where: app.js `loadData`, `loadSecondaryData`, the `*StorageKey(user)` helpers, `api` (`_inflightGets`)
- Repro / evidence: seeded account, with `/api/money` held for 4 s after the server answers (Playwright
  `route.fetch` then `fulfill`). Sign in, then Account > Log out as soon as Home paints. 7 s later the
  Cache API `gb-store-v2` holds `gb.money.guest`, `gb.wellness.guest`, `gb.goalProgress.guest` and
  `gb.trends.guest`, the signed-out account's data. The console shows
  `CRITICAL: recordTrendsToday snapshot failed to reach database: Error: Your session expired`, and the
  sign-in screen of someone who just chose to log out shows "Your session ended. Sign in again."
  Screenshot: docs/evidence/audit-crs/logout-wave2.jpg
- Cause: `loadSecondaryData` writes its answers to state and cache after `await Promise.all(...)` without
  checking that the same user is still signed in. With `state.user` null, `moneyStorageKey()` (and the
  wellness, goal-progress and trends key helpers) fall back to `loadSession() || {}`, then to `'guest'`.
  `purgeUserCache` matches by the old user id only, so these keys are never removed. They are also what
  `loadMoney()` and friends read at a signed-out boot. `recordTrendsToday()` then POSTs with no token,
  gets a 401, and calls `handleAuthExpired()`. `loadData` wave 1 has the same unguarded await.
  `api()`'s `_inflightGets` dedupe is keyed by path alone and not cleared on sign-out, so a GET still
  running for one account can be handed to the next account's identical GET.
- Fix: in `loadData` and `loadSecondaryData`, capture `const who = state.user` before each await and
  return when `state.user !== who` afterwards. In `resetUserState`, call `_inflightGets.clear()`.
  Optionally, `purgeUserCache` also removes `*.guest` keys. All changes are in app.js.

### CRS-3: Deleting the account leaves this browser subscribed to web push and the account's caches on the device
- Severity: Medium
- Where: app.js `openDeleteAccount` (confirm handler); backend push/ and AuthService.deleteAccount
- Repro / evidence: code path read end to end. The confirm handler calls `cancelPendingLocalNotifications`,
  deletes `gb-api-get`, runs `clearSession()` and reloads. It never calls `disablePush` and never calls
  `purgeUserCache`. On the server, `AuthService.deleteAccount` only revokes sessions and stamps
  `deletionRequestedAt`. The push subscription row stays (PushService and PushRepository have no session
  or deletion check), and nothing in reminder delivery reads `deletionRequestedAt` (it is read only by
  `ReflectionScheduler`). So for the 7-day grace period this browser keeps receiving the deleted
  account's reminder pushes, which `logout()`'s own comment names as the thing to prevent. The account's
  money, wellness, goal-progress, trends and outbox keys, plus a kept money pending queue, also stay in
  the Cache API.
- Fix: app.js, in the confirm handler, run `disablePush` with a token-bound fetch (as `logout()` does)
  before the delete POST, then `purgeUserCache()` before `clearSession()`. Simplest: reuse `logout()`'s
  teardown after the POST succeeds. Belt and braces on the server: delete the user's push subscriptions
  in `AuthService.deleteAccount`.

### CRS-4: Device alarm syncs are not serialized, so a sign-out can be followed by an in-flight sync re-arming the old account's alarms
- Severity: Low
- Where: push.js `syncDeviceAlarms`, app.js `reSyncDeviceAlarms`, `logout` (`cancelPendingLocalNotifications`)
- Repro / evidence: code read. `syncDeviceAlarms` awaits permission, then `registerNotificationActions`,
  then `cancelPendingLocalNotifications`, then schedules the queue it computed at the start. Nothing
  orders one call against another or against logout's cancel. `reSyncDeviceAlarms` fires from many places
  close together (boot after wave 1, `loadWaterUsualHours`, the outbox refetch, habit and reminder
  writes). If logout's cancel lands between an in-flight sync's cancel and its schedule, the next person
  on the phone gets the previous account's reminders, habits and water nudges. Two syncs interleaved
  (A cancels, B cancels, B schedules, A schedules) leave A's older list armed, for example a reminder
  that was just deleted.
- Fix: push.js chains every sync on one promise (`chain = chain.then(() => run(opts))`) and exports a
  `cancelAllAlarms()` that goes through the same chain. `logout` uses that, and app.js
  `reSyncDeviceAlarms` returns early without `state.user`. A native-only race with a window of a few
  bridge round trips, hence Low.

## Counts
Critical 0, High 1, Medium 2, Low 1. Lint and all 30 test files pass.
