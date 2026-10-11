# Audit report

Ten parallel audits of build 88 (`main` @ 367ed2a, 2026-10-11), each in `docs/audit/<area>.md`, plus
a runtime pass: `scripts/ui-audit.mjs` (11 screens x 2 widths, 9 dialogs, 2 header panels: **clean**)
and Lighthouse on the production build, signed in, on Home.

| Lighthouse (before) | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| Mobile | 80 | 98 | 82 | 91 |
| Desktop | 99 | 94 | 81 | 91 |

Lighthouse failures: render-blocking CSS (755 ms) and `global-shim.js` (305 ms), FCP 3.1 s / LCP 4.1 s
on mobile, heading order, contrast on a `.gb-pill` and the mini calendar's other-month days, one
deprecated `unload` listener, no robots.txt.

## Totals

| Area | File | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| Functional | `functional.md` | 0 | 7 | 4 | 10 |
| JS quality | `js-quality.md` | 0 | 2 | 5 | 7 |
| HTML/CSS/UI | `ui-css.md` | 0 | 4 | 9 | 11 |
| Responsive | `responsive.md` | 0 | 1 | 11 | 10 |
| Web vs app | `parity.md` | 0 | 6 | 9 | 6 |
| Performance | `performance.md` | 0 | 2 | 8 | 11 |
| Accessibility | `accessibility.md` | 0 | 4 | 7 | 5 |
| Security | `security.md` | 0 | 2 | 6 | 12 |
| SEO / PWA | `seo-pwa.md` | 0 | 3 | 4 | 10 |
| UX friction | `ux-friction.md` | 0 | 5 | 10 | 5 |
| **Total** | | **0** | **36** | **73** | **87** |

Some findings are the same bug seen from two angles. Each was given to one owner, and the duplicates
are listed under "Merged duplicates" below.

## High, by effort

**Effort S (small)**

| ID | Finding | Owner branch |
|---|---|---|
| SEC-01 | Per-IP rate limits are one global bucket behind the proxy (`TRUST_PROXY` never bound) | `ov-sec` |
| SEC-02 | Family invite exposes any user's DOB, height, weight, gender and diet before they accept | `ov-sec` |
| SP-02 | `/privacy.html` returns 404 in production | `ov-pwa` |
| SP-03 / SEC-07 | Session expiry leaves the previous account's API cache on the device | `ov-session` |
| FN-03 | `saveUiPrefs` PUTs the whole stale blob and reverts other devices' settings | `ov-func` |
| FN-07 | A focus session linked to a deleted task fails, and so does every later one | `ov-func` |
| JQ-02 | Signing out from Settings leaves the sheet open over sign-in, showing the old account | `ov-session` |
| P1 (parity) | A boot-time throw leaves the app on the splash screen forever | `ov-pwa` |
| P6 (parity) | iOS: no camera usage string, so taking a photo crashes the app | `ov-parity` (native patch) |
| P1 (perf) | Every render rebuilds every icon SVG in the document | `ov-perf` |
| P2 (perf) | `GET /api/tasks` runs one query per task on a first-paint call | `ov-perf` |
| A11Y-02 | Focus rings drawn in `--brand` (2.8:1); text fields show no ring at all | `ov-uicss` |
| A11Y-03 | Small light-theme text under 4.5:1 (notification links, bell badge, chips) | `ov-uicss` |
| A11Y-04 | `<html lang>` set to the device locale while every string is English | `ov-a11y` |
| R-01 | Desktop sidebar is clipped on 1366x768 laptops; Circle and Family unreachable | `ov-resp` |
| UI-01..03 | Info toast, food total and snooze chips unreadable in dark mode (1.4-2.3:1) | `ov-uicss` |
| UI-04 | Premium skin's primary button fails text contrast (2.3-3.6:1) | `ov-uicss` |
| F01, F02 | First-run asks for a timezone it has and features that are already on | deferred: `feat/life-plan` owns first-run |
| F04 | Budgets start blank although 30 days of spending can suggest them | `ov-ux-modules` |
| F06 | Focus from a task row stops on a Start button | `ov-ux-flows` |

**Effort M (medium)**

| ID | Finding | Owner branch |
|---|---|---|
| FN-01 | Offline Money document edits (loans, bills paid, budgets) are lost on the next load | `ov-func` |
| FN-02 | Sleep and mood entries that fail to sync are silently wiped | `ov-func` |
| FN-05, FN-06 | Money conflict merge reverts local edits; a stale save replaces the live doc | `ov-func` |
| JQ-01 / FN-04 | `logout()` and `handleAuthExpired()` reset different halves of the session | `ov-session` |
| SP-01 | New deploys never reach an open or installed app; no update prompt | `ov-pwa` |
| P2 (parity) | Circle invites shared from the app point at `https://localhost` | `ov-pwa` |
| P3 (parity) | Offline cold start in the app shows the crash card | `ov-session` |
| P4, P5 (parity) | Sound recording always refused on Android; every export claims success and saves nothing | `ov-parity` (native patch), `ov-pwa` (honest toasts) |
| A11Y-01 | Off switches, unchecked checks, input borders under 3:1 | `ov-uicss` |
| F05 | "Reminder" jumps to Calendar and asks for the time from scratch | `ov-ux-flows` |

## Medium (73) and Low (87)

Listed per area with file, symbol, scenario and fix in each `docs/audit/<area>.md`. Owners:

| Area | Medium | Low | Owner |
|---|---|---|---|
| Functional | FN-08..11 | FN-12..21 | `ov-func` (except FN-15 → `ov-undo`) |
| JS quality | JQ-03..07 | JQ-08..14 | `ov-session` |
| UI/CSS | UI-05..13 | UI-14..24 | `ov-uicss` |
| Responsive | R-02, R-03, R-05..R-12 | R-13..22 | `ov-resp` (R-04 → `ov-uicss` as UI-05) |
| Parity | P7..P15 | P16..P21 | `ov-parity` (web + native patch) |
| Performance | P3..P10 | P11..P21 | `ov-perf` |
| Accessibility | A11Y-05, 06 (contrast) | | `ov-uicss` |
| Accessibility | A11Y-07..11 | A11Y-12..16 | `ov-a11y` |
| Security | SEC-03..06, 08 | SEC-09..20 | `ov-sec` |
| SEO / PWA | SP-04..07 | SP-08..17 | `ov-pwa` (SP-05 → `ov-session`) |
| UX friction | F03, F07..F15 | F16..F20 | `ov-ux-flows`, `ov-ux-modules`; F03, F20 deferred to `feat/life-plan` |

## Merged duplicates

- SP-03 = SEC-07 = part of JQ-01; FN-04 = JQ-01; FN-13 = JQ-05: one session-teardown fix.
- R-04 = UI-05 (premium skin breaks the landscape rail); R-14 = UI-24 (`:hover` outside `(hover: hover)`).
- A11Y-01 overlaps UI-07 (switches); A11Y-02 overlaps UI-06 (focus indicator).
- Perf P12 (SW writes every API GET) relates to SP-04 / SP-05 (what gets cached, for how long).

## Not fixable from this repo

- Native Android/iOS config (permissions, usage strings, intent filters, notification icon,
  `allowBackup`): `../Growth-Buddy-Mobile` has someone else's uncommitted work in progress, so the
  changes ship as a patch file (`docs/mobile-native-changes.patch`) to apply there.
- Prod environment variables (`TRUST_PROXY` and the hop count): code changes ship, and the Render
  setting is listed in `DEPLOYING.md`.
