# Ledger

Status: todo / in-progress / verified / blocked. **verified** = a Playwright test passes, a screenshot
exists, zero console errors and zero failed requests (the `guard` fixture in `e2e/fixtures.mjs`).
Severity: Critical / High / Medium / Low. Evidence = test path and/or `docs/evidence/<id>/`.

| ID | Task | Owner | Status | Sev | Evidence |
|---|---|---|---|---|---|
| L-000 | E2E harness: seeder, CDP-attached Playwright, error/network guard, smoke over 12 screens x 2 viewports | orchestrator | verified | High | `e2e/smoke.spec.mjs` (22/24; the 2 failures are L-001) |
| L-001 | Concurrent signups deadlock on `email_verification_tokens` insert → 500 "Something went wrong" | backend (ov1011/backend) | verified | High | `SignupRaceTest`, runtime 40/40 parallel signups 201 |
| L-002 | USER REPORT: Food on mobile: the already-had foods block most of the screen; manual entry is hard | food (ov1011/food) | verified | High | `e2e/food-fixes.spec.mjs`, docs/evidence/food/ |
| L-003 | USER REQUEST: Health's summary sentence ("insights") moves to the end of the screen, after the ledger | money (ov1011/money) | verified | Medium | `e2e/money-fixes.spec.mjs`, docs/evidence/money/health-insights-last*.jpg |
| L-004 | Backend round 1: CRB-1..12, SEC-1/3/6/8, CRS-3 server | backend | verified | High | 768 JUnit tests green |
| L-005 | Backend round 2: FRC-1, EXM-1/7 server, FRC-3 server, OFF-5 tombstones, EXS-5, EXS-9 | backend | verified | High | JUnit; runtime checks in agent report |
| L-006 | App exports silently fail; offline cold start shows error cards; mic permission; right cutout (RSP-1/2/5/8) | native (ov1011/native, GBM ov1011/mobile) | verified (web) / needs device | High | `e2e/native-parity.spec.mjs` |
| L-007 | W3 Take a break (I-08) | break (ov1011/break) | verified | Feature | `e2e/break.spec.mjs`, docs/evidence/break/ |
| L-008 | Cross-browser projects (Firefox, WebKit, tablet) | xbrowser | verified | Infra | smoke 72/72 on six projects |
| L-009 | Money PUT 409 after a new user's first save: the account-seed flag landed on the next GET and changed the version (server) | qa3 | verified | Low | `MoneyVersionTest.aFirstDocumentWithoutTheSeedFlagKeepsItsVersionOnTheNextRead`, safety-money:124 32/32 |
| L-010 | Bundle budget over on main build 95 (boot +35 KB, precache +83 KB) | perf (ov1011/perf, perf2, perf3) | verified | Medium | `node scripts/bundle-budget.mjs` |
| L-011 | Release 2 fix branches: shell, money, food, capture, onboarding, social, planning, design, perf | 9 fix agents | verified | High | 331/334 then 88/88 on the integrated build; per-branch specs in e2e/ |
| L-012 | W5 command palette (I-03) | palette | verified | Feature | `e2e/palette.spec.mjs` |
| L-013 | Integration collisions (Plan my day unreachable, one-read Quick add not shown, offline prefs overwrite, reload cancelled by sheet history, first Money save 409, palette reopen, closing dialog still interactive, Notes cached by the SW) | qa1-qa5 | verified | Medium | qa specs + full runs |
| L-014 | New-user findings NEW-1..15 (day-one budget, Family path, defaults) | nu1, nu2 | verified (NEW-14 left by decision) | High | `e2e/money-day-one.spec.mjs`, `e2e/first-run-paths.spec.mjs` |
| L-015 | Hostile findings HOS-1..10 | hb, hf | verified | High | `e2e/hostile-fixes.spec.mjs`, JUnit |
| L-016 | Home mobile Lighthouse Performance 81-83 (target 90) | perf | blocked (needs boot split of calendar/settings) | Medium | docs/evidence/perf/SCORES.md |
| L-017 | Device-only checks: share sheet, mic/camera prompts, APK offline start | owner | blocked (needs a phone + npm run sync) | Medium | — |
