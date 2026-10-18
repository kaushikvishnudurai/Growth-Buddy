# Handoff: build 108 follow-ups

Seven items left open after the 2026-10-18 bug sweep (33 bugs + 15 UI items, merged and pushed as build 108).
Ordered by risk. Items 1 to 5 are code; 6 is a judgement call; 7 is just state to know about.

## State (2026-10-18)

- Web: `/Users/kaush-zstch1550/github/Growth-Buddy`, `main` @ `354199b` (build 108), **pushed**, deployed via Render.
- Prod TiDB schema is current through build 108: the user ran the block and the check came back all 1s
  (`circle_removals`, `food_entries.piece_grams`, `push_subscriptions.endpoint_hash` + `ux_push_endpoint_hash`).
  Next schema change: diff `migrations.sql` from `354199b`.
- TiDB syntax trap: `ALTER TABLE t ADD UNIQUE INDEX IF NOT EXISTS ...` does not parse there. Use
  `CREATE UNIQUE INDEX IF NOT EXISTS name ON t (col)`.
- Mobile (`../Growth-Buddy-Mobile`) has **not** had `npm run sync` for build 108.
- Before every push, bump `BUILD` in `vite.config.js` (now 108). Commit as kaushikvishnudurai@gmail.com
  (repo-local config; check `git config user.email`).

## 1. TiDB: a plain read after the user lock can see an old snapshot (FIXED in the working tree, 2026-10-18)

**Status:** confirmed and fixed, not yet committed. A local TiDB nightly (TiUP, unistore; v8.5.x
segfaults at boot on this macOS in `go-m1cpu`) showed the plain read after the lock returning
`tokens=1` where MySQL returns `0`. Against the real backend, two concurrent freezes on a one-token
wallet both succeeded in 8 of 10 rounds; with the fix the result was 0 of 10, and the second
freeze got `400 No freezes left this week`. Fix: `@Transactional(isolation = READ_COMMITTED)` on
`HabitService.protect`/`checkin`, `TaskService.update`/both `toggle`s, and all three
`FocusService.record` overloads (the overloads self-invoke, so the outer annotation is the one
that applies). The why is on `ProgressService.lockUser` and in CODEMAP repo-wide trap 7. No CI test:
CI has MySQL only, and MySQL can't show the bug.


**What:** `ProgressService.lockUser` is `users.findForUpdate(userId)`. Callers take it, then read with plain
`findBy...` queries and decide on what they see. On TiDB (prod), a plain read inside the transaction can
still come from the transaction's start snapshot, not the latest commit, so two requests that queue on the
lock can both decide on the same old state. MySQL (InnoDB, REPEATABLE READ) takes its snapshot at the first
plain read, so a plain read right after the locking one sees the latest commit there: local tests and CI
pass, and this can be TiDB-only. The fixer found this while writing the mentorship fix, which already uses a
locking read (`MentorshipRequestRepository.lockAllBetween`) for exactly this reason.

**Where the pattern is used** (`grep -rn "lockUser(\|findForUpdate(" backend/src/main/java`):
- `habit/HabitService.java` `protect`: wallet read, then token spend. Two freezes at once can spend one
  token twice.
- `habit/HabitService.java` toggle (~line 856): check-in history read, then insert / XP.
- `task/TaskService.java` `update` (done=true) and `toggle`: completion history read, then 15 XP.
- `focus/FocusService.java` `record`: `secondsOnDay` sums sessions after `users.findForUpdate`. Two posts
  at once can both fit under the 24 h day cap.
- Already safe: `HealthReadingService.sync` (its read is `@Lock(PESSIMISTIC_WRITE)`) and `MentorshipService`
  (`lockAllBetween`).

**Fix options, smallest first:**
- Make the read each caller decides on a locking read: `@Lock(LockModeType.PESSIMISTIC_WRITE)` on the
  repository method, or a `... FOR UPDATE` query.
- Or run those transactions at READ COMMITTED: `@Transactional(isolation = Isolation.READ_COMMITTED)`.
  Check that TiDB honours it; TiDB supports RC in pessimistic mode.

**First, prove it.** Write an `*IT` (Testcontainers, the CI path) that runs two `protect` calls at once on a
1-token wallet and asserts one fails. MySQL will likely pass, so run the same test against a TiDB container
(`pingcap/tidb`, pessimistic mode, which is TiDB's default) to see the bug before fixing it.

## 2. Two tabs offline can still lose an op written in the same instant (frontend)

**Status (2026-10-18): FIXED, uncommitted.** No locks, no async: `cache-storage.js` `mergeQueue` merges a received queue of `{id}` items (incoming + this tab's unknown items − the writer's `gone` − ids this tab removed). Outbox + water queue; Money's pending ledger stays last-write-wins (If-Match catches it). `cache-storage.test.mjs` now queues in both tabs in the same instant; it fails on the old code.

**What:** `scripts/cache-storage.js` now broadcasts writes to the outbox, the water queue and Money's
pending ledger on a `BroadcastChannel('gb-store')`, and other tabs copy them into their in-memory map (see the
`ponytail:` comment above `TAB_SHARED`). If two tabs write the same queue within one message hop, each writes
its own whole array and one op is lost.

**Upgrade path, from the comment:** wrap the read-change-write in `navigator.locks.request('gb-outbox', ...)`
and read the Cache API copy inside the lock. That makes `outbox.enqueue` / `remove` / `store` async. Every
caller in `app.js` (`queueWrite`, `sendAhead`, `flushOutbox`, the water queue's `loadWaterQueue` /
`storeWaterQueue`) needs to await. `scripts/outbox.test.mjs` and `scripts/cache-storage.test.mjs` (which
already runs two module instances) are where to prove it.

**Worth it?** Only if two tabs open and offline at once is a real case. Phones run one webview. Decide
before building.

## 3. Buddy Retry can leave a message in the thread twice (frontend + backend)

**Status (2026-10-18): FIXED, uncommitted. No column, no migration.** The client's `messageId` (one `crypto.randomUUID()` per send, reused by Retry) becomes the user row's primary key; a repeat reuses the row and, if a reply is already saved for it, sends that as `done` with no model call (`MentorService.userMessage` / `replyTo`). An id naming another thread's row is ignored. Verified against the running backend: second send = one `done`, thread kept one pair.

**What:** `apiStream` in `app.js` no longer falls back to a plain POST on a network error, and `send()` in
`mentor.js` shows NO_CONNECTION with Retry, which streams again. `MentorService.completeStream` deletes the
saved user message when the client disconnects before any words arrive. But if the server notices the drop
late, or AI isn't configured, the first copy stays and Retry adds a second. Marked `ponytail:` in
`docs/scripts/mentor.js.md` (the `send()` row).

**Why no idempotency key:** `IdempotencyFilter` skips SSE responses.

**Fix:** have the client send a message id (`clientMessageId`) with the stream POST. The server keeps it on
the saved user message and, on a repeat id in the same thread, reuses that row instead of inserting. That
probably needs a column on the mentor messages table: follow the CLAUDE.md two-file schema rule and give
the user an idempotent TiDB block. Test it in `MentorService` unit tests.

## 4. Habit dialog: Category and Cadence button groups have no group name (a11y, frontend)

**Status (2026-10-18): FIXED, uncommitted.** Category and Cadence were already named: `a11y.js` `nameFields` names a radiogroup from the `.gb-field-label` before it, and `segmented` already renders `radiogroup` + `radio`/`aria-checked` (Money's copy too). The one unnamed group was Build/Break (no label before it): `aria-label` set in `habit-dialogs.js`.

**What:** `scripts/habit-dialogs.js` builds them with `segmented(...)` (`domain` ~line 733, `cadence` ~761,
and one more ~948). `segmented` lives in `scripts/app.js` (~line 9792); Money has its own copy in
`money.js`. A screen reader hears the buttons but not what the group is.

**Fix:** let `segmented` take an optional label and set `role="group"` + `aria-label` (or `aria-labelledby`
pointing at the visible `.gb-field-label`) on its container. Pass "Category" and "Cadence" from the habit
dialog. Check whether the buttons should be `role="radio"` in a `radiogroup` with `aria-checked`: they are
exclusive choices. Whichever you pick, make the Money copy match.

## 5. Goals' desktop width cap (UI, needs a browser)

**Status (2026-10-18): DONE, uncommitted.** Measured at 1024/1280/1440/1920: 900 gives exactly 260px columns (the two-column edge), 940 gives 273px with each card's buttons stacked, 1180 gives 304-353px with buttons side by side and the board's edge on the header's. Now 1180.

**What:** `styles/app.css`, inside `@media (min-width: 1024px)`: `.gb-goals { max-width: 940px; ... }`.
Other screens settled on 900 (reading) or 1180 (dashboards). Goals is a three-across board of
`minmax(260px)` columns. At 900 the content is exactly 820px, which is right where it drops to two
columns. 1180 changes the cards noticeably.

**Do:** run Vite + backend, sign in as the seeded QA account (memory `local-qa-account.md`), and
screenshot Goals at 1024, 1280, 1440 and 1920 for 940, 900 and 1180. Pick the one that keeps three columns
without over-wide cards, and update `docs/styles/app.css.md`. A Playwright MCP recipe is in memory
`playwright-mcp-qa-recipe.md`. Watch the ports and cookie traps in `parallel-agent-e2e-traps.md`.

## 6. Crisis check false positives (judgement call; not a bug)

**Status (2026-10-18): DONE, uncommitted.** Narrower than suggested here: `kms` still fires anywhere except right after a number or a quantity word ("ran 5 kms", "a few kms"), so "ugh kms" and "kms lol" still fire. Cases in `mentor.test.mjs`.

**What:** `CRISIS` / `crisisMatch` in `scripts/mentor.js` leans wide on purpose. A false positive costs one
helpline card; a miss costs more. Known false positives:
- "I'm going to die" (hyperbole)
- "I cut myself chopping"
- "ran 5 kms" (the bare `kms` token, line ~113)

**Only safe tightening:** `kms` as a whole message or next to "i/im/might/gonna" rather than anywhere,
e.g. `(i|im|might|gonna|will|wanna) kms`. Keep "kms" alone as a match. Any change gets cases in
`scripts/mentor.test.mjs`: every current must-fire case must still fire. **Don't narrow anything else
without the user's say-so.**

## 7. Local database already has build 108's schema

The live check on 2026-10-18 applied the three changes (`circle_removals`, `food_entries.piece_grams`,
`push_subscriptions.endpoint_hash` + unique key) to the local `growth_buddy` database on localhost:3306.
Nothing to do. Don't re-run them expecting them to be missing, and don't mistake them for drift.

## Checks before pushing anything from this list

`npm run lint`, every `node scripts/*.test.mjs`, `./mvnw test` in `backend/`, `npm run build && node
scripts/bundle-budget.mjs`, bump `BUILD`, then `npm run sync` in `../Growth-Buddy-Mobile`.
