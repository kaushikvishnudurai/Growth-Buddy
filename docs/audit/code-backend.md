# Backend code review (CRB)

Scope: `backend/src/main/java/com/growthbuddy/`, against the running backend on :8591 (scratch DB
`gb_ov1011`) with two seeded accounts (A = `5504d626-...`, B = `63803544-...`).

`./mvnw -q test`: **699 tests, 0 failures, 0 errors, 0 skipped** (exit 0). Nothing to report there.

Areas that were checked and held up (no finding): cross-account access was tried with A's token
against B's tasks, habits, goals (and goal actions), notes (and the edit draft), reminders (PATCH,
done, snooze), food entries and favourites, mentor threads, health readings, family
chores/pantry/shopping/members, private-circle members/posts/kudos/comments/cheer/challenges/
delete/transfer, sessions, and mentorship status. Every one answered 404 or 403. Concurrency caps
held under 10 parallel requests: mentorship nudges (exactly 3 got through), freeze tokens (1 of 4
protects succeeded), and XP across 20 parallel task toggles (no XP was lost). Concurrent sleep and
mood writes to one daily log lost nothing. Most fuzzed inputs (wrong types, bad dates, 5,000-char
strings, negative or huge numbers, `null` bodies) answered 400.

---

### CRB-1: Concurrent signup deadlocks on email_verification_tokens (known): root cause and fix
- Severity: High
- Where: `user/AuthService.java:issueVerificationOtp` (called from `signup`), `user/AuthRepositories.java:EmailVerificationTokenRepository.deleteAllForUser`
- Repro / evidence: 4 parallel `POST /api/auth/signup` with distinct emails and distinct `X-Forwarded-For`. It is intermittent: this run got 4 x 201, but the backend log has the earlier failures (`CannotAcquireLockException ... Deadlock found ... insert into email_verification_tokens`, log lines 198-344). `SHOW ENGINE INNODB STATUS` → LATEST DETECTED DEADLOCK shows the whole mechanism. Both transactions **hold** `index ix_evt_user ... lock_mode X locks gap before rec` on the same record, and both **wait** for `lock_mode X locks gap before rec insert intention` on that same record. InnoDB rolls back transaction (2).
- Cause: `issueVerificationOtp` always runs `delete from EmailVerificationToken t where t.userId = :userId` first. For a brand-new user no rows match. Under MySQL's default REPEATABLE READ, a locking DELETE that matches nothing on a secondary index still takes an X **gap** lock on the gap where that user_id would go. Random UUIDs from concurrent signups often land in the same gap. Gap locks don't conflict with each other, so both transactions get one. Each then INSERTs, which needs an insert-intention lock in that gap, and each is blocked by the other's gap lock: a deadlock. Nothing maps `CannotAcquireLockException`, so it reaches `GlobalExceptionHandler.handleOther` as a 500. Two things make it worse. The OTP mail goes out synchronously *inside* the same transaction (`mail.sendOtp` from `issueVerificationOtp`; `MailService.send` has an 8 s connect timeout), so the locks and the pooled connection are held for the whole SMTP/HTTP call. And a commit that fails after the mail went out leaves someone with a code for an account that does not exist. TiDB (prod) takes no gap locks, so prod is less exposed. Any MySQL deployment, plus local and CI runs, has the bug. The same delete-then-insert pattern exists in `issueVerificationOtp` on login/resend, `sendWhatsAppOtp` (`waOtpTokens.deleteAllForUser`), and `requestEmailChange` (`emailChangeTokens.deleteAllForUser`).
- Fix (smallest root fix, `AuthRepositories.java` + `AuthService.java`): delete by primary key from a non-locking read instead of by secondary-index range. Add `List<EmailVerificationToken> findByUserId(UUID)` and replace `verifyTokens.deleteAllForUser(id)` with `verifyTokens.deleteAllInBatch(verifyTokens.findByUserId(id))`. A plain SELECT takes no locks, and a PK-equality delete of existing rows takes record locks only, with no gap lock. A new user deletes nothing, so it locks nothing. Do the same for the WhatsApp OTP and email-change token repos. Separately, send the OTP mail after commit, using the same `TransactionSynchronization.afterCommit` that `notifyQuietly` already uses, so SMTP never runs while the transaction holds locks. Alternative (one line, broader): `spring.datasource.hikari.transaction-isolation: TRANSACTION_READ_COMMITTED` turns off gap locks app-wide. Re-run `CustomSoundLimitsTest` and the custom-sound concurrency check if you take that route, though the cap there is already serialized by `lockOwner`.

### CRB-2: Double-submitted signup with the same email answers 500, not 409
- Severity: Medium
- Where: `user/AuthService.java:signup`, `common/GlobalExceptionHandler.java`
- Repro / evidence: 3 parallel `POST /api/auth/signup` with the **same** email (`crb.same.1791740476@example.com`) gave `201`, `500`, `500`. Log: `DataIntegrityViolationException ... Duplicate entry 'crb.same.1791740476@example.com' for key 'users.uq_users_email'`. A double tap on the mobile sign-up button is exactly this.
- Cause: check-then-insert. `findByEmailIgnoreCase` misses in both transactions, both insert, and the unique key rejects the loser. No handler maps `DataIntegrityViolationException`.
- Fix: in `signup`, catch `DataIntegrityViolationException` around `users.saveAndFlush(user)` and throw the existing 409 ("An account with this email already exists..."). As a backstop for other unique races, map `DataIntegrityViolationException` to 409 and `CannotAcquireLockException`/`PessimisticLockingFailureException` to 503 "try again" in `GlobalExceptionHandler`, so they don't land in the generic 500.

### CRB-3: GET /api/reminders/occurrences has no range cap: one request returned 725 MB
- Severity: High
- Where: `reminder/ReminderController.java:occurrences`, `reminder/ReminderService.java:occurrences`
- Repro / evidence: as A (4 reminders, one `daily`): `GET /api/reminders/occurrences?from=2026-01-01&to=9999-12-31` returned 200 with a **725,128,073-byte** body in 4.5 s. The server builds the whole `List<OccurrenceResponse>` (about 2.9M days times reminders) in heap before serializing it. A handful of these requests in parallel from any signed-in account will exhaust the heap on a small Render instance.
- Cause: the loop `for (day = from; !day.isAfter(to); ...)` over every reminder, with only a `to >= from` check. The frontend never calls this endpoint (no `reminders/occurrences` in `scripts/`), so nothing depends on a long range.
- Fix: in `ReminderService.occurrences`, refuse a span over ~400 days (`ChronoUnit.DAYS.between(from, to) > 400` → 400 Bad Request), matching the 1..400 clamp the other history endpoints use. Or delete the endpoint, since it has no caller.

### CRB-4: Controllers without @Valid skip their DTO bounds: an over-long habit note is a 500, and a 5,000-char note is stored past its 2,000 cap
- Severity: Medium
- Where: `habit/HabitController.java:checkin`, `protect`, `unprotect`; `push/PushController.java:subscribe`, `unsubscribe`; `notification/CustomSoundController.java:rename`; `health/HealthController.java:update`, `sync`; `family/FamilyController.java:updateProfile` and the `required = false` planner bodies; `money/MoneyController.java:advise`, `scanReceipt`; `user/AuthController.java:updateFeatures`, `updateUiPrefs`
- Repro / evidence:
  - `POST /api/habits/{id}/checkin {"note":"<5000 chars>"}` → 200. DB: `length(note) = 5000`, although `CheckinRequest.note` is `@Size(max = 2000)`.
  - The same with a 200,000-char note → **500** (`Data truncation: Data too long for column 'note'`, a TEXT column).
  - `POST /api/push/subscribe {"endpoint":"x"}` (no `p256dh`/`auth`) → **500** (`Column 'auth' cannot be null`), although `SubscribeRequest` declares `@NotBlank` on all three.
  - `CheckinRequest.value` / `durationMin` (`@PositiveOrZero @Max`) are unenforced the same way.
- Cause: CODEMAP says "Every `@RequestBody` takes `@Valid`", but 31 `@RequestBody` parameters lack it. Some of those are maps or raw bodies, which is fine. The ones listed above carry annotated records whose constraints never run.
- Fix: add `@Valid` to each listed parameter, which works with `required = false` too, and add `@Size` to `PushController.SubscribeRequest.endpoint` (e.g. 2048) and `CustomSoundController.RenameRequest.name`. A small guard test would keep this from coming back: reflect over every `@RequestBody` parameter whose type is a record with constraint annotations and assert `@Valid` is present, like the style of `MentorServiceTest`'s WebConfig check.

### CRB-5: Overdue-task priority escalation in GET /api/tasks is never saved (read-only transaction)
- Severity: Medium
- Where: `task/TaskService.java:list` (`@Transactional(readOnly = true)` then `repo.saveAll(tasks)`)
- Repro / evidence: a task with `dueAt` in the past was set to `priority='Low'` in the DB. `GET /api/tasks` answered `"priority":"High"`, but the row still read `Low` afterwards. Hibernate runs a read-only transaction with flush mode MANUAL (and the driver sends `SET SESSION TRANSACTION READ ONLY`, visible in performance_schema), so the `saveAll` does nothing.
- Cause: the escalation is applied to the in-memory entities only. Anything that reads the row gets the stale priority: the toggle path (`task_completion_history.priority`, which Insights' `finished?days=` reads), `ScoreService`, the mentor context, and the WhatsApp quick add.
- Fix: drop `readOnly = true` from `TaskService.list`. Better, escalate with one bulk statement (`update Task t set t.priority = High where t.userId = :u and t.done = false and t.paused = false and t.dueAt < :now and t.priority <> High`) before the read, so the GET doesn't rewrite every row.

### CRB-6: GET /api/tasks is N+1: one task_completion_history query per task
- Severity: Medium
- Where: `task/TaskService.java:responseFor` (called per task from `list`)
- Repro / evidence: with the performance_schema digest table truncated, one `GET /api/tasks` for an account with 31 tasks ran `SELECT ... FROM task_completion_history WHERE user_id = ? AND task_id = ?` **31 times**, out of 37 statements total. Each call also loads every history row of the task, only to read `size()` and the first `changedAt`.
- Fix: one grouped query per list: `select h.taskId, count(h), max(h.changedAt) from TaskHistory h where h.userId = :u group by h.taskId` into a `Map<UUID, ...>`, passed to `TaskResponse.from`. This is the same shape as Goals' "one batched action count".

### CRB-7: Reminder skips are an EAGER element collection: N+1 on every reminder list and every scheduler snapshot refresh
- Severity: Medium
- Where: `reminder/CalendarReminder.java:skipDays` (`@ElementCollection(fetch = EAGER)`), read through `CalendarReminderRepository.findDeliverable` (in `ReminderDeliveryScheduler.dispatchTimedWhatsAppReminders`), `findByUserId` (`ReminderService.list`/`occurrences`), and `findAllById`
- Repro / evidence: a `GET /api/reminders` for an account with 3 reminders ran `SELECT reminder_id, skip_date FROM calendar_reminder_skips WHERE reminder_id = ?` 3 times. The scheduler's snapshot query loads **every** timed reminder of every reachable user (201 rows in this scratch DB), so each refresh costs 1 + N queries. A refresh happens every 15 min (`DeliveryCache.MAX_AGE`) and on the next tick after *any* user edits *any* reminder.
- Cause: Hibernate satisfies an EAGER collection loaded through a JPQL query with one secondary select per owner, unless the query fetch-joins it or batch fetching is on.
- Fix: one line in `application.yml`: `spring.jpa.properties.hibernate.default_batch_fetch_size: 100`. That turns every such collection, this one and any other, into `IN (...)` batches. Or annotate `skipDays` with `@BatchSize(size = 200)`.

### CRB-8: DigestScheduler saves a stale User snapshot after each blocking send (lost update), and has no cross-instance claim
- Severity: Medium
- Where: `digest/DigestScheduler.java:dispatchDigests`
- Repro / evidence (code path read end to end): `candidates` are loaded once at the start of the run. For each user, `digest.sendDigest(...)` makes a blocking SMTP/HTTP call, and then `users.save(user)` writes the entity loaded at the start of the run. `User` has neither `@DynamicUpdate` nor `@Version`, so that `save` (a merge of a detached entity) rewrites **every** column from the old snapshot. Anything the user changed after the run started gets reverted: XP from a check-in (`ProgressService.addXp` writes `xp_total`/`level` on the same row), `ui_prefs`, timezone, profile fields, WhatsApp settings. The digest runs in the morning, when people are checking in. Second, there is no claim. Two instances (or an overlapping run) both read `lastDigestOn != today` and both send. Every other scheduler here claims its row first (`ReminderDispatchLog`, `claimFailed`, the bank-feed conditional UPDATE).
- Fix: replace `user.setLastDigestOn(today); users.save(user);` with a targeted conditional update that also works as the claim. Add `@Modifying @Query("update User u set u.lastDigestOn = :d where u.id = :id and (u.lastDigestOn is null or u.lastDigestOn <> :d)") int claimDigest(...)` to `UserRepository`, call it **before** `sendDigest`, send only when it returns 1, and on a send failure reset it to the previous value. That is one query, it fixes both problems, and it keeps the failed-send retry the comment asks for.

### CRB-9: With trust-proxy on, ClientIp trusts the client-supplied leftmost X-Forwarded-For; the documented TRUST_PROXY env var binds to nothing
- Severity: Medium
- Where: `common/ClientIp.java:resolve`; `.env.example` (`TRUST_PROXY=false`); all `@Value("${growthbuddy.trust-proxy:false}")` sites (`RateLimitInterceptor`, `AiRateLimitInterceptor`, `SessionService`, `SecurityHeadersFilter`)
- Repro / evidence: locally (trust-proxy on) every signup in the CRB-1 repro was rate-limited on whatever `X-Forwarded-For: 10.9.N.x` the client sent. That is how the brief's own repro sidesteps the per-IP limit, and an attacker can do the same. `ClientIp` returns `xf.substring(0, comma)`, the **first** entry, which the client controls. A proxy such as Render's *appends* the real peer on the right. Separately, nothing maps `TRUST_PROXY` to `growthbuddy.trust-proxy` (no `${TRUST_PROXY}` in any yml; only `GROWTHBUDDY_TRUST_PROXY` would bind). So whoever follows `.env.example` gets `false` behind Render, every client shares the proxy's address for per-IP limits (one abuser 429s sign-in for everyone), HSTS is never sent, and the sessions list shows the proxy IP.
- Fix: in `ClientIp.resolve`, take the **last** entry of `X-Forwarded-For` (the one the trusted proxy added), or the right-most entry not in a configured proxy CIDR list if there can be more than one hop. In `application.yml`, add `growthbuddy.trust-proxy: ${TRUST_PROXY:false}` so the documented variable works. Check Render's env for which name is set today.

### CRB-10: ReflectionScheduler's once-a-day guard is per-instance plus a non-atomic check
- Severity: Low
- Where: `mentor/ReflectionScheduler.java` (`sentOn` ConcurrentHashMap + the "one since local midnight" notifications check)
- Repro / evidence (code read): two instances in the same 5-minute window both miss the map entry, both find no `buddy_checkin` row since local midnight, and both publish a bell card plus a push. This only matters with more than one instance or an overlap during a deploy.
- Fix: claim with a conditional write before publishing, as in CRB-8. For example a `reminder_dispatch_log` row keyed `(nameUUIDFromBytes("reflection:"+userId), localDay)`, which the unique index `ux_rem_dispatch_unique` already makes single-winner, the same trick `SubscriptionDueScheduler` uses.

### CRB-11: Money GET windows the ledger on the server's LocalDate.now()
- Severity: Low
- Where: `money/MoneyService.java` (the GET path: `ledger.load(userId, LocalDate.now())`)
- Repro / evidence: repo trap 3 ("Never call `LocalDate.now()` for anything a user sees dated"). The 400-day window edge moves on the server's day, not the user's. The effect is at most one day at the far end of a 400-day window, so it is minor, but it is the one user-facing `LocalDate.now()` left in a service.
- Fix: `ledger.load(userId, clock.today(userId))` (`UserClock` is already used across the money package).

### CRB-12: Schema/entity drift: users.weight_kg is DECIMAL(5,1) in SQL but Integer in Java; CODEMAP says prod "pins ddl-auto: validate" but it is none
- Severity: Low
- Where: `user/User.java:weightKg` (Integer) vs `tableCreationQueries.sql` users `weight_kg DECIMAL(5,1)` and `migrations.sql:116`; `family_members.weight_kg` is INT in both. `CODEMAP.md` Config table, row `application-prod.yml`.
- Repro / evidence: I built a scratch DB from `tableCreationQueries.sql` and diffed `information_schema.columns` against the ddl-auto-built `gb_ov1011`. No table or column is missing on either side. The only type mismatches are enum ordering (harmless), `food_*.*_g` SMALLINT vs INT (harmless at those ranges), `task_completion_history.priority` ENUM vs VARCHAR (harmless), and `users.weight_kg` DECIMAL vs Integer. A 72.5 kg weight can never be stored through the API, and the two weight columns disagree. `application-prod.yml:39` is `ddl-auto: ${SPRING_JPA_DDL_AUTO:none}`, so CODEMAP's "Pins `ddl-auto: validate`" is wrong. If anyone did switch to validate, the DECIMAL/Integer mismatch would fail startup.
- Fix: make the entity `BigDecimal`/`Double` with `@Digits(integer=3, fraction=1)` on the DTO, or change the users column to INT (an `ALTER` in `migrations.sql`, and also in the CREATE TABLE). Correct the CODEMAP row to say `none`.

---

Counts: Critical 0, High 2, Medium 7, Low 3 (12 findings).

Top 5:
1. CRB-1: signup deadlock is InnoDB gap locks from `DELETE ... WHERE user_id=?` matching nothing; delete by PK from a plain read, and send the mail after commit.
2. CRB-3: `/api/reminders/occurrences` has no span cap; one request returned 725 MB. Cap at 400 days or delete the uncalled endpoint.
3. CRB-8: DigestScheduler's `users.save` of a stale snapshot reverts XP and settings, and has no claim (double send). Use a conditional UPDATE as the claim.
4. CRB-4: about a dozen controllers lack `@Valid`, so DTO bounds never run (habit note 500 / over-cap stored, push subscribe 500).
5. CRB-9: `ClientIp` trusts the client-controlled leftmost XFF, and `TRUST_PROXY` from `.env.example` binds to nothing.
