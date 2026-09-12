# user/AuthService.java — 805 lines

Owns signup, login, email verification, password reset, WhatsApp number verification, and the
user-settings writes. Backs `/api/auth` (`AuthController`). Session minting is **not** here — that's
`SessionService`.

## Public API

| Method | Line | Notes |
|---|---|---|
| `signup(req)` | 113 | creates user + `PasswordCredential` (bcrypt) + emails an OTP |
| `login(req, http)` | 142 | takes `HttpServletRequest` for IP/UA on the session row |
| `verifyEmail(req, http)` | 168 | consumes the OTP, returns a session |
| `resendVerification(req)` | 192 | |
| `forgotPassword(req)` | 202 | always succeeds outwardly (no account enumeration) |
| `resetPassword(req, http)` | 210 | |
| `changePassword(userId, req, http)` | 252 | |
| `deleteAccount(userId, password)` | 273 | password-confirmed destructive path |
| `updateWhatsApp(userId, req)` | 340 | |
| `sendWhatsAppOtp` / `verifyWhatsAppOtp` | 360 / 388 | ownership proof before the number is saved |
| `updateProfile(userId, req)` | 418 | |
| `updateFeatures(userId, Map<String,Boolean>)` | 454 | per-feature on/off toggles |
| `updateUiPrefs(userId, Map<String,Object>)` | 472 | merge, not replace (theme, language, onboarding, seen achievements) |
| `updateDigest(userId, req)` | 490 | cadence `off`\|`daily`\|`weekly` + send hour |
| `updateHomeLayout(userId, List<HomeLayoutItem>)` | 509 | |
| `updateNavLayout(userId, List<NavLayoutItem>)` | 527 | |
| `nutritionSuggestion(userId, form)` | 553 | read-only, LLM-assisted |

All the mutating methods are `@Transactional` and return `AuthUserResponse` (the shape the frontend
stores as its user object) — so a settings write refreshes the client in one round trip.

## Security invariants — do not weaken

- Passwords: bcrypt in `PasswordCredential`. **OTPs: only the bcrypt hash is stored**
  (`EmailVerificationToken`, `PasswordResetToken`, `WhatsAppOtpToken`) — a DB compromise cannot
  recover a live code.
- Session tokens are HMAC'd by `SessionService` (`HMAC-SHA256(token, serverSecret)`), so a DB dump
  alone can't validate a stolen token. 60-day lifetime unless revoked.
- `forgot-password` and `login` must stay indistinguishable for unknown vs known emails.
- Auth endpoints are rate-limited per IP by `RateLimitInterceptor` (via `ClientIp`), **and per
  account** by `LoginAttemptGuard` — `login`, `verifyEmail` and `resetPassword` each
  `check()` before touching the secret, `recordFailure()` on every wrong answer and
  `recordSuccess()` on the right one. Keyed on the *typed email*, not on a user row, so an
  unknown address throttles identically and the lockout isn't an enumeration oracle. Add the
  same three calls to any new endpoint that checks a guessable secret. The lock caps at an
  hour on purpose: permanent would let a stranger lock out the owner.
- Email goes through `MailService`, which **no-ops with a log line when `spring.mail.username` is
  empty** — that's why local OTP flows need the env loaded: **start the backend with `./run.sh`**.

DTOs: `AuthDtos`. Repositories: `AuthRepositories`, `UserRepository`.
