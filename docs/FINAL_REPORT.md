# Final report

The overhaul: audit, research, fixes, new features and verification, on `feat/overhaul` /
`ov-integration` at **a7af6ab, build 96**. It contains `main` up to build 95 (life-plan, health, roast
rounds) plus 20 overhaul branches. **Not on `main` yet**: merging and pushing it is a production deploy,
and needs the go-ahead plus the prod SQL below.

Supporting docs: [PROJECT_MAP](PROJECT_MAP.md), [AUDIT_REPORT](AUDIT_REPORT.md) and `audit/*.md`,
[RESEARCH](RESEARCH.md), [ROADMAP](ROADMAP.md).

## 1. What was found

Ten parallel audits of build 88, then four bug hunts over the merged code.

| | Critical | High | Medium | Low |
|---|---|---|---|---|
| Audits (10 areas) | 0 | 36 | 73 | 87 |
| Bug hunts on the merged code | 33 confirmed (offline/sign-out seams 12, new modules 20 reproduced in node, backend 6, moved code 1; some overlap) |||

The headline problems at the start:

- **Data loss offline**: Money edits, sleep and mood entries and settings changes could be wiped on
  the next load.
- **Security**: behind the prod proxy every user shared one rate-limit bucket (one script could lock
  everyone out of sign-in); a family invite exposed the invitee's DOB, body and diet before they
  accepted, and the meal-plan prompt still sent it to the AI after the first fix.
- **App vs web**: a boot error left the phone app on the splash forever; Circle invites from the app
  pointed at `https://localhost`; iOS crashed on the first photo (no camera usage string).
- **Updates**: a new deploy never reached an open or installed app.
- **Sign-out**: two drifted reset lists; the Settings sheet stayed open over the sign-in card with the
  old account's name in it; found later, a write in flight at sign-out was replayed into the next
  account.
- **Contrast**: several dark-mode and premium surfaces at 1.4 to 2.3:1; no visible focus ring on any
  text field.

## 2. What was fixed

Every High and Medium from the audits, and the Lows that were real, with these exceptions: the native
Android/iOS config (shipped as a patch, below) and items moved to the roadmap. Each fix branch left an
e2e script under `scripts/e2e/` that drives the real app at 390 and 1280 px.

| Area | Branches | Highlights |
|---|---|---|
| Functional | `ov-func`, `ov-func-low` | Money doc edits queued and replayed (`docDiff` / `adoptServerMoney`); sleep and mood through the outbox; ui-prefs saved by key; focus sessions survive a deleted task; temp ids handled; an unverified sign-in is told why |
| Session | `ov-session` + integration | one `endSession(reason)` for sign-out, 401 and deletion; a session counter so late answers land nowhere and are never replayed into the next account; offline cold start in the app paints the last data |
| Security | `ov-sec`, `ov-sec-low` + integration | right-most proxy hop, every X-Forwarded-For line; invitee data copied only on accept and kept out of the AI prompt; push endpoints restricted to real push services; people search throttled and LIKE-escaped; prefs capped (growth only); CSP report endpoint; route-keyed rate limits; 60-day minimal session cookie; complete data export incl. the owner's household |
| Performance | `ov-perf`, `ov-perf-low` | icons built directly (no document sweep: 140 rebuilt per tick to 0); one task-history query; Settings and habit dialogs lazy; money.css and premium.css on demand; tick round trips in parallel; batched goal actions; gzip on JSON; fewer forced layouts |
| UI / design system | `ov-uicss`, `ov-ui-low` | contrast fixed in both themes and premium; `--control-edge` and `--ring` tokens; z-index and scrim tokens; one switch, one pill segmented control; spacing, radius and type literals moved to tokens; `contrast.test.mjs` now reads 2,636 rules so the class can't come back |
| Responsive | `ov-resp`, `ov-resp-low` | sidebar scrolls on laptop heights; container queries so the tablet frame and text size drive the breakpoints; safe-area insets in landscape; 44 px targets; wide screens centred |
| Accessibility | `ov-a11y` | page language, bell count in its name, live regions, labelled fields, real heading levels, roving-tabindex tab bars and radio groups, sticky bars never cover focus |
| App parity | `ov-parity` | Back closes header panels first; notification taps route; deep links; missing plugins detected instead of failing; native config as `docs/mobile-native-changes.patch` |
| SEO / PWA | `ov-pwa` | update prompt; Open Graph image and tags; robots, sitemap, canonical; manifest id, shortcuts, screenshots, share target; prod serves privacy.html and every root file; splash backstop |

## 3. What was built (Phase 4)

Full specs, impact over effort, are in [ROADMAP](ROADMAP.md). In short, each cuts input:

| Feature | Before | After |
|---|---|---|
| Command palette (Ctrl/Cmd+K, `/`) and shortcuts (`n`, `g h/c/m/n/r/s`, `?`) | navigate to the right screen, then find it | a few letters, from anywhere; unmatched text becomes a Quick add sentence |
| Undo instead of "Are you sure?" | a dialog per delete, or no way back | the delete is instant and reversible for 6 s, everywhere |
| Money CSV import, Calendar .ics import | retype history from another app | one file: bank formats, Indian grouping, day-first dates, duplicates left out, repeats and alerts kept |
| Update prompt, link previews, home-screen shortcuts, share target | reinstall to update; bare URLs; several taps to log | one tap Reload; a branded card; long-press the icon to log water or add a task; share text into Quick add |
| One-tap Daily brief chips, reminder in one sentence, focus that starts and finishes, due chips, "Add another", habit reminder offer | 3 / 7 / 2 / 6 / 6 / 5 taps | 1 / 3 / 1 / 3 / 4 / 3 taps |
| Budgets from your own spending, currency from the device region, plan meals for just me, one-tap Buddy actions, a circle's first challenge | blank forms and dead ends | prefilled, one tap each |
| Shorter sign-up and first run | 9 taps, 5 fields | 4 taps, 4 fields |

## 4. Verification

| Check | Result |
|---|---|
| `npm run lint` | clean (now also bans the `name` / `status` / `event` browser globals that hid a bug) |
| `scripts/*.test.mjs` | 44 files, all pass (28 at the start) |
| `./mvnw test` | 759 tests, 0 failures (675 at the start) |
| Build + `bundle-budget.mjs` | pass: boot 500,663 B (95.2%), precache 1,662,476 B (95.2%) |
| e2e, `scripts/e2e/*.e2e.mjs` (20 scripts, run one at a time by `run-all.mjs`) | 20/20 on a7af6ab; two consecutive green runs on 86c0940 before the `main` merge |
| `scripts/ui-audit.mjs` | clean: 11 screens x 2 viewports, 9 dialogs, 2 header panels |

Lighthouse on the production build, signed-in Home, median of 3:

| | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| Mobile, before (build 88) | 80 | 98 | 82 | 91 |
| Mobile, after (build 96) | 100 | 100 | 100 | 100 |
| Desktop, before | 99 | 94 | 81 | 91 |
| Desktop, after | 100 | 100 | 100 | 100 |

**Read the Performance number with care.** The after runs are a warm repeat visit: 46 of 58 requests came
from the service worker, and the static sign-in text in `#root` paints first. A cold first load in the
shared test Chrome scored 85 to 100 run to run. The measured gains that don't depend on caching: boot
chunk 497,595 B to 424 kB at its lowest (500 kB after `main` brought life-plan's Home cards into boot),
render-blocking CSS 285 kB to 249 kB, a task tick from three serial round trips to two.

Screenshots, before and after, are in the session scratchpad under `audit-before/`, `shots/<branch>/`
and `e2e-run*/` (not committed: `assets/ui-audit/` is git-ignored for the same reason).

Not covered: Firefox and WebKit (only Chromium is installed for puppeteer-core here), and real devices
(see below).

## 5. Before you ship

1. **Run the prod SQL first** (TiDB SQL editor, every statement re-runnable). It comes from `main`'s
   health and QA work; the overhaul added no schema. The block is in `migrations.sql`; the four
   `ALTER ... ADD COLUMN IF NOT EXISTS`, the `health_readings` table, and the check
   (`columns_of_4 = 4`, `health_table_of_1 = 1`). Optionally the SEC-02 cleanup that blanks profile
   copies on old invite rows.
2. **Render env**: `TRUST_PROXY=true`, `TRUST_PROXY_HOPS=1`. Confirm the hop count once with
   `LOGGING_LEVEL_COM_GROWTHBUDDY_COMMON_CLIENTIP=DEBUG` from a phone on mobile data (DEPLOYING.md).
   Without it every user still shares one sign-in rate-limit bucket.
3. **Merge and push** `ov-integration` into `main` (build 96).
4. **Mobile**: apply `docs/mobile-native-changes.patch` in `../Growth-Buddy-Mobile` once its pending
   work is committed (camera and photo usage strings, the iOS crash; mic and camera permissions; deep
   links; notification icon; backup rules). `npm run sync` there. A debug APK of build 96 against the
   prod API was built at `android/app/build/outputs/apk/debug/app-debug.apk`.

## 6. Known limitations and risks

- **Real devices were not tested.** Hardware Back, notification taps, deep links, camera and mic
  prompts, the offline cold start in the Capacitor app and Android 15 edge-to-edge were exercised only
  through their web-side logic and unit tests.
- **Deep links need two files only the release owner can make**: `/.well-known/assetlinks.json` (the
  release key's SHA-256) and the AASA file (Team ID). Templates are in `docs/mobile-native-changes.md`.
- **One backend query has only run against a mock**: the owner's `family_members` export (a correlated
  subquery). One real export on MySQL or TiDB would confirm it.
- **The AI paths were verified through their fallbacks only.** The local AI gateway token is rejected
  (401), so no live model call was made in this pass.
- **Exports can't save inside the app yet**: they say so and offer the website, until
  `@capacitor/filesystem` and `@capacitor/share` are added to the mobile app.
- **CSP is still Report-Only.** Watch the `[csp]` log for a week before `CSP_ENFORCE=true`.
- **The suite shares one seeded account** and must run sequentially; two runs at once see each other's
  rows.
- **Several builders reported the shared dev backend down mid-run**; the final numbers above come from a
  backend built from the final commit.

## 7. Next version

The ranked list is [ROADMAP](ROADMAP.md): Undo in Money, saving files inside the app, applying the native
patch, languages, phone steps and sleep, and the smaller items the bug hunts deferred.
