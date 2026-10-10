# user/AuthService.java

Owns signup, login, email verification, password reset, WhatsApp number verification, and the
user-settings writes. Backs `/api/auth` (`AuthController`). Session minting is **not** here — that's
`SessionService`.

## Public API

| Method | Notes |
|---|---|
| `signup(req)` | creates user + `PasswordCredential` (bcrypt) + emails an OTP. Existing UNVERIFIED account + same password (LoginAttemptGuard-checked) → fresh OTP, same 201 shape; anything else on an existing email → 409. Never overwrites the stored password |
| `login(req, http)` | takes `HttpServletRequest` for IP/UA on the session row. Right password on an unverified account → fresh OTP + 403 (frontend opens the code screen); `noRollbackFor = ApiException` keeps that OTP row. After the password, in this order: a scheduled deletion → **409 `deletion_scheduled`** unless `cancelDeletion` (then cleared + courtesy mail); 2FA on → **401 `totp_required`** without `code`, 400 `totp_invalid` on a wrong one (`requireSecondFactor`, guard key `totp:<email>`). Deletion is checked first because a TOTP code is single-use — the cancel re-sends it |
| `verifyEmail(req, http)` | consumes the OTP, returns a session |
| `resendVerification(req)` | verification OTPs are capped per account (`VERIFY_OTP_PER_HOUR`); over the cap resend skips silently, signup/login answer 429. On top, **`requireOtpMailBudget(email)`** caps OTP mails per *destination address* across every purpose (`OTP_MAIL_PER_HOUR` = 5, key `otpmail:<email>`; plus `OTP_MAIL_PER_DAY` = 10, key `otpday:<email>`) — called once on each `mail.sendOtp` path; resend/forgot call it *before* the lookup so an unknown address gets the same 429 (no oracle). The daily window is why RateLimiter retains 48h of counters |
| `forgotPassword(req)` | always succeeds outwardly (no account enumeration) — except the per-address 429 above, which is existence-blind |
| `resetPassword(req, http)` | `noRollbackFor`: the new password is kept, but a scheduled deletion (409) or 2FA (401 `totp_required`) still blocks the session — a reset proves the inbox, not the authenticator |
| `changePassword(userId, req, http)` | |
| `deleteAccount(userId, password)` | password-confirmed; **schedules**: stamps `users.deletion_requested_at` (a second request keeps the first date), revokes every session, mails the date. `purgeScheduledAccount(id, cutoff)` (called by `AccountDeletionJob`, hourly) re-checks the stamp and runs the private `purgeAccount` hard delete after `DELETION_GRACE_DAYS` (7). In the purge, families and Growth Circles the account owns go to their longest-standing other member, or are deleted when nobody else is in them (`handOverOrRemoveFamilies` / `handOverOrRemoveCircles`). Until the purge, `User.isPendingDeletion()` makes the account invisible: no scheduler delivers to it, no search/invite finds it, no Circle roster or board shows it (list in CODEMAP "Deleting an account") |
| `requestEmailChange` / `confirmEmailChange` | password (guarded as `login:<email>`) → code to the NEW address in `email_change_tokens` (not `email_verification_tokens`: `/verify` hands out a session); confirm (guard `emailchange:<id>`) re-checks the address is free, swaps it, keeps sessions, mails the OLD address. 5 codes/hour/account |
| `securityStatus` / `beginTotpSetup` / `enableTotp` / `disableTotp` | 2FA via `TotpService` (`Totp` = RFC 6238 math). Setup returns the secret + otpauth URI and is refused once enabled; enable (guard `totpsetup:<id>`) returns the 8 recovery codes once; disable needs password + a code |
| `updateWhatsApp(userId, req)` | |
| `sendWhatsAppOtp` / `verifyWhatsAppOtp` | ownership proof before the number is saved |
| `updateProfile(userId, req)` | |
| `updateFeatures(userId, Map<String,Boolean>)` | per-feature on/off toggles |
| `updateUiPrefs(userId, Map<String,Object>)` | merge, not replace (theme, language, onboarding, seen achievements) |
| `updateDigest(userId, req)` | cadence `off`\|`daily`\|`weekly` + send hour |
| `updateHomeLayout(userId, List<HomeLayoutItem>)` | |
| `updateNavLayout(userId, List<NavLayoutItem>)` | |
| `nutritionSuggestion(userId, form)` | read-only, LLM-assisted |

All the mutating methods are `@Transactional` and return `AuthUserResponse` (the shape the frontend
stores as its user object) — so a settings write refreshes the client in one round trip.

## Security invariants — do not weaken

- Passwords: bcrypt in `PasswordCredential`. **OTPs: only the bcrypt hash is stored**
  (`EmailVerificationToken`, `PasswordResetToken`, `WhatsAppOtpToken`, `EmailChangeToken`; 2FA
  recovery codes too). The TOTP secret is AES-GCM encrypted under a key derived from
  `SESSION_HMAC_SECRET` — rotating that env var breaks every enrolled authenticator — a DB compromise cannot
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

Courtesy mails (old-address notice, deletion receipt, 2FA on/off) go through `notifyQuietly`, which
logs instead of throwing — a failed notice must not roll back the change it reports. New dependencies
(`EmailChangeTokenRepository`, `TotpService`) are **field**-injected so the constructor the unit tests
call is unchanged; a hand-built AuthService has `totp == null`, which login reads as "no 2FA".

DTOs: `AuthDtos`. Repositories: `AuthRepositories`, `UserRepository`.
