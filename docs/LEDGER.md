# Ledger

Status: todo / in-progress / verified / blocked. **verified** = a Playwright test passes, a screenshot
exists, zero console errors and zero failed requests (the `guard` fixture in `e2e/fixtures.mjs`).
Severity: Critical / High / Medium / Low. Evidence = test path and/or `docs/evidence/<id>/`.

| ID | Task | Owner | Status | Sev | Evidence |
|---|---|---|---|---|---|
| L-000 | E2E harness: seeder, CDP-attached Playwright, error/network guard, smoke over 12 screens x 2 viewports | orchestrator | verified | High | `e2e/smoke.spec.mjs` (22/24; the 2 failures are L-001) |
| L-001 | Concurrent signups deadlock on `email_verification_tokens` insert → 500 "Something went wrong" | — | todo | High | backend log: `CannotAcquireLockException ... Deadlock found` at 4 parallel signups |
| L-002 | USER REPORT: Food on mobile: the already-had foods block most of the screen; manual entry is hard | food agent (ov1011/food) | in-progress | High | user, 2026-10-11 |
| L-003 | USER REQUEST: Health's summary sentence ("insights") moves to the end of the screen, after the ledger | money agent (ov1011/money) | in-progress | Medium | user, 2026-10-11 |
