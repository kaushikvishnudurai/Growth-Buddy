# Habit reminders: tone selection + real delivery

## Problem

The "New habit" dialog collects a "Daily reminder" time but nothing ever reads
it back. `Habit.reminderTime` is persisted and never scheduled, so a habit
reminder produces no notification of any kind, on any platform. The frontend
has a parallel, working feature — calendar reminders — that already does this
correctly: a per-reminder tone select, an on-device alarm queue inside the
Capacitor app, and a backend scheduler that delivers bell + web push + (for
reminders only) WhatsApp. This spec brings habit reminders to parity with
calendar reminders on every channel except WhatsApp.

## Goals

- A habit can carry its own notification tone, chosen at creation, from the
  same `CHIMES` table reminders use.
- Two new "hard" tones are added to that table (all five existing ones are
  soft/gentle).
- A habit with a reminder time actually fires a notification once a day at
  that time, on both the Capacitor app (via on-device alarm, carries the
  chosen tone) and a browser tab that's granted push (via web push, generic
  OS sound — same limitation calendar reminders already have).
- A habit already checked in for the day does not fire its reminder.

## Non-goals

- WhatsApp delivery for habit reminders (out of scope; not requested).
- Editing a habit after creation (no such UI exists today for any habit
  field; not adding one).
- Per-occurrence recurrence logic — a habit's reminder is daily-only,
  regardless of `cadence` (`daily`/`weekly`), matching the existing UI label
  ("Daily reminder").
- Making the exported `.wav` chimes literally louder — `gen-chimes.mjs`
  normalizes every sound to the same peak; "hard" means timbre/envelope, not
  volume.

## Data model changes

### `habits.sound` (new column)

`VARCHAR(16) NULL`, same shape as `calendar_reminders.sound`. Null means "use
the account's default tone from Settings" — same semantics as reminders.

- `tableCreationQueries.sql`: add to the `habits` CREATE TABLE body.
- `migrations.sql`: add `habits.sound` to the check-block and append
  `ALTER TABLE habits ADD COLUMN sound VARCHAR(16) NULL;` to the ALTERs
  section.
- `Habit.java`: new `@Column(length = 16) private String sound;`.
- `HabitDtos.java`: add `sound` to `CreateHabitRequest`, `UpdateHabitRequest`,
  `HabitResponse` (+ `HabitResponse.of` construction).
- `HabitService.create` / `update` / `toResponse`: thread the field through,
  mirroring how `CalendarReminder.sound` is handled in `ReminderService`.

### `notifications.kind` (ENUM widening)

Add `habit_reminder`. While touching this column: `reminder` itself is
**missing** from the ENUM in both `tableCreationQueries.sql` and
`migrations.sql`, even though `ReminderDeliveryScheduler` already inserts
`kind = reminder` rows — likely silently failing that one insert since it's
wrapped in a try/catch (`NotificationService.publish` failure just logs a
warning; the WhatsApp/push channels mask it). Fixing both values in the same
widening, since a fresh install today would already have this gap.

- `tableCreationQueries.sql`: `kind ENUM('mentorship_request',
  'mentorship_accepted','mentorship_rejected','system','reminder',
  'habit_reminder') NOT NULL`.
- `migrations.sql`: append `ALTER TABLE notifications MODIFY COLUMN kind
  ENUM(...) NOT NULL;` (same widening pattern already used for
  `family_members.status`).
- `NotificationKind.java`: add `habit_reminder`.

### `habit_reminder_dispatch_log` (new table)

Mirrors `reminder_dispatch_log` exactly: `id`, `habit_id`, `occurrence_date`,
`channel`, `status`, `error_message`, `created_at`, unique index on
`(habit_id, occurrence_date)`. Prevents redelivery within a day; a failed
attempt stays retryable inside the catch-up window (same rule as reminders).

- `tableCreationQueries.sql`: new `CREATE TABLE IF NOT EXISTS`, same section
  as `reminder_dispatch_log`.
- New entity `HabitReminderDispatchLog` + repository
  `HabitReminderDispatchLogRepository` (mirrors `ReminderDispatchLog` /
  `ReminderDispatchLogRepository`, including the batch `findDelivered` query).
- **Not** added via `migrations.sql` (that file only ever adds columns to
  existing tables, per its own header comment) — a brand-new table needs its
  own `CREATE TABLE IF NOT EXISTS` run once against prod. See "Manual prod
  step" below.

## Backend: `HabitReminderDeliveryScheduler`

New `@Component`, `@Scheduled(cron = "0 * * * * *")`, structured like
`ReminderDeliveryScheduler`:

1. `HabitRepository.findDeliverable(inAppOn, pushOn)` — active,
   non-deleted habits with `reminderTime IS NOT NULL`, for users reachable on
   the bell (always) or web push (if configured + subscribed). Mirrors
   `CalendarReminderRepository.findDeliverable` minus the WhatsApp branch.
2. Batch-load users, one wall-clock `Instant.now()` for the whole tick, same
   as the reminder scheduler.
3. Per candidate: resolve the user's zone, compute
   `ZonedDateTime.of(day, habit.getReminderTime(), zone)`, skip unless `tick`
   is within `[scheduledAt, scheduledAt + 5min]` (same `CATCH_UP` constant,
   same DST-safe construction as `DstWindowTest` already covers for
   reminders).
4. **Skip if `HabitCheckinRepository.existsByHabitIdAndLogDateAndDoneTrue`
   is true for that day** — a reminder to do something already done is noise,
   consistent with `TodayPlanCard`'s "never congratulates" rule.
5. Skip if already logged `sent` in `habit_reminder_dispatch_log` for
   `(habit.id, day)`.
6. Deliver: `NotificationService.publish(userId, NotificationKind
   .habit_reminder, habit.getName(), "Reminder to " + habit.getName(),
   habit.getId())` (bell, unconditional) + `PushService.sendToUser(userId,
   "Habit reminder", habit.getName(), "/#habits")` if push is configured and
   the send succeeds. Write the dispatch log row either way (status
   `sent`/`failed`), same as `ReminderDeliveryScheduler.deliver`.

No WhatsApp branch. No per-tone customization in the web push payload —
confirmed by reading `public/push-handlers.js`: `showNotification` is never
passed a `sound` option, and no modern browser supports one. Calendar
reminders don't get a custom sound on web push today either; habits reach the
same ceiling, not a lower one.

## Frontend: on-device alarm (the channel that DOES carry the tone)

`scripts/push.js`:

- New `upcomingHabitAlarms(habits, now, days = HORIZON_DAYS)`, mirroring
  `upcomingWaterAlarms`: for each habit with `reminderTime` set and
  `!habit.doneToday`, queue one alarm per day in the horizon at that time,
  carrying `habit.sound` (falls back to the account default the same way
  `n.sound || sound` already does for reminders).
- `upcomingAlarms({ reminders, water, habits, sound } = {}, now)` concatenates
  the three queues before the existing dedup/cap/sort logic.

`scripts/app.js`:

- Add `state.habits` as a fourth input to every `reSyncDeviceAlarms()` call
  site (boot, reminder add/delete, notification-permission grant, water
  change, sound change) — plus a new call after `createHabit()`, since a
  fourth input just joined the three the doc comment currently names.

## Frontend: UI

`openAddHabit()` in `app.js` — add a Tone `<select>` under "Daily reminder
(optional)", built the same way as `calendar.js`'s `soundInput`: import
`CHIMES`, `playChime` from `chime.js`; `'Default tone'` as the empty option;
preview on change (nothing previewed for "Default tone"); send
`sound: toneSel.value || null` inside the `createHabit` payload.

## `chime.js`: two new tones

All five existing sounds (`bloom`, `droplet`, `chime`, `marimba`, `hush`) are
sine/triangle with slow attacks and gains between 0.018–0.11. Two new
entries, distinguished by wave shape and envelope rather than raw gain
(`gen-chimes.mjs` normalizes every exported `.wav` to the same peak
regardless of the table's `g` values — the in-app `AudioContext` preview is
the only place gain differences are actually audible):

- `alarm` — sharp square-wave double-beep (~880 Hz, ~60 ms apart, fast
  attack/decay).
- `buzz` — a low sawtooth/square sustained buzz (~220 Hz).

Both added to `SOUNDS` and `CHIMES` (with a `hint`). Run
`node scripts/gen-chimes.mjs` after editing `SOUNDS`, per the existing rule —
it re-renders `public/gb-*.wav` and asserts none is silent or clipping.

## Testing

- `scripts/push.test.mjs` (runs locally, Node only): extend with cases for
  `upcomingHabitAlarms` — no `reminderTime` → nothing queued; already
  `doneToday` → nothing queued; carries its own `sound`; falls back to the
  account default when unset.
- `node scripts/gen-chimes.mjs` — regenerate + self-check after the `SOUNDS`
  edit.
- `node scripts/tokens.test.mjs` — only if any CSS changes are needed (none
  currently planned).
- Backend: a `HabitReminderDeliverySchedulerTest`, structured like whatever
  test already exists for `ReminderDeliveryScheduler` (fires once per due
  window, skips a checked-in habit, skips outside the catch-up window,
  doesn't double-send within a day). **Cannot run `./mvnw test` locally on
  this machine** (no Java/Maven installed) — verification happens via GitHub
  Actions CI (`ci.yml` already runs `./mvnw -q test` on every push) and via
  the live Render deploy.

## Manual step required on prod (TiDB, `ddl-auto: none`)

Three statements need to run once against the live database after this
deploys, before any of it works — otherwise the first habit created with a
tone, or the first scheduler tick, hits a column/table/enum value that
doesn't exist and 500s:

```sql
ALTER TABLE habits ADD COLUMN sound VARCHAR(16) NULL;

ALTER TABLE notifications
  MODIFY COLUMN kind ENUM('mentorship_request','mentorship_accepted',
    'mentorship_rejected','system','reminder','habit_reminder') NOT NULL;

CREATE TABLE IF NOT EXISTS habit_reminder_dispatch_log (
  id              CHAR(36)    NOT NULL,
  habit_id        CHAR(36)    NOT NULL,
  occurrence_date DATE        NOT NULL,
  channel         VARCHAR(16) NOT NULL,
  status          VARCHAR(16) NOT NULL,
  error_message   VARCHAR(255) NULL,
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_habit_dispatch_unique (habit_id, occurrence_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

The first two lines are also captured in `migrations.sql`'s check-block +
ALTERs section (the standard mechanism for columns/enum widenings on an
existing table). The third is a brand-new table, which `migrations.sql`'s own
header says it does not handle — it's given here directly and called out
again at the end of implementation.

## Risks / open questions carried into implementation

- The `reminder` enum-widening fix is adjacent to this task but shares the
  exact column and mechanism; doing both in one widening avoids a second
  prod migration step for the same table shortly after this one.
- Backend changes are unverified locally (no JDK/Maven on this machine) —
  CI on push is the first real compile/test signal.
