# user/AuthService.java

Owns signup, login, email verification, password reset, WhatsApp number verification, and the
user-settings writes. Backs `/api/auth` (`AuthController`). Session minting is **not** here — that's
`SessionService`.

## Public API

| Method | Notes |
|---|---|
| `signup(req)` | creates user + `PasswordCredential` (bcrypt) + emails an OTP. Existing UNVERIFIED account + same password (LoginAttemptGuard-checked) → fresh OTP, same 201 shape; anything else on an existing email → 409. Never overwrites the stored password. The user row is `saveAndFlush`ed so a same-email double tap that raced past the lookup hits `uq_users_email` there and becomes the same 409 (`emailTaken()`), not a 500 at commit |
| `login(req, http)` | takes `HttpServletRequest` for IP/UA on the session row. Right password on an unverified account → fresh OTP + 403 (frontend opens the code screen); `noRollbackFor = ApiException` keeps that OTP row. After the password, in this order: a scheduled deletion → **409 `deletion_scheduled`** unless `cancelDeletion` (then cleared + courtesy mail); 2FA on → **401 `totp_required`** without `code`, 400 `totp_invalid` on a wrong one (`requireSecondFactor`, guard key `totp:<email>`). Deletion is checked first because a TOTP code is single-use — the cancel re-sends it |
| `verifyEmail(req, http)` | consumes the OTP, returns a session |
| `resendVerification(req)` | verification OTPs are capped per account (`VERIFY_OTP_PER_HOUR`); over the cap resend skips silently, signup/login answer 429. On top, **`requireOtpMailBudget(email)`** caps OTP mails per *destination address* across every purpose (`OTP_MAIL_PER_HOUR` = 5, key `otpmail:<email>`; plus `OTP_MAIL_PER_DAY` = 10, key `otpday:<email>`) — spent once on each `mail.sendOtp` path, right before the send, via `RateLimiter.peek` + `record`: only a mail that goes out counts, so a refused or unknown-address request spends nothing and can't block or extend a block on someone's address. signup / login / email change answer 429; resend/forgot go through `takeOtpMail` and skip silently, so a capped address and an unknown one answer alike (no oracle). The daily window is why RateLimiter retains 48h of counters |
| `forgotPassword(req)` | always succeeds outwardly (no account enumeration) — except the per-address 429 above, which is existence-blind. Not `@Transactional` (SMTP outside a connection). Each request **adds** a code and voids none, so a stranger can't keep voiding the one the owner is typing; `resetPassword` deletes them all on success |
| `resetPassword(req, http)` | `noRollbackFor`: the new password is kept, but a scheduled deletion (409) or 2FA (401 `totp_required`) still blocks the session — a reset proves the inbox, not the authenticator |
| `changePassword(userId, req, http)` | current password through `passwordMatches` (guard `login:<email>`, so a stolen session can't brute-force it); per-IP rate-limited too |
| `deleteAccount(userId, password)` | password-confirmed (via `passwordMatches`, guard `login:<email>`; per-IP rate-limited); **schedules**: stamps `users.deletion_requested_at` (a second request keeps the first date), revokes every session, **deletes every `push_subscriptions` row** (a subscription outlives the session it was made in; a cancel re-subscribes from the app), mails the date. `purgeScheduledAccount(id, cutoff)` (called by `AccountDeletionJob`, hourly) re-checks the stamp and runs the private `purgeAccount` hard delete after `DELETION_GRACE_DAYS` (7). Parent-keyed children go first, from `CHILD_TABLES` ({table, fk, parent}; static so `DataExportController.RELATED_QUERIES` exports the same rows). In the purge, families and Growth Circles the account owns go to their longest-standing other member, or are deleted when nobody else is in them (`handOverOrRemoveFamilies` / `handOverOrRemoveCircles`). Until the purge, `User.isPendingDeletion()` makes the account invisible: no scheduler delivers to it, no search/invite finds it, no Circle roster or board shows it (list in CODEMAP "Deleting an account") |
| `requestEmailChange` / `confirmEmailChange` | password (guarded as `login:<email>`) → code to the NEW address in `email_change_tokens` (not `email_verification_tokens`: `/verify` hands out a session); confirm (guard `emailchange:<id>`) re-checks the address is free, swaps it, keeps sessions, drops open password-reset codes (they went to the old inbox), mails the OLD address. 5 codes/hour/account |
| `securityStatus` / `beginTotpSetup` / `enableTotp` / `disableTotp` | 2FA via `TotpService` (`Totp` = RFC 6238 math). Setup returns the secret + otpauth URI and is refused once enabled; enable needs the **password** + the first code (guard `totpsetup:<id>`; a bearer token alone must not enroll an attacker's authenticator), signs out every other session (`SessionService.revokeOthers`, keeps the caller's) and returns the 8 recovery codes once; disable needs password + a code |
| `updateWhatsApp(userId, req)` | |
| `sendWhatsAppOtp` / `verifyWhatsAppOtp` | ownership proof before the number is saved; verify goes through `LoginAttemptGuard` (key `waverify:<userId>`) |
| `updateProfile(userId, req)` | `displayName` through `VisibleText.require` (bidi controls stripped; invisible-only is 400, HOS-9) |
| `updateFeatures(userId, Map<String,Boolean>)` | per-feature on/off toggles; merged map capped at `MAX_FEATURE_KEYS` (50) keys and `MAX_PREFS_BYTES` (64 KB), else 400 (`requireBounded(before, merged, ...)`: refuses only a merge that grows past a cap, so an account already over one can still save a same-size or smaller blob); what `/me` reports goes through `FeatureLocks.effective`, so an operator lock (CODEMAP `/api/admin`) still reads `false` whatever is stored here |
| `updateUiPrefs(userId, Map<String,Object>)` | merge, not replace (theme, language, onboarding, seen achievements); a null value deletes a key; the same `requireBounded` with `MAX_UI_PREF_KEYS` (200) and `MAX_PREFS_BYTES`. Written by native `UserRepository.updateUiPrefs`, which skips the `DeliveryCache` listener; it bumps the cache itself only when a `SCHEDULER_PREF_KEYS` key (`reminderLead`, `workWeek`, `buddyReflection`) changed, and only for that user (`DeliveryCache.changed(userId)`) |
| `updateDigest(userId, req)` | cadence `off`\|`daily`\|`weekly` + send hour |
| `updateHomeLayout(userId, List<HomeLayoutItem>)` | |
| `updateNavLayout(userId, List<NavLayoutItem>)` | |
| `nutritionSuggestion(userId, form)` | LLM-assisted; not `@Transactional`: the AI budget's INSERT fails on a read-only connection, and the AI call holds no connection (`AiCallsNotReadOnlyTest`) |

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
  account** by `LoginAttemptGuard` — `login`, `verifyEmail`, `resetPassword` and `verifyWhatsAppOtp` each
  `check()` before touching the secret, `recordFailure()` on every wrong answer and
  `recordSuccess()` on the right one. Keyed on the *typed email*, not on a user row, so an
  unknown address throttles identically and the lockout isn't an enumeration oracle. Add the
  same three calls to any new endpoint that checks a guessable secret. The lock caps at an
  hour on purpose: permanent would let a stranger lock out the owner.
- Email goes through `MailService`, which **no-ops with a log line when `spring.mail.username` is
  empty** — that's why local OTP flows need the env loaded: **start the backend with `./run.sh`**.

Courtesy mails (old-address notice, deletion receipt, 2FA on/off) go through `notifyQuietly`, which
logs instead of throwing — a failed notice must not roll back the change it reports — and sends after commit when a transaction is open.
**Code mails go after commit too** (`afterCommit`: verification, email change, the WhatsApp OTP), but
a failed send still reaches the client as an error; the token row is saved, so "resend" works. Sent
inside the transaction, SMTP held the token row's locks and a pooled connection for up to the mail
timeout, and a commit that then failed left a code for an account that never existed.
**Token clears (`deleteAllForUser` on all four token repos) are a plain read then a delete by primary
key**, never `delete ... where user_id = ?`: on MySQL REPEATABLE READ that range delete gap-locks
`ix_*_user` even when nothing matches (every new signup), and two signups whose UUIDs share a gap
deadlock on each other's following INSERT (`SignupRaceTest`, `AuthFlowIT`). New dependencies
(`EmailChangeTokenRepository`, `TotpService`) are **field**-injected so the constructor the unit tests
call is unchanged; a hand-built AuthService has `totp == null`, which login reads as "no 2FA".

DTOs: `AuthDtos`. Repositories: `AuthRepositories`, `UserRepository`.
