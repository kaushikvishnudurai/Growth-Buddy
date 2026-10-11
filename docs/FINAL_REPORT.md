# Overhaul final report (2026-10-11 to 2026-10-12, builds 92 to 97)

Branch `overhaul/2026-10-11`, worktree `../GB-overhaul-1011`. Every fix branch is merged; the
integration branch was `ov1011/int-design`. Audits live in `docs/audit/`, evidence in `docs/evidence/`,
decisions in `docs/DECISIONS.md`, the task ledger in `docs/LEDGER.md`, ideas in `docs/IDEAS.md`, the
rest of the roadmap in `docs/ROADMAP.md`, research in `docs/RESEARCH.md`.

## How it ran

| Step | Agents | Output |
|---|---|---|
| 1 Understand | orchestrator | `PROJECT_MAP.md`, e2e harness (seeder, CDP-attached Playwright, console/network guard) |
| 2 Baseline | 18 audits (4 explorers, 3 code reviewers, UI, responsive/parity, performance, accessibility, security, 2 friction, market research, offline integrity, first run, content states) | about 230 findings in `docs/audit/` |
| 3 Safety net | 3 | `e2e/safety-*.spec.mjs` across every module |
| 4 Build and fix | 16 fix agents + 2 backend rounds + design system + mobile parity | one branch each, merged and re-tested |
| 5 Wow layer | strategist + 2 builders | 32 scored ideas; command palette and Take a break built |
| 6 Adversarial | hostile, new-user, cross-browser testers + 9 integration and fix agents | every failure fixed or traced |

## User requests handled

- L-002 Food on a phone: the field is first and focused, foods had before are one row, one tap logs
  one, portions remembered, no AI wait on save.
- L-003 Health: the summary sentence closes the screen.

## What changed, by area (highlights; full lists in the merge commits)

- **Backend (3 rounds, 778 tests):** signup deadlock and same-email race, reminder range cap, client
  IP from the right-most hop and `TRUST_PROXY` bound, digest claims its day, request bounds,
  N+1 queries, CSP report endpoint, future and pre-1900 money refused, ledger tombstones (a stale
  edit can't resurrect a delete), Quick add weekday and passed-time dates, XP follows the tick,
  goal progress versioned, explicit done on toggles, storable due-date window, invisible names
  refused, the first Money save records its account seed.
- **Shell:** overlays close on sign-out, boot waves guarded across an account switch, write-ahead
  outbox (a reload mid-request loses nothing), logout flushes or asks, theme change without a full
  render, panels on the back stack, retry timer, account refresh on reload, cache cleared on 401.
- **Capture:** one clear Quick add read saves at once with Undo, due time read from a task title,
  tomorrow's plan after 21:00, one-tap mood logs the night.
- **Onboarding:** sign-up first, one plan sheet with a ready plan, 17 taps to 5 to the first habit
  ticked; a Family meals pack (parent: 9 taps to today's meal plan, no guessing).
- **Money:** challenges judged on their own window, no instant overdue bill, split a bill books your
  share, statement maths, purchase advisor, Undo instead of confirm, no day-one budget from one lunch.
- **Planning:** goal edit works again (it always failed), notes caret kept, Undo on deletes, field
  errors, link filter, note card semantics.
- **Social:** circle invite links ask before joining, replies no longer vanish, family member in one
  form, Report no longer scrolls sideways.
- **Design system:** themed pill tokens (dark mode), one font reset, 3:1 control borders and a focus
  ring, scrim token, toast motion, desktop alignment, 200% text, 44 px targets.
- **Performance:** native WebSocket (sockjs gone), static sign-up shell, wave 2 before first render,
  lazy Outlook, achievements and celebrate, one variable font, terser.
- **App wrapper:** every export goes to the share sheet (plugins on `ov1011/mobile`), offline cold
  start shows saved data, microphone permission, right cutout.
- **Wow features:** command palette (Ctrl/Cmd+K, `/`, `g` shortcuts, search across your items, free
  text into Quick add) and Take a break (streaks hold for 3/7/14 days, nudges quiet, one tap each way).
- **Cross-browser fixes:** time zones compared by offset (Safari and iOS no longer get a false "Switch to Kolkata time?"), tablet frame full height, keepalive on prefs and revoke, an offline prefs save resent when back online, color-mix fallbacks for iOS 15-16.1.
- **Hostile fixes:** taps settle on lists (no double delete or tick), Undo restores the burst, goal
  saves chained and merged.

## Tests at release 2 (build 97)

| Check | Result |
|---|---|
| `./mvnw test` | 778 run, 0 failures |
| `npm run lint`, every `scripts/*.test.mjs` | clean / pass |
| Playwright, 22 specs, desktop + mobile Chrome | 331/334 on the last full run; the 3 were fixed and re-run 88/88 (each twice) |
| Cross-browser (desktop/mobile/tablet Chrome, Firefox, desktop/mobile WebKit) | 390/402 on smoke + safety + shell + native + perf + planning + xbrowser specs; the 6 failures were OFF-6 (a stale allow-list), since fixed; 6 WebKit skips by design (ephemeral sessions) |
| Bundle budget | boot 98.8%, precache 99.1%, budgets never raised |

## Lighthouse (production build)

| Run | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| Signed out, mobile / desktop | 92-93 / 100 | 100 / 100 | 100 / 100 | 100 / 100 |
| Home, mobile / desktop | 81-83 / 99 | 100 / 100 | 100 / 100 | 100 / 100 |

Before: Home Best Practices 81, Accessibility 94, SEO 91.

## Known limitations and risks

- **Home on mobile is below 90 Performance.** The rest is bytes on the critical path (boot chunk
  about 164 kB gzip, CSS 55 kB); next levers are splitting calendar and settings out of the boot
  chunk and moving money.css out of the render-blocking sheet.
- **iOS 15.0-16.1:** decorative tints and gradients that use color-mix() render plain (core colours have fallbacks).
- **Budgets are tight** (98.8% / 99.1%): the next feature must be lazy or pay for itself.
- **Not verified on a real device:** share sheet, mic and camera prompts, offline cold start in the
  APK, right-cutout padding. Needs `npm run sync` and a phone.
- **Email verification still gates first value** (about 26 s). Letting users in first is a security
  trade-off left to the owner.
- **Circle "Find someone" lists every user** (masked email): a product/privacy decision left open.
- **Prod config:** set `TRUST_PROXY=true` on Render; run the `money_tx_tombstones` CREATE before
  deploying (every Money delete fails without it).
- Test environment: one shared machine at load average 30-70; several flakes were load, and the
  harness now gives each test its own forwarded address and each agent its own browser.

## Next version (from `ROADMAP.md`, top first)

1. Live bank feed (Setu credentials, sandbox test).
2. Reply to a WhatsApp reminder to log ("spent 240 chai", "done gym").
3. Evening close-out sheet (about 25 taps to 7).
4. Bill splitting with UPI settle-up.
5. Two-way Google Calendar sync.
6. Home-screen widgets.
7. Indian food quick picks in katori, piece and plate portions.
8. Hindi and Tamil (needs a reviewer).
