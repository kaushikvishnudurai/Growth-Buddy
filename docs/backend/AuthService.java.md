# user/AuthService.java — 754 lines

Owns signup, login, email verification, password reset, WhatsApp number verification, and the
user-settings writes. Backs `/api/auth` (`AuthController`). Session minting is **not** here — that's
`SessionService`.

## Public API

| Method | Line | Notes |
|---|---|---|
| `signup(req)` | 126 | creates user + `PasswordCredential` (bcrypt) + emails an OTP |
| `login(req, http)` | 157 | takes `HttpServletRequest` for IP/UA on the session row |
| `verifyEmail(req, http)` | 178 | consumes the OTP, returns a session |
| `resendVerification(req)` | 198 | |
| `forgotPassword(req)` | 208 | always succeeds outwardly (no account enumeration) |
| `resetPassword(req, http)` | 216 | |
| `changePassword(userId, req, http)` | 256 | |
| `deleteAccount(userId, password)` | 277 | password-confirmed destructive path |
| `updateWhatsApp(userId, req)` | 347 | |
| `sendWhatsAppOtp` / `verifyWhatsAppOtp` | 367 / 397 | ownership proof before the number is saved |
| `updateProfile(userId, req)` | 427 | |
| `updateFeatures(userId, Map<String,Boolean>)` | 463 | per-feature on/off toggles |
| `updateUiPrefs(userId, Map<String,Object>)` | 481 | merge, not replace (theme, language, onboarding, seen achievements) |
| `updateDigest(userId, req)` | 499 | cadence `off`\|`daily`\|`weekly` + send hour |
| `updateHomeLayout(userId, List<HomeLayoutItem>)` | 518 | |
| `updateNavLayout(userId, List<NavLayoutItem>)` | 536 | |
| `nutritionSuggestion(userId, form)` | 562 | read-only, LLM-assisted |

All the mutating methods are `@Transactional` and return `AuthUserResponse` (the shape the frontend
stores as its user object) — so a settings write refreshes the client in one round trip.

## Security invariants — do not weaken

- Passwords: bcrypt in `PasswordCredential`. **OTPs: only the bcrypt hash is stored**
  (`EmailVerificationToken`, `PasswordResetToken`, `WhatsAppOtpToken`) — a DB compromise cannot
  recover a live code.
- Session tokens are HMAC'd by `SessionService` (`HMAC-SHA256(token, serverSecret)`), so a DB dump
  alone can't validate a stolen token. 60-day lifetime unless revoked.
- `forgot-password` and `login` must stay indistinguishable for unknown vs known emails.
- Auth endpoints are rate-limited per IP by `RateLimitInterceptor` (via `ClientIp`).
- Email goes through `MailService`, which **no-ops with a log line when `spring.mail.username` is
  empty** — that's why local OTP flows need the env loaded: **start the backend with `./run.sh`**.

DTOs: `AuthDtos`. Repositories: `AuthRepositories`, `UserRepository`.
