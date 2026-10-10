# Contributing

Project conventions, run commands and checks live in [CLAUDE.md](CLAUDE.md) (the "Working here"
section) and [CODEMAP.md](CODEMAP.md). This file covers the one-time setup a fresh clone needs.

## Install the pre-commit hook (once per clone)

`.githooks/pre-commit` refuses to commit `.env` files and staged changes that look like a
hardcoded secret (OpenAI `sk-…`, Twilio `AC…`, AWS `AKIA…`, PEM private keys). Git does not run
hooks from inside the repo by default, so each clone opts in:

```sh
git config core.hooksPath .githooks
# macOS/Linux, if the hook is not executable after checkout:
chmod +x .githooks/pre-commit
```

Check it is active: `git config --get core.hooksPath` prints `.githooks`.

The hook is a local convenience, not the guarantee — CI runs gitleaks over the full history
(`secrets` job in `.github/workflows/ci.yml`) whether or not the hook is installed. A false
positive can be bypassed with `git commit --no-verify`; a real key that was committed must be
**rotated** in the provider's dashboard, since removing it from the tree leaves it in history.

## Before you push

- `npm run lint`, and the `node scripts/*.test.mjs` checks listed in CLAUDE.md.
- `./mvnw test` in `backend/` for any backend change.
- Bump `BUILD` in `vite.config.js` by one (CI's `build-number` job fails a PR that doesn't).
