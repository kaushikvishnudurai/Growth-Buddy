# Habit Reminders (tone + real delivery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A habit's "Daily reminder" time actually fires a notification once a day, on the Capacitor app (with the user's chosen tone) and in a browser tab with push granted (generic sound) — bringing habits to parity with calendar reminders on every channel except WhatsApp.

**Architecture:** Backend gains a `habits.sound` column, a `habit_reminder_dispatch_log` table, and a new `HabitReminderDeliveryScheduler` (mirrors the existing `ReminderDeliveryScheduler`, minus WhatsApp, plus a "skip if already checked in today" rule). Frontend gains a Tone `<select>` on habit creation and a new `upcomingHabitAlarms` queue inside `push.js`'s existing on-device alarm system (the same one that already handles the water nudge). Two new harsher chime tones (`alarm`, `buzz`) join the existing five soft ones.

**Tech Stack:** Spring Boot 3.5 / Java 17 / JPA (backend), vanilla JS + Vite (frontend), MySQL/TiDB.

**Spec:** [docs/superpowers/specs/2026-09-20-habit-reminders-design.md](../specs/2026-09-20-habit-reminders-design.md)

## Global Constraints

- Prod is TiDB with `ddl-auto: none` — every schema change needs a matching entry in `tableCreationQueries.sql` (fresh installs) and, for anything on an *existing* table, `migrations.sql` (manual ALTER against the live DB). A brand-new table's `CREATE TABLE IF NOT EXISTS` is handed to the user directly (see Task 10) since `migrations.sql` only ever adds columns.
- No bare `ALTER TABLE … ADD COLUMN` may appear in `tableCreationQueries.sql` — `SchemaCoverageTest.theSchemaFileAltersNothing` fails the build on it.
- Every `@Entity`'s `@Table(name = …)` must have a matching `CREATE TABLE` in `tableCreationQueries.sql` — `SchemaCoverageTest.everyEntityTableIsInTheSchemaFile` fails the build otherwise.
- Every `ALTER TABLE … ADD COLUMN` in `migrations.sql` must (a) name a column `tableCreationQueries.sql` actually declares and (b) be listed in the check-block at the top of `migrations.sql` — `SchemaCoverageTest.everyMigrationMatchesAColumnTheSchemaDeclares` / `theMigrationCheckListsEveryColumnTheFileAdds`.
- **This machine has no Java/Maven installed.** Backend steps cannot be compiled or tested locally — verification for those tasks is "re-read the diff carefully against the patterns below," not `./mvnw test`. GitHub Actions CI runs `./mvnw -q test` on every push and is the first real signal.
- Frontend steps (`scripts/push.test.mjs`, `node scripts/gen-chimes.mjs`) run fine on this machine with `node` — actually execute those, don't just describe them.
- A habit's reminder is daily-only regardless of its `cadence` field, matching the existing "Daily reminder" label — no per-day-of-week logic.
- No WhatsApp delivery for habit reminders (out of scope).
- No sound customization in the web-push payload — browsers don't support it, and calendar reminders don't do it either; habits stay at that same ceiling.

---

## Task 1: `habits.sound` column + `notifications.kind` enum widening (schema files)

**Files:**
- Modify: `tableCreationQueries.sql` (habits CREATE TABLE, ~line 147; notifications CREATE TABLE, ~line 449)
- Modify: `migrations.sql` (check-block ~line 22; ALTERs section ~line 84)

**Interfaces:**
- Produces: a `sound VARCHAR(16) NULL` column on `habits`, and `habit_reminder` (plus the previously-missing `reminder`) as valid `notifications.kind` values. Task 2 and Task 6 depend on both existing.

- [ ] **Step 1: Add `sound` to the `habits` CREATE TABLE**

In `tableCreationQueries.sql`, inside the `habits` table body (find the `reminder_time TIME NULL` line), add a line directly after it:

```sql
  reminder_time TIME NULL,
  -- This habit's own chime key; NULL = the user's default tone from Settings.
  sound VARCHAR(16) NULL,
```

- [ ] **Step 2: Widen the `notifications.kind` ENUM**

In `tableCreationQueries.sql`, find:

```sql
  kind        ENUM('mentorship_request','mentorship_accepted','mentorship_rejected','system') NOT NULL,
```

Replace with:

```sql
  kind        ENUM('mentorship_request','mentorship_accepted','mentorship_rejected','system','reminder','habit_reminder') NOT NULL,
```

(`reminder` was already used by `ReminderDeliveryScheduler` but was never added to this ENUM on a fresh install — a real pre-existing gap this touch also fixes.)

- [ ] **Step 3: Add `habits.sound` to the `migrations.sql` check-block**

In `migrations.sql`, inside the `SELECT … UNION ALL SELECT …` block, add a line right after the `habits`/`reminder_time` row:

```sql
  UNION ALL SELECT 'habits'                 AS table_name, 'reminder_time'
  UNION ALL SELECT 'habits'                 AS table_name, 'sound'
```

- [ ] **Step 4: Add the ALTER statements**

In `migrations.sql`, in the "---- The ALTERs, newest last ----" section, append at the very end (after the `family_members.status` widening):

```sql
ALTER TABLE habits ADD COLUMN sound VARCHAR(16) NULL;

-- Same widening as family_members.status above: adds 'reminder' (missing
-- since ReminderDeliveryScheduler shipped) and 'habit_reminder'.
ALTER TABLE notifications
  MODIFY COLUMN kind ENUM('mentorship_request','mentorship_accepted',
    'mentorship_rejected','system','reminder','habit_reminder') NOT NULL;
```

- [ ] **Step 5: Manually check against `SchemaCoverageTest`'s rules**

Cannot run `./mvnw test` on this machine. Re-read `backend/src/test/java/com/growthbuddy/config/SchemaCoverageTest.java` and confirm by inspection:
- `theSchemaFileAltersNothing`: no line in `tableCreationQueries.sql` starts with `ALTER TABLE` — confirmed, Steps 1–2 only touched existing `CREATE TABLE` bodies.
- `everyMigrationMatchesAColumnTheSchemaDeclares`: `habits.sound` (from Step 4's `ADD COLUMN`) must appear as a column in the `habits` `CREATE TABLE` body — confirmed by Step 1. The `MODIFY COLUMN` line does not match the `ADD COLUMN` regex at all, so it's exempt from this check (same as the existing `family_members.status` widening).
- `theMigrationCheckListsEveryColumnTheFileAdds`: the check-block (before `---- The ALTERs`) must contain both `'habits'` and `'sound'` — confirmed by Step 3.

- [ ] **Step 6: Commit**

```bash
git add tableCreationQueries.sql migrations.sql
git commit -m "feat(habits): add sound column, widen notification kind enum"
```

---

## Task 2: `Habit.sound` field, DTOs, and service wiring

**Files:**
- Modify: `backend/src/main/java/com/growthbuddy/habit/Habit.java`
- Modify: `backend/src/main/java/com/growthbuddy/habit/HabitDtos.java`
- Modify: `backend/src/main/java/com/growthbuddy/habit/HabitService.java`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Habit.getSound()`/`setSound(String)`; `CreateHabitRequest.sound()`, `UpdateHabitRequest.sound()`, `HabitResponse.sound()`. Task 6's scheduler reads `Habit.getSound()` only indirectly (it doesn't need it — the tone only matters for the on-device alarm in Task 9); this task exists so the value round-trips through the API for the frontend to store and read back.

- [ ] **Step 1: Add the field to `Habit.java`**

After the `reminderTime` field (around line 53), add:

```java
    /** This habit's own notification tone — a chime key from the frontend's
     *  table, not a file. Null means "the user's default tone from Settings",
     *  mirroring {@code CalendarReminder.sound}. */
    @Column(length = 16)
    private String sound;
```

- [ ] **Step 2: Add `sound` to the request/response records in `HabitDtos.java`**

```java
record CreateHabitRequest(
        @NotBlank @Size(max = 120) String name,
        HabitDomain domain,
        @NotBlank @Size(max = 64) String icon,
        @Size(max = 16) String color,
        Cadence cadence,
        Integer targetPerWeek,
        LocalTime reminderTime,
        HabitMetric metric,
        @Size(max = 16) String sound) {
}

record UpdateHabitRequest(
        @Size(max = 120) String name,
        HabitDomain domain,
        @Size(max = 64) String icon,
        @Size(max = 16) String color,
        Cadence cadence,
        Integer targetPerWeek,
        LocalTime reminderTime,
        HabitMetric metric,
        Boolean active,
        @Size(max = 16) String sound) {
}
```

And add `String sound` as the last component of `HabitResponse`, plus thread it through `HabitResponse.of(...)`:

```java
record HabitResponse(
        UUID id,
        String name,
        HabitDomain domain,
        String icon,
        String color,
        Cadence cadence,
        int targetPerWeek,
        LocalTime reminderTime,
        boolean active,
        int streak,
        int longestStreak,
        boolean doneToday,
        boolean protectedToday,
        boolean atRisk,
        int riskStreak,
        int freezeTokens,
        HabitMetric metric,
        Double todayValue,
        Integer todayDurationMin,
        String sound) {

    static HabitResponse of(Habit h, HabitStreak streak, int currentStreak, boolean doneToday,
                            boolean protectedToday, boolean atRisk, int riskStreak, int freezeTokens) {
        return of(h, streak, currentStreak, doneToday, protectedToday, atRisk, riskStreak,
                freezeTokens, null, null);
    }

    static HabitResponse of(Habit h, HabitStreak streak, int currentStreak, boolean doneToday,
                            boolean protectedToday, boolean atRisk, int riskStreak, int freezeTokens,
                            Double todayValue, Integer todayDurationMin) {
        int longest = Math.max(streak != null ? streak.getLongestStreak() : 0, currentStreak);
        return new HabitResponse(h.getId(), h.getName(), h.getDomain(), h.getIcon(), h.getColor(),
                h.getCadence(), h.getTargetPerWeek(), h.getReminderTime(),
                h.isActive(), currentStreak, longest, doneToday,
                protectedToday, atRisk, riskStreak, freezeTokens,
                h.getMetric(), todayValue, todayDurationMin, h.getSound());
    }
}
```

- [ ] **Step 3: Set it in `HabitService.create` and `update`**

In `create` (~line 245), right after `h.setReminderTime(req.reminderTime());`, add:

```java
        h.setSound(req.sound());
```

In `update` (~line 274, inside the `if (req.reminderTime() != null)` block's sibling checks), add:

```java
        if (req.sound() != null) {
            h.setSound(req.sound().isBlank() ? null : req.sound());
        }
```

- [ ] **Step 4: Manual review (cannot compile locally)**

Re-read the four edited files. Confirm: every `HabitResponse` constructor call site in `HabitService.java` (`toResponse`, both overloads) still compiles by argument count/order — the record gained exactly one trailing field, and `HabitResponse.of(...)` is the only place that constructs it, so no other call site needs a change.

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/growthbuddy/habit/Habit.java \
        backend/src/main/java/com/growthbuddy/habit/HabitDtos.java \
        backend/src/main/java/com/growthbuddy/habit/HabitService.java
git commit -m "feat(habits): accept and return a per-habit notification tone"
```

---

## Task 3: `NotificationKind.habit_reminder`

**Files:**
- Modify: `backend/src/main/java/com/growthbuddy/notification/NotificationKind.java`

**Interfaces:**
- Produces: `NotificationKind.habit_reminder`, consumed by Task 6.

- [ ] **Step 1: Add the enum value**

```java
package com.growthbuddy.notification;

/** Matches MySQL ENUM('mentorship_request','mentorship_accepted','mentorship_rejected','reminder','system','habit_reminder'). */
public enum NotificationKind {
    mentorship_request,
    mentorship_accepted,
    mentorship_rejected,
    reminder,
    system,
    habit_reminder
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/main/java/com/growthbuddy/notification/NotificationKind.java
git commit -m "feat(notifications): add habit_reminder kind"
```

---

## Task 4: `habit_reminder_dispatch_log` table + entity + repository

**Files:**
- Modify: `tableCreationQueries.sql` (new CREATE TABLE, same section as `reminder_dispatch_log`)
- Create: `backend/src/main/java/com/growthbuddy/habit/HabitReminderDispatchLog.java`
- Create: `backend/src/main/java/com/growthbuddy/habit/HabitReminderDispatchLogRepository.java`

**Interfaces:**
- Produces: `HabitReminderDispatchLogRepository.existsByHabitIdAndOccurrenceDateAndStatus(UUID, LocalDate, String)`, consumed by Task 6.

- [ ] **Step 1: Add the CREATE TABLE**

The `reminder_dispatch_log` table immediately above the insertion point ends with the semicolon
on its own line and lowercase, backtick-quoted column definitions — that exact local style, not
the uppercase style used elsewhere in this file, since this table is placed directly beside it:

```sql
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;
```

In `tableCreationQueries.sql`, right after that line (and before `CREATE TABLE IF NOT EXISTS
\`push_subscriptions\``), add:

```sql
-- One row per habit-reminder delivery attempt, so a scheduler tick that runs
-- more than once inside the catch-up window doesn't send the same reminder
-- twice in a day. Mirrors reminder_dispatch_log.
CREATE TABLE IF NOT EXISTS `habit_reminder_dispatch_log` (
  `id` char(36) NOT NULL,
  `habit_id` char(36) NOT NULL,
  `occurrence_date` date NOT NULL,
  `channel` varchar(16) NOT NULL,
  `status` varchar(16) NOT NULL,
  `error_message` varchar(255) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_habit_dispatch_unique` (`habit_id`,`occurrence_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;
```

- [ ] **Step 2: Write the entity**

```java
package com.growthbuddy.habit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Records a delivery attempt for one habit reminder occurrence date, so a
 * scheduler tick that runs more than once inside the catch-up window doesn't
 * send the same reminder twice. Mirrors {@code ReminderDispatchLog}.
 */
@Entity
@Table(name = "habit_reminder_dispatch_log", indexes = {
        @Index(name = "ux_habit_dispatch_unique", columnList = "habit_id, occurrence_date", unique = true)
})
@Getter
@Setter
@NoArgsConstructor
public class HabitReminderDispatchLog {

    @Id
    private UUID id;

    @Column(name = "habit_id", nullable = false)
    private UUID habitId;

    @Column(name = "occurrence_date", nullable = false)
    private LocalDate occurrenceDate;

    @Column(name = "channel", nullable = false, length = 16)
    private String channel;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "error_message", length = 255)
    private String errorMessage;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
```

- [ ] **Step 3: Write the repository**

```java
package com.growthbuddy.habit;

import java.time.LocalDate;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HabitReminderDispatchLogRepository
        extends JpaRepository<HabitReminderDispatchLog, UUID> {

    /** Only a delivered occurrence blocks redelivery — a failed attempt stays
     *  retryable inside the scheduler's catch-up window. */
    boolean existsByHabitIdAndOccurrenceDateAndStatus(UUID habitId, LocalDate occurrenceDate, String status);
}
```

- [ ] **Step 4: Manual review against `SchemaCoverageTest`**

Confirm `@Table(name = "habit_reminder_dispatch_log")` in the entity matches `CREATE TABLE IF NOT EXISTS \`habit_reminder_dispatch_log\`` in the schema file exactly (case-insensitive table-name match is what the regex does, but keep them identical). Confirm the CREATE TABLE has `IF NOT EXISTS` (guards `everyCreateTableIsGuarded`).

- [ ] **Step 5: Commit**

```bash
git add tableCreationQueries.sql \
        backend/src/main/java/com/growthbuddy/habit/HabitReminderDispatchLog.java \
        backend/src/main/java/com/growthbuddy/habit/HabitReminderDispatchLogRepository.java
git commit -m "feat(habits): add habit reminder dispatch log table"
```

---

## Task 5: `HabitRepository.findDeliverable`

**Files:**
- Modify: `backend/src/main/java/com/growthbuddy/habit/HabitRepositories.java`

**Interfaces:**
- Consumes: `Habit` (existing), `User`/`PushSubscription` entities (existing, cross-package — already referenced this way by `CalendarReminderRepository.findDeliverable`).
- Produces: `HabitRepository.findDeliverable(boolean inAppOn, boolean pushOn): List<Habit>`, consumed by Task 6.

- [ ] **Step 1: Add the query to `HabitRepository`**

In `HabitRepositories.java`, inside `interface HabitRepository`, add:

```java
    /**
     * Active habits with a daily reminder time, for a user reachable on at
     * least one of the given channels. Mirrors
     * {@code CalendarReminderRepository.findDeliverable} without the
     * WhatsApp branch — habits have no such integration.
     */
    @Query("""
            select h from Habit h
            where h.reminderTime is not null
              and h.deletedAt is null
              and h.active = true
              and exists (
                select 1 from User u where u.id = h.userId and (
                     (:inAppOn = true)
                  or (:pushOn = true and exists (
                        select 1 from PushSubscription p where p.userId = u.id))
                ))
            """)
    List<Habit> findDeliverable(@Param("inAppOn") boolean inAppOn, @Param("pushOn") boolean pushOn);
```

- [ ] **Step 2: Manual review**

`Query` and `Param` are already imported at the top of `HabitRepositories.java` (used by `HabitCheckinRepository.countDoneByUsersBetween`) — confirm no new import lines are needed.

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/growthbuddy/habit/HabitRepositories.java
git commit -m "feat(habits): query habits deliverable on a reminder tick"
```

---

## Task 6: `HabitReminderDeliveryScheduler` + test

**Files:**
- Create: `backend/src/main/java/com/growthbuddy/habit/HabitReminderDeliveryScheduler.java`
- Create: `backend/src/test/java/com/growthbuddy/habit/HabitReminderDeliverySchedulerTest.java`

**Interfaces:**
- Consumes: `HabitRepository.findDeliverable(boolean, boolean)` (Task 5), `HabitCheckinRepository.existsByHabitIdAndLogDateAndDoneTrue(UUID, LocalDate)` (existing), `HabitReminderDispatchLogRepository.existsByHabitIdAndOccurrenceDateAndStatus(UUID, LocalDate, String)` (Task 4), `NotificationKind.habit_reminder` (Task 3), `NotificationService.publish(UUID, NotificationKind, String, String, UUID)` (existing), `PushService.isConfigured()` / `sendToUser(UUID, String, String, String)` (existing), `UserRepository.findAllById(Iterable<UUID>)` (existing), `UserZone.of(String): ZoneId` (existing).
- Produces: a `@Component` with one `@Scheduled` method; nothing later depends on it directly.

This class has no injectable clock, matching the rest of this codebase (`UserClock`, `ReminderDeliveryScheduler` also call `Instant.now()` directly — see `DstWindowTest`, which tests the window *formula* in isolation rather than injecting time into the live scheduler). The test below follows the same convention: it picks each habit's `reminderTime` relative to the real `Instant.now()` at test-run time, not a fixed clock.

- [ ] **Step 1: Write the failing test**

```java
package com.growthbuddy.habit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.push.PushService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class HabitReminderDeliverySchedulerTest {

    private static final ZoneId UTC = ZoneId.of("UTC");

    private final HabitRepository habits = mock(HabitRepository.class);
    private final HabitCheckinRepository checkins = mock(HabitCheckinRepository.class);
    private final HabitReminderDispatchLogRepository dispatchLog =
            mock(HabitReminderDispatchLogRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final PushService push = mock(PushService.class);
    private final NotificationService notifications = mock(NotificationService.class);

    private final HabitReminderDeliveryScheduler scheduler =
            new HabitReminderDeliveryScheduler(habits, checkins, dispatchLog, users, push, notifications);

    /** A habit whose reminder time is "right now" in UTC, so it always falls
     *  inside the scheduler's catch-up window regardless of wall-clock time. */
    private Habit dueHabit(UUID userId) {
        Habit h = new Habit();
        h.setId(UUID.randomUUID());
        h.setUserId(userId);
        h.setName("Workout");
        h.setReminderTime(LocalTime.now(UTC));
        return h;
    }

    private User user(UUID id) {
        User u = new User();
        u.setId(id);
        u.setTimezone("UTC");
        return u;
    }

    private LocalDate today() {
        return LocalDate.now(UTC);
    }

    @Test
    void firesForADueHabitNotYetCheckedInOrDispatched() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), today())).thenReturn(false);
        when(dispatchLog.existsByHabitIdAndOccurrenceDateAndStatus(habit.getId(), today(), "sent"))
                .thenReturn(false);
        when(push.isConfigured()).thenReturn(false);

        scheduler.dispatchHabitReminders();

        verify(notifications).publish(eq(userId), eq(NotificationKind.habit_reminder),
                eq("Workout"), any(), eq(habit.getId()));
        verify(dispatchLog).save(any());
    }

    @Test
    void skipsAHabitAlreadyCheckedInToday() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), today())).thenReturn(true);

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
        verify(dispatchLog, never()).save(any());
    }

    @Test
    void skipsAHabitAlreadySentToday() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), today())).thenReturn(false);
        when(dispatchLog.existsByHabitIdAndOccurrenceDateAndStatus(habit.getId(), today(), "sent"))
                .thenReturn(true);

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
    }

    @Test
    void skipsAHabitWhoseTimeHasNotArrivedYet() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        habit.setReminderTime(LocalTime.now(UTC).plusHours(2));
        when(habits.findDeliverable(true, false)).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));

        scheduler.dispatchHabitReminders();

        verify(notifications, never()).publish(any(), any(), any(), any(), any());
    }

    @Test
    void sendsPushTooWhenConfigured() {
        UUID userId = UUID.randomUUID();
        Habit habit = dueHabit(userId);
        when(habits.findDeliverable(true, true)).thenReturn(List.of(habit));
        when(users.findAllById(any())).thenReturn(List.of(user(userId)));
        when(checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), today())).thenReturn(false);
        when(dispatchLog.existsByHabitIdAndOccurrenceDateAndStatus(habit.getId(), today(), "sent"))
                .thenReturn(false);
        when(push.isConfigured()).thenReturn(true);
        when(push.sendToUser(userId, "Habit reminder", "Workout", "/#habits")).thenReturn(1);

        scheduler.dispatchHabitReminders();

        verify(push).sendToUser(userId, "Habit reminder", "Workout", "/#habits");
    }
}
```

- [ ] **Step 2: Confirm it fails to compile (the class doesn't exist yet)**

Cannot run `./mvnw test` on this machine. Confirm by inspection that `HabitReminderDeliveryScheduler` has no source file yet — the test file above references a constructor and method that don't exist.

- [ ] **Step 3: Write the scheduler**

```java
package com.growthbuddy.habit;

import com.growthbuddy.common.UserZone;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.push.PushService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Polls habits with a daily reminder time and delivers one near it in each
 * user's timezone: the in-app bell always, plus Web Push for users set up
 * for it. Mirrors {@link com.growthbuddy.reminder.ReminderDeliveryScheduler}
 * without the WhatsApp branch — habits have no such integration — and adds
 * one rule reminders don't have: a habit already checked in today doesn't
 * page anyone about it.
 */
@Component
public class HabitReminderDeliveryScheduler {

    private static final Logger log = LoggerFactory.getLogger(HabitReminderDeliveryScheduler.class);

    /** Same grace period as calendar reminders: a slow run must not skip a
     *  habit entirely. */
    private static final Duration CATCH_UP = Duration.ofMinutes(5);

    private final HabitRepository habits;
    private final HabitCheckinRepository checkins;
    private final HabitReminderDispatchLogRepository dispatchLog;
    private final UserRepository users;
    private final PushService push;
    private final NotificationService notifications;

    public HabitReminderDeliveryScheduler(
            HabitRepository habits,
            HabitCheckinRepository checkins,
            HabitReminderDispatchLogRepository dispatchLog,
            UserRepository users,
            PushService push,
            NotificationService notifications) {
        this.habits = habits;
        this.checkins = checkins;
        this.dispatchLog = dispatchLog;
        this.users = users;
        this.push = push;
        this.notifications = notifications;
    }

    // Deliberately one query per candidate rather than the batched
    // dispatch-log read ReminderDeliveryScheduler uses: that batching earns
    // its complexity at "~1000 due reminders" scale (its own Javadoc). The
    // set of habits with a reminder time, across every user, is nowhere
    // near that yet — revisit if this tick ever shows up slow.
    @Scheduled(cron = "0 * * * * *")
    public void dispatchHabitReminders() {
        List<Habit> candidates = habits.findDeliverable(true, push.isConfigured());
        if (candidates.isEmpty()) {
            return;
        }

        Map<UUID, User> userCache = new HashMap<>();
        for (User u : users.findAllById(
                candidates.stream().map(Habit::getUserId).distinct().toList())) {
            userCache.put(u.getId(), u);
        }

        Instant tick = Instant.now();

        for (Habit habit : candidates) {
            User user = userCache.get(habit.getUserId());
            if (user == null) {
                continue;
            }
            ZoneId zone = UserZone.of(user.getTimezone());
            LocalDateTime now = LocalDateTime.ofInstant(tick, zone);
            LocalDate day = now.toLocalDate();

            // Zone-aware, not a bare LocalDateTime — see DstWindowTest for why.
            Instant scheduledAt = ZonedDateTime.of(day, habit.getReminderTime(), zone).toInstant();
            if (tick.isBefore(scheduledAt) || tick.isAfter(scheduledAt.plus(CATCH_UP))) {
                continue;
            }

            if (checkins.existsByHabitIdAndLogDateAndDoneTrue(habit.getId(), day)) {
                continue;
            }

            if (dispatchLog.existsByHabitIdAndOccurrenceDateAndStatus(habit.getId(), day, "sent")) {
                continue;
            }

            deliver(user, habit, day);
        }
    }

    private void deliver(User user, Habit habit, LocalDate day) {
        HabitReminderDispatchLog row = new HabitReminderDispatchLog();
        row.setHabitId(habit.getId());
        row.setOccurrenceDate(day);
        StringBuilder channels = new StringBuilder();
        boolean sent = false;

        try {
            notifications.publish(user.getId(), NotificationKind.habit_reminder,
                    habit.getName(), "Reminder to " + habit.getName(), habit.getId());
            channels.append("app");
            sent = true;
        } catch (Exception ex) {
            log.warn("In-app habit reminder {} for {} failed: {}", habit.getId(), user.getId(), ex.getMessage());
        }

        if (push.isConfigured()) {
            try {
                int n = push.sendToUser(user.getId(), "Habit reminder", habit.getName(), "/#habits");
                if (n > 0) {
                    channels.append(channels.length() > 0 ? "+push" : "push");
                    sent = true;
                }
            } catch (Exception ex) {
                row.setErrorMessage(truncate(ex.getMessage(), 250));
                log.warn("Push habit reminder {} for {} failed: {}", habit.getId(), user.getId(), ex.getMessage());
            }
        }

        row.setChannel(channels.length() > 0 ? channels.toString() : "none");
        row.setStatus(sent ? "sent" : "failed");
        dispatchLog.save(row);
    }

    private static String truncate(String input, int max) {
        if (input == null || input.length() <= max) {
            return input;
        }
        return input.substring(0, max);
    }
}
```

- [ ] **Step 4: Confirm it passes by inspection**

Cannot run `./mvnw test` here. Re-read the test and the scheduler side by side; confirm every mocked call in the test matches a call the scheduler actually makes (method name, argument order, argument count) — this is the type-consistency check that would normally be a compiler error.

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/growthbuddy/habit/HabitReminderDeliveryScheduler.java \
        backend/src/test/java/com/growthbuddy/habit/HabitReminderDeliverySchedulerTest.java
git commit -m "feat(habits): deliver habit reminders via bell and push"
```

---

## Task 7: Two new "hard" chime tones

**Files:**
- Modify: `scripts/chime.js`

**Interfaces:**
- Produces: `SOUNDS.alarm`, `SOUNDS.buzz`, and matching `CHIMES` entries, consumed by Task 8 (via `soundFile()`) and Task 9 (the Tone picker).

- [ ] **Step 1: Add the two entries to `SOUNDS`**

In `scripts/chime.js`, after the `hush` entry (before the closing `};`), add:

```javascript
  alarm: [
    { f: 880, t: 0, d: 0.12, g: 0.42, type: 'square' }, // sharp double-beep
    { f: 880, t: 0.16, d: 0.12, g: 0.42, type: 'square' },
  ],
  buzz: [
    { f: 220, t: 0, d: 0.35, g: 0.45, type: 'sawtooth' }, // low, harsh, sustained
  ],
```

Update the block comment above `SOUNDS` if it still says "a sine or triangle" — it now needs to also mention square/sawtooth:

Find:
```javascript
   Every sound is the same shape — a few notes, each a sine or triangle with
   a fast attack and an exponential tail — so adding one is a row in SOUNDS,
```

Replace with:
```javascript
   Every sound is the same shape — a few notes, each an oscillator with a
   fast attack and an exponential tail — so adding one is a row in SOUNDS,
```

- [ ] **Step 2: Add both to `CHIMES`**

In `scripts/chime.js`, in the `CHIMES` array, add two entries before the `off` entry:

```javascript
  { key: 'alarm', label: 'Alarm', hint: 'Sharp double beep, hard to miss' },
  { key: 'buzz', label: 'Buzz', hint: 'A hard, rattling buzz' },
```

- [ ] **Step 3: Run the self-check**

```bash
node -e "
import('./scripts/chime.js').then(() => console.log('chime.js loaded OK'));
"
```

This module's `_demo()` only runs under `import.meta.env.DEV` (a Vite-only global), so it won't execute from plain `node`. The real check is Step 4.

- [ ] **Step 4: Regenerate the rendered `.wav` files and let its own assertions run**

```bash
node scripts/gen-chimes.mjs
```

Expected output: 7 lines (one per sound in `SOUNDS`, now including `alarm` and `buzz`), each showing a peak that got lifted to 0.85, followed by `gen-chimes.mjs: rendered 7 sounds`. If either new sound is silent (peak ≤ 0.01) or clipping (peak ≥ 0.5) before the lift, the script throws — fix the `g` value and re-run.

- [ ] **Step 5: Commit**

```bash
git add scripts/chime.js public/gb-alarm.wav public/gb-buzz.wav
git commit -m "feat(chime): add two harder tones, alarm and buzz"
```

---

## Task 8: `upcomingHabitAlarms` in `push.js` (+ tests)

**Files:**
- Modify: `scripts/push.js`
- Modify: `scripts/push.test.mjs`

**Interfaces:**
- Consumes: nothing new from earlier tasks (this is pure frontend logic against a `habits` array shaped like the API's `HabitResponse`: `{ id, name, reminderTime, sound, doneToday, ... }`).
- Produces: `upcomingHabitAlarms(habits, now, days = HORIZON_DAYS): Array<{title, body, at, sound}>`, and `upcomingAlarms` gains a fourth input key `habits`. Task 9 depends on both.

- [ ] **Step 1: Read the existing test file**

`scripts/push.test.mjs` is a flat top-to-bottom script: `import assert from 'node:assert/strict'`
at the top, then bare `{ ... }` blocks with `assert.equal`/`assert.deepEqual` calls that throw on
failure, grouped under `/* ---- reminders ---- */` / `/* ---- water ---- */` comment banners, and
a final `console.log('push.test.mjs: all assertions passed')`. No test runner, no `describe`/`it`.
New cases follow the same shape.

- [ ] **Step 2: Write the failing tests**

Change the import line (near the top of `scripts/push.test.mjs`):

```javascript
import { upcomingReminderAlarms, upcomingWaterAlarms, upcomingAlarms } from './push.js';
```

to:

```javascript
import { upcomingReminderAlarms, upcomingWaterAlarms, upcomingHabitAlarms, upcomingAlarms } from './push.js';
```

Then insert a new `/* ---- habits ---- */` section right before the final three
`/* Nothing to queue is a normal state, not a crash. */` assertions at the end of the file:

```javascript
/* ---- habits ---- */

/* No reminder time set means nothing to schedule. */
assert.deepEqual(
  upcomingHabitAlarms([{ id: 'h1', name: 'Workout', reminderTime: null, doneToday: false }], NOW),
  []
);

/* Already checked in today: don't nag about something already done. */
assert.deepEqual(
  upcomingHabitAlarms([{ id: 'h1', name: 'Workout', reminderTime: '09:00', doneToday: true }], NOW),
  []
);

/* A habit's own tone rides on the queued alarm, same as a reminder's. */
{
  const got = upcomingHabitAlarms(
    [{ id: 'h1', name: 'Workout', reminderTime: '18:00', doneToday: false, sound: 'buzz' }],
    NOW,
    1
  );
  assert.equal(got.length, 1);
  assert.equal(got[0].sound, 'buzz');
  assert.equal(got[0].body, 'Workout');
}

/* No tone chosen falls back to null, resolved later by upcomingAlarms's own
   default — same contract upcomingReminderAlarms already has. */
{
  const got = upcomingHabitAlarms(
    [{ id: 'h1', name: 'Workout', reminderTime: '18:00', doneToday: false }],
    NOW,
    1
  );
  assert.equal(got[0].sound, null);
}
```

(`NOW` is `new Date(2026, 8, 16, 9, 0, 0, 0)`, already defined near the top of the file — `18:00`
is still ahead of it that day, `09:00` in the first two cases doesn't matter since both are
expected to queue nothing regardless of time.)

- [ ] **Step 3: Run the tests to confirm they fail**

```bash
node scripts/push.test.mjs
```

Expected: a failure (or a thrown `ReferenceError`/`TypeError`) naming `upcomingHabitAlarms`, since it doesn't exist in `push.js` yet.

- [ ] **Step 4: Implement `upcomingHabitAlarms`**

In `scripts/push.js`, after `upcomingWaterAlarms` and before the `soundFile` comment block, add:

```javascript
/**
 * One alarm a day for a habit with a reminder time set, skipped for a habit
 * already checked in today. Daily only, regardless of the habit's own
 * cadence — the UI calls this field "Daily reminder," and there is no
 * per-day-of-week input to honor anything else.
 */
export function upcomingHabitAlarms(habits, now, days = HORIZON_DAYS) {
  const out = [];
  for (const habit of habits || []) {
    if (!habit || !habit.reminderTime || habit.doneToday) continue;
    const [hh, mm] = String(habit.reminderTime).split(':').map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
    for (let i = 0; i < days; i++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const at = atOn(day, hh * 60 + mm);
      if (at.getTime() <= now.getTime()) continue;
      out.push({ title: 'Growth Buddy', body: habit.name, at, sound: habit.sound || null });
    }
  }
  return out;
}
```

- [ ] **Step 5: Wire it into `upcomingAlarms`**

Change the signature and body of `upcomingAlarms`:

```javascript
export function upcomingAlarms({ reminders, water, habits, sound } = {}, now = new Date()) {
  const queue = upcomingReminderAlarms(reminders, now)
    .concat(upcomingWaterAlarms(water, now))
    .concat(upcomingHabitAlarms(habits, now));
  queue.sort((a, b) => a.at - b.at);
```

(Leave everything below the `queue.sort` line unchanged — the id-assignment and sound-resolution logic already applies to whatever is in `queue`, no changes needed there.)

- [ ] **Step 6: Run the tests again to confirm they pass**

```bash
node scripts/push.test.mjs
```

Expected: all cases pass, including the pre-existing reminder/water ones (regression check).

- [ ] **Step 7: Commit**

```bash
git add scripts/push.js scripts/push.test.mjs
git commit -m "feat(push): queue on-device alarms for habit reminders"
```

---

## Task 9: Tone picker on habit creation + `reSyncDeviceAlarms` wiring

**Files:**
- Modify: `scripts/app.js`

**Interfaces:**
- Consumes: `CHIMES`, `playChime` from `chime.js` (Task 7); `upcomingAlarms`'s new `habits` key (Task 8); `createHabit(body)` (existing, ~line 1667) — `body.sound` is a new key it already passes straight through to `POST /api/habits`, so no change needed inside `createHabit` itself, only at its call site in `openAddHabit`.
- Produces: nothing further downstream — this is the last task.

- [ ] **Step 1: Confirm the chime helpers are already imported**

`app.js` already imports both `CHIMES` and `playChime` from `./chime.js` (lines 71–79, for the
Settings sound picker) — no import change needed for this task.

- [ ] **Step 2: Add the Tone select to `openAddHabit`**

In `openAddHabit()` (~line 5590), after the `reminderInput` declaration, add:

```javascript
  const toneSel = h(
    'select',
    { class: 'gb-input', 'aria-label': 'Habit reminder tone' },
    [h('option', { value: '' }, 'Default tone')].concat(
      CHIMES.map((c) => h('option', { value: c.key }, c.key === 'off' ? 'Silent — no alert' : c.label))
    )
  );
  toneSel.addEventListener('change', () => {
    if (toneSel.value) playChime(toneSel.value);
  });
```

In the `body` construction (the `h('div', { class: 'gb-form' }, ...)` call), after `reminderInput`, add `h('div', { class: 'gb-field-label' }, 'Tone'), toneSel,`:

```javascript
    h('div', { class: 'gb-field-label' }, 'Daily reminder (optional)'),
    reminderInput,
    h('div', { class: 'gb-field-label' }, 'Tone'),
    toneSel
  );
```

In the `createHabit({...})` call inside `onPrimary`, add `sound: toneSel.value || null,` next to `reminderTime`:

```javascript
      await createHabit({
        name,
        domain: d,
        icon,
        cadence: cadence.get(),
        color: color.get() || null,
        reminderTime: reminderInput.value || null,
        sound: toneSel.value || null,
        metric: d === 'fitness' ? metricSel.value : 'none',
      });
```

- [ ] **Step 3: Wire `state.habits` into `reSyncDeviceAlarms`**

`reSyncDeviceAlarms()` (~line 5007) takes no arguments — every call site just calls
`reSyncDeviceAlarms()`, and the function itself builds the object from `state`. So only
the one definition needs to change, not each of its ~9 call sites:

```javascript
/* Re-arm this device's alarm queue — timed reminders plus the water nudge, in
   the chosen chime. Fire-and-forget: a no-op on the web (the server pushes
   there), and a phone that has refused notifications is not an error worth a
   toast. Call it wherever any of the four inputs changes; the queue is
   rebuilt whole, so a stale one rings for a reminder already deleted. */
function reSyncDeviceAlarms() {
  syncDeviceAlarms({
    reminders: state.reminders,
    water: waterReminderPrefs(),
    habits: state.habits,
    sound: notifySound(),
  }).catch(() => {});
}
```

(Note "three inputs" → "four inputs" in the comment — that's Step 4 below.)

Then add a call after the habit list updates inside `createHabit` (~line 1667–1674), the
one input this function reacts to that had no call site at all before this feature:

```javascript
async function createHabit(body) {
  const created = await api('/api/habits', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  state.habits = [created, ...state.habits];
  await refreshScore();
  reSyncDeviceAlarms();
}
```

- [ ] **Step 4: Update the doc this change makes wrong**

In `docs/scripts/app.js.md`, find:

```
- **`reSyncDeviceAlarms()` after every change to its three inputs.** In the app, timed
  reminders and the water nudge are on-device alarms (`syncDeviceAlarms` in `push.js`) because
  the server can only deliver to a Web Push subscription the WebView can't register. The inputs
  are `state.reminders`, `ui_prefs.water` and `ui_prefs.notifySound` — the chime rides on
  each queued notification, so changing it has to rebuild the queue too. Cancelled and rebuilt
  whole, so anything that changed without a re-sync keeps ringing with the old list or the old
  sound. Wired at: boot, reminder add, reminder delete (inside `repaint()`, which the rollback
  also calls), the moment notification permission is granted, every water-setting change, and
  every sound change.
```

Replace with:

```
- **`reSyncDeviceAlarms()` after every change to its four inputs.** In the app, timed
  reminders, the water nudge and habit reminders are on-device alarms (`syncDeviceAlarms` in
  `push.js`) because the server can only deliver to a Web Push subscription the WebView can't
  register. The inputs are `state.reminders`, `ui_prefs.water`, `state.habits` and
  `ui_prefs.notifySound` — the chime rides on each queued notification, so changing it has to
  rebuild the queue too. Cancelled and rebuilt whole, so anything that changed without a re-sync
  keeps ringing with the old list or the old sound. Wired at: boot, reminder add, reminder delete
  (inside `repaint()`, which the rollback also calls), habit add, the moment notification
  permission is granted, every water-setting change, and every sound change.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/app.js docs/scripts/app.js.md
git commit -m "feat(habits): tone picker on creation, wire habits into device alarms"
```

---

## Task 10: Final local verification + push + hand off the manual prod step

**Files:** none (verification only).

- [ ] **Step 1: Run every frontend check this machine can run**

```bash
node scripts/push.test.mjs
node scripts/gen-chimes.mjs
node scripts/tokens.test.mjs
node scripts/icons.test.mjs
```

All four must pass. (The last two are unrelated to this feature but cheap enough to be worth confirming nothing else regressed.)

- [ ] **Step 2: Review the full diff**

```bash
git log --oneline -10
git diff main~10 --stat
```

Confirm the file list matches Tasks 1–9 exactly — no stray files.

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Watch CI**

```bash
gh run watch
```

(or `gh run list --branch main --limit 1` then `gh run view <id>`) — this is the first real compile/test signal for every backend change in Tasks 1–6, since none of it ran locally.

- [ ] **Step 5: Hand off the manual prod step**

Once CI is green and Render has redeployed, tell the user to run these three statements once against the live TiDB database (from the spec's "Manual step required on prod" section) before creating any habit with a reminder:

```sql
ALTER TABLE habits ADD COLUMN sound VARCHAR(16) NULL;

ALTER TABLE notifications
  MODIFY COLUMN kind ENUM('mentorship_request','mentorship_accepted',
    'mentorship_rejected','system','reminder','habit_reminder') NOT NULL;

CREATE TABLE IF NOT EXISTS `habit_reminder_dispatch_log` (
  `id` char(36) NOT NULL,
  `habit_id` char(36) NOT NULL,
  `occurrence_date` date NOT NULL,
  `channel` varchar(16) NOT NULL,
  `status` varchar(16) NOT NULL,
  `error_message` varchar(255) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_habit_dispatch_unique` (`habit_id`,`occurrence_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

(exactly matching the statement Task 4 adds to `tableCreationQueries.sql`, so a fresh install and
this manual prod run produce an identical table.)

Until that runs, creating a habit with a chosen tone, or the scheduler's first tick against a due habit, will 500 / fail against the live database.
