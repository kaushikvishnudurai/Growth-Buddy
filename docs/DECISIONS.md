# Decisions

| # | Decision | Why |
|---|---|---|
| D-01 | Fresh overhaul on `overhaul/2026-10-11` from main (build 92), in worktree `../GB-overhaul-1011` | The user chose this over building on the parallel session's `ov-integration` (build 88). The shared `~/github/Growth-Buddy` tree is used by other sessions, so all work happens in this worktree. |
| D-02 | New dev dependency `@playwright/test` | The evidence gate requires Playwright tests. The repo had only `puppeteer-core` scripts and no test runner. Dev-only; nothing ships. |
| D-03 | Playwright attaches to a hand-started Chrome over CDP instead of launching one | Launching is killed by the sandbox (`kill EPERM`), the same trap the UI audit hit with puppeteer. Each test still gets its own browser context. |
| D-04 | Tests sign in by writing the two boot cookies (`gb.token`, `gb.session`); one test covers the real form | `/api/auth/login` and `/signup` are limited to 10 per IP per 5 min. A per-test account keeps tests independent; the backend runs with `trust-proxy=true` locally so the seeder's forwarded IP varies. Production config is untouched. |
| D-05 | Local backend prints mail to its log (Mailjet and SMTP keys blanked) and has WhatsApp off | Seeding sends no real email or messages. |
| D-06 | Audit agents write `docs/audit/<area>.md` with prefixed IDs; only the orchestrator writes `LEDGER.md` | Twenty agents editing one table concurrently clobber each other. The orchestrator merges, dedupes and assigns owners. |
| D-07 | 18 audit agents instead of the 8 listed (Explorer split in 4 by module, Code Reviewer in 3, plus offline/integrity, first-run and content/empty-state audits) | The user asked for more agents; the split keeps each agent's area small enough to cover completely. The machine caps concurrent agents at 20. |
