# Brief for every overhaul agent

Repo: /Users/kaush-zstch1550/github/GB-overhaul-1011 (git worktree, branch overhaul/2026-10-11, build 92).
Growth Buddy: personal life OS (habits, tasks, calendar/reminders, money, notes, goals, report, focus timer,
food/water, health, family meal planning, Growth Circle social accountability, Buddy AI chat). Vanilla JS +
Vite frontend (scripts/, styles/), Spring Boot + MySQL backend (backend/), Capacitor wrapper in
../Growth-Buddy-Mobile.

READ FIRST: CLAUDE.md (repo rules), CODEMAP.md (every module + endpoint), docs/PROJECT_MAP.md, and the
per-file doc in docs/ for any big file you open (docs/scripts/app.js.md etc). Docs name symbols, not line
numbers: grep -n the symbol, read only that range. Never read all of app.js/app.css (16k lines each).

Shared local stack (already running, do NOT restart or kill it; never kill other ports — other Claude
sessions run servers on 8080/8082/8083/8383/8484/5173/5484/4176/4484):
- Vite dev  http://localhost:5591  (use "localhost", never 127.0.0.1; it binds IPv6)
- Backend   http://localhost:8590  (scratch DB gb_ov1011; mail printed to the log)
- Backend log: /private/tmp/claude-502/-Users-kaush-zstch1550-github-Growth-Buddy/2a655a54-bc3a-47fc-b762-ad3406e52a3e/scratchpad/backend2.log
- Headless Chrome CDP: http://localhost:9591 (Playwright must use chromium.connectOverCDP; launching a
  browser is killed by the sandbox)
- Always export no_proxy='localhost,127.0.0.1,::1' NO_PROXY='localhost,127.0.0.1,::1' (a corporate proxy
  answers 503 for localhost otherwise) and pass --noproxy '*' to curl.
- Make a seeded account: GB_BACKEND_LOG=/private/tmp/claude-502/-Users-kaush-zstch1550-github-Growth-Buddy/2a655a54-bc3a-47fc-b762-ad3406e52a3e/scratchpad/backend2.log node e2e/seed.mjs  (prints {email,password,token,user});
  add --empty for a fresh account with no data. Each run makes a new account; make your own, never share.
- Sign in fast in a Playwright page: see signInFast in e2e/fixtures.mjs (sets cookies gb.token + gb.session).
  The page never scrolls; #gb-main is the scroll container.
- Playwright test run: GB_BACKEND_LOG=/private/tmp/claude-502/-Users-kaush-zstch1550-github-Growth-Buddy/2a655a54-bc3a-47fc-b762-ad3406e52a3e/scratchpad/backend2.log npx playwright test <file>
- AI gateway key is rejected locally (401): AI features show their fallbacks. That is expected, not a bug,
  unless the fallback itself is broken or confusing.

Rules: no emoji in anything you write. Professional, plain tone. Do not commit unless told. Do not edit
docs/LEDGER.md (the orchestrator merges your findings). Write ONLY the files your task names.
Finding format (one per finding, in your audit file), so the orchestrator can merge them:
### <PREFIX>-<n>: <one-line title>
- Severity: Critical | High | Medium | Low
- Where: file:symbol or screen + viewport
- Repro / evidence: exact steps, console text, request, screenshot path
- Cause: (if known, from reading the code)
- Fix: concrete suggestion, with the file(s) it touches
Verify a finding before you write it (reproduce it, or read the code path end to end). No speculation.
Put screenshots under docs/evidence/audit-<yourname>/ (png, keep each < 300 KB: jpeg quality 70 is fine).
End your final reply with: counts by severity, and the 5 most important findings in one line each.
