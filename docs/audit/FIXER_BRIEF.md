# Brief for every overhaul FIX agent

Read docs/audit/BRIEF.md first (stack, ports, seeding, CDP Chrome, rules). Then:

- Work ONLY in your own worktree and branch (named in your prompt). Run your own Vite there:
  `API_PROXY_TARGET=http://localhost:8590 npx vite --port <your port> --strictPort` (background), and point tests
  at it with GB_E2E_BASE=http://localhost:<your port>. Never use or restart :5591/:8590's processes beyond calling them.
- The GUIDING RULE: low input, high outcome. Where a fix touches a flow, prefer the version that needs fewer taps,
  fields or decisions (smart default, inference from existing data, remembering the last choice).
- Root cause, shortest correct diff, match the surrounding code style and comment density. Read CLAUDE.md's
  working rules (BUILD is bumped only by the orchestrator at integration: do NOT bump it).
- Never remove or change working behaviour without a test protecting it first. The safety net lives in
  e2e/safety-*.spec.mjs and e2e/smoke.spec.mjs: run the ones touching your area before AND after your change.
- No placeholders, TODOs, mock data or dead buttons. No emoji. No new dependency without a one-line justification
  in your final reply (the orchestrator records it in DECISIONS.md).
- The Design System agent (branch ov1011/design) is changing tokens, base styles and INLINE COLOUR/FONT styles in
  JS across modules right now. Do NOT change colours, fonts, spacing tokens or inline style values; if a finding is
  purely visual, leave it and say so. This keeps your merge conflict-free.
- EVIDENCE GATE per finding: a Playwright test in e2e/<your-area>.spec.mjs (use e2e/fixtures.mjs: its guard fails
  on any console error or HTTP >= 400) that fails before your fix and passes after, plus a screenshot saved to
  docs/evidence/<your-area>/<ID>.jpg (< 300 KB). Pure-logic fixes may use a plain-assert scripts/*.test.mjs instead
  (CI runs every scripts/*.test.mjs). Run playwright with --output=/private/tmp/claude-502/-Users-kaush-zstch1550-github-Growth-Buddy/2a655a54-bc3a-47fc-b762-ad3406e52a3e/scratchpad/pw-<your-area> so runs don't clobber each other.
- Before finishing: npm run lint, every node scripts/*.test.mjs, your spec + the safety specs for your area on both
  projects (desktop + mobile), npm run build && node scripts/bundle-budget.mjs (report the numbers).
- Commit after each fix with plain git commit (repo config is right), message "fix(<area>): ...", ending with
  "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Do not push. Kill only processes you started.
- If a doc in docs/ or CODEMAP.md describes what you changed, update that line.
- Final reply: per finding ID -> fixed (sha, test) / not fixed (why); inputs before -> after for any flow you
  changed; test results; files touched.
