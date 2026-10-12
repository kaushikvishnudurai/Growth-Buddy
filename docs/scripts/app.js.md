# scripts/app.js — app shell

The hub: owns all state, routing, rendering, and **every** backend call. No exports (entry module).
Screen modules are leaves it calls into; they get thin `api` wrapper objects, never the state.

## Region map

| Region |
|---|
| imports, date helpers (`todayLabel`, `greetingFor` + its dev self-check, `firstName`; `dateKey` comes from `dates.js` (the device-local helpers); app.js's own `todayKey()` is the ACCOUNT's day (home-order.js `todayKey(state.user.timezone)`), and the old `todayKeyNow` copy is gone), `loadTheme` (follows the OS until a theme is picked; Settings › Display shows that as **System**, the default, beside Light / Dark, all through `setThemeChoice` — System clears `ui_prefs.theme`, Light/Dark pin it even when the phone already looks that way), `syncDeviceTimezone` / `offerDeviceTimezone` (asks once per phone zone, `ui_prefs.tzAsked`; `sameZone` (pure, in `app-logic.js`, tested there) treats zones with the same UTC offset now, mid-January and mid-July as equal, so Calcutta/Kolkata match even on WebKit, which does not canonicalise aliases; stands down until `ui_prefs.setupDone` is set; the write is `saveDeviceTimezone(tz)`), `enablePushFlow(okMessage)` (enable push + the outcome toasts; Settings › Alerts and `askPushOnce` share it), **`askPushOnce(needs)`** (the notification ask at the first timed save: `addReminder` with a `time`, `createHabit` / `updateHabit` with a `reminderTime`, and first-run's close when the goal step made timed items; once per account via `ui_prefs.pushAsked`, written before asking so a refusal is never re-asked; skipped inside first-run, where push can't notify, when already on, or when permission is `denied` — native reads `localNotificationPermission`, web `Notification.permission`; the rule is pure `pushAskDue` in `app-logic.js`), **first-run setup** `maybeStartFirstRun` / `openFirstRunSetup` (see Rules), `maybeAskPermissions` (native, `setupDone` accounts without `ui_prefs.healthAsked`: one sheet for notifications — only if this phone still says `prompt*` — and health access; marked asked when it shows), quote-of-day cache (`quoteDateStr`, `loadCachedQuote`, `cacheQuote`), toasts (`pushToast(message, kind, ms, action, opts)` — `opts.icon` replaces `TOAST_ICON`'s glyph, `opts.onGone` runs when the toast goes any way but its button (deferDelete's commit), also on the bridge as `toast.action(msg, label, run, {icon})` / `toast.success(msg, {icon})` (for notes' "Note deleted." → `'trash-2'`); `toastError`, `toastSuccess` (silent while `quietSuccess` is held — `applyQuickAdd` holds it so each saver's own "Sleep saved." doesn't sit beside the one summary toast), `dismissToast` (the toast is held `TOAST_OUT_MS` in `leavingToasts` for its exit), `clearScreenToasts` (`setScreen` drops button-less toasts older than 1 s on a screen change unless `opts.keepToasts`), timers `armToast` / `holdToasts` / `releaseToasts`, `errorToastMs`, `announce`, `isConnectionToast`) |
| `score()` (+ `optimisticScore()`, the same sum with the server's number ignored; its local task part is home-order.js `tasksForToday(tasks, now)`: open tasks due by tonight incl. overdue + tasks done today, undated/paused excluded), `loadSession`, `loadToken`, `saveSession` |
| wellness store (`emptyWellness`, `loadWellness`, `persistWellness`), goal progress (`loadGoalProgress`, `persistGoalProgress`, `updateGoalProgress` — optimistic; the newest save's failure rolls back and toasts; saves are chained per goal (`goalSaves`) through `putGoalProgress` → lazy `goal-merge.js` `putProgress`, which sends the tab's current blob with `If-Match: progressVersion` and on a 409 puts this tab's edits onto the body's progress (`mergeProgress`: fields ours where changed, milestones by id) and re-PUTs once; every save also dates today's percentage into the blob's `progressLog` via `goal-milestones.js` `withProgressLog`, and `addGoalAction` logs the day too when today isn't there — insights.js `goalPace` fits it). `runInsightAction(action)` is what a Report insight card's button does, by `action.kind`: `bedtimeReminder` → calendar form prefilled (`prefillCalendarReminder(text, {time, repeat})`), `waterNudge` → `ui_prefs.water` on with the window widened and its slot grid lined up on the hour, `editTask` → `openEditTask`, `habitReminder` → `updateHabit({reminderTime})`, `openMoney` → Money |
| **money store**: `moneyStorageKey`, `loadMoney`, `cacheMoney`, `saveMoney(next, base)` → `ledgerDiff(base, next)` laid onto the live state with `applyLedgerDiff`, and the document the same way (`docDiff(base, next)` → `applyDocDiff`, ops queued in `<money key>.docPending` by `storePendingDoc`, cleared by `clearPendingDoc(sent)` once a PUT lands — an offline loan repayment or budget used to be replaced by the server's copy at the next load; **`adoptServerMoney(theirs)`** = server copy + pending ledger rows + pending doc ops, used by loadSecondaryData, the 409 path and bank Sync now) → pending queue (`queueLedger`/`flushLedger`, replayed at boot via `overlayPending`; the batch carries an `idemKey` sent as `Idempotency-Key`, re-minted by `queueLedger` when the batch changes, dropped once it lands) + `putDocIfChanged`; `persistMoney` says "Saved on this phone — will sync" (info) when offline, on a 5xx or a `RETRYABLE` status (flushLedger keeps the batch on those), an error only for a refusal; the 5-minute re-push runs only online and when `moneyDirty()` (pending ledger rows, or a document unlike the last one accepted); an entry the server refuses (a `rejected` id, or a whole-batch 4xx other than 401/408/409/429) is put back to the server's copy by `rollbackMoneyItems(ids)`, those ids only; `accountRequest` (queued behind ledger writes); UI prefs `saveUiPrefs(patch, {quiet})` → `PUT /api/auth/ui-prefs` with **only `patch`** (the server merges per key; the whole blob let a stale tab revert another device's keys), a failure toasts unless `quiet` (the app's own baseline writes: achSeen, a detected timeFormat, tzAsked); patches in flight (`uiPrefsInFlight`) are laid over any `/me` that `syncUserSession` takes meanwhile (returns that request's promise), `hydrateUiPrefs`; ScreenMoney's `moneySettled` prop (`moneySettledFor(sessionGen())`; the CSV import waits on it between batches: `moneySaveQueue` idle, nothing pending; false once that session has ended, which stops the import); `putDocIfChanged` drops the pending doc ops on a non-retryable 4xx before rethrowing, so a refused edit isn't resent and re-toasted on every save |
| streak freeze: `emptyStreakFreeze`, `loadStreakFreeze`, `reconcileStreakFreeze`, `effectiveStreak`, `habitFreezeState`, `freezeTokensLeft`, `protectStreak`, `declineStreakBreak`, `toggleRestDay` (its toast reads "1 freeze used, N left" with Undo → `toggleRestDay(id, false)`, the unprotect; the Habits row's rest-day button is disabled below a 2-day streak and hidden, with the tick, while paused; the freeze calendar refuses a day whose previous day wasn't done or frozen (nothing to bridge); ticking a rest day says "Freeze returned" when the server's token count went back up (`plainToggleHabit`); both go through `freezeWrite`: optimistic habit + token count, one per habit in flight, exact rollback). Backend owns the tokens; this only reads fields + calls protect/unprotect. **Take a break** (I-08, `scripts/break.js`): `breakPrefs`, `setBreak(patch)` (saves `ui_prefs`, re-arms device alarms with `breakPrefs`, re-reads habits + score), `takeBreak(days, rescue)`, `endBreakNow`, `homeBreakEntry()` (Home's `breakEntry` prop: on a break "Until Wed, Oct 14" + End now; the day after one "Back on it" + mark the first owed habit done; else, when a habit's `pendingBreak` is up, "Take a break" 3 / 7 / 14 days starting yesterday); Settings > Alerts has the same buttons (`paintBreak`, in settings.js). Achievements: `achievementProps` (passes `ui_prefs.achSeen` as `seen`, so an earned badge stays unlocked), `checkAchievements` (fires `celebrate()` on first unlock). The profile dropdown's XP bar uses `levelProgress` from achievements.js (server's level curve) |
| local trends: `emptyTrends`, `loadTrends`, `persistTrends`, `recordTrendsToday` |
| `purgeUserCache(reason)` (every sign-out, a 401 included: removes every `gb.*.<uid>` key (`session.js` `isUserKey`, the app's `gb.boot.<uid>` snapshot too), keeps a non-empty money pending queue and the pending doc ops (`docPending`) except on deletion, keeps the offline outbox only on expiry), `clearSession`, `syncUserSession`, **`api(path, options)` / `apiFetch`** — the single network chokepoint; only a plain GET is de-duplicated (`_inflightGets`; one with `onResponse`/`raw`/`headers` gets its own request); `apiFetch` notes `sessionGen()` and an answer that lands after a sign-out rejects with `sessionEndedError()` (pushToast drops its message, and its 401 never ends the next session); merges `options.headers` (e.g. `Idempotency-Key`); a failed response's `ApiError.code` lands on `err.code`; attaches the bearer token and, in the Capacitor app, the `X-GB-Device` label from `native.js` so the signed-in-devices list can name the handset — `handleAuthExpired` (→ `endSession('expired')`; the per-account state list is session.js `freshUserState`, see `endSession` below) |
| `mapTask` (keeps the stored `priority`; overdue is a separate `overdue` flag, never a priority override, or the edit dialog writes it back), `formatTaskTime`, `cacheFoodSummary`, `loadCalendarFoodForDate`, in-place repaints (`rerenderCalendarSideIfActive` — coalesced to one repaint per tick, deferred while a field in the panel has focus, keeps its height while the day's food loads, puts the caret back in the reminder text after an add — `rerenderHomeMiniCalendarIfActive` (coalesced the same way; answers "is there a card?" synchronously, rebuilds it in a microtask), `updateCalendarDaySelection`) |
| **`loadData()`** (boot fetch fan-out), `loadQuote()`, `connectWebSocket` / `disconnectWebSocket` |
| mutations: `toggleTask` (sends `{done}`, the state the user saw, as does `plainToggleHabit`'s live PATCH; a 404 → `taskGoneElsewhere`: the row goes with "That task was deleted on another device.", no rollback, and `updateTask` does the same so its dialog closes), `toggleHabit` (a quit habit opens `openSlipDialog` — "I slipped" with a note, or undo the slip / save the note, all `POST /checkin` with `done: false` = slip; a measured habit always opens `openMeasuredCheckin` — not done yet: prefilled with `lastValue` / `lastDurationMin` ("same as last time"; Steps uses `readTodaySteps`, and where the phone gives nothing (the web) last time's number, selected so typing replaces it, with a "Last time 7,300" placeholder); done already: prefilled with today's value and `todayNote` (`habitNoteInput`, the shared ≤2000 note textarea), Save edits it, "Un-tick today" is its danger button → `plainToggleHabit`; the save shares `togglesInFlight` and refreshes score + user in parallel after closing), `refreshScore`, `refreshScoreLater` (create/update dialogs close on the write; the ring lands after), `refreshCurrentUser`, `createTask`, `updateTask`, `patchTaskNow` / `pauseTask` (optimistic one-field task change), `createHabit`, `updateHabit`, `createGoal` (places the POSTed goal, no reload; its toast carries "Add first task" → `openAddTask(goal)`), `toggleGoal` (optimistic, reconciles from the PATCH answer, `celebrate()` with `kicker: 'Goal complete'` when it turns done), `updateGoal` (PUT, moves the goal between horizon sections, renders itself), `loadGoalActions`, **undoable deletes** — `deleteTask`, `deleteHabit`, `deleteGoal`, `deleteWaterEntry`, `deleteFoodEntry` and `deleteReminder('all')` all go through `deferDelete` (see Traps), each with its `send…` / inline `commit`; `sendGoalDelete` drops the goal's cached `goalProgress` entry and `goalId` off its tasks once the DELETE lands, goal actions CRUD, `quickAddWater(ml, day?, drinkType?)` (optimistic, by `effectiveMl` — a coffee adds 0.8 of itself; the drink rides in `pendingWater` and the offline queue too; `pendingWater` taps are laid over each server answer by `withPendingWater` (→ pure `overlayPendingWater` in `app-logic.js`, with `replayOldestFirst`, `summaryIsForToday`, `generation` (weekGen), `applyWeekInvalidation`, `latestSeq` (goalProgressSeq), `inFlightKeys` (togglesInFlight); tested by `app-logic.test.mjs`), only on the summary's own day (`localDayOf` = the glass's day in the account's zone, like `water.date`); the same amount twice inside 600ms is dropped; offline or a 5xx keeps the glass and queues it in CacheStorage `<money key>.water`, replayed with its own `loggedAt` by `flushWaterQueue` from `loadData` and `handleOnline`; each tap mints an `idemKey` that the live POST and every replay send as `Idempotency-Key`, so a lost answer is not a second glass; a past `day` from the custom dialog is a plain POST at local noon), `refreshDayIfStale` (visibilitychange: refetches water / food when their summary's date is no longer today; the same handler refetches tasks and habits through `refreshOutboxStores` after more than 60 s hidden), `updateWaterGoal`, `logFoodEntry(payload, {undo})` (with `undo`, the toast is "Logged X." + Undo → `undoFoodLog(id)`, a plain `DELETE /api/food/entries/{id}`; food has no outbox, so offline fails with a toast either way), `saveSleepEntry`, `saveMoodEntry`, `autoTickHabit` / **`autoTickHealthHabits`** (after `loadData`, on visibilitychange and after every `saveSleepEntry`: a habit with `healthLink` + `healthTarget` ticks once today's reading reaches it — sleep from **today's sleep entry** (so a hand edit counts, and it works on the web), the rest from `readHealthValue`; an unlinked Steps habit still uses the target in its name. The habit form's "Tick it from health data" field is guessed from the name by `suggestHealthLink` until the user picks; edit sends `healthLink: ''` to clear) / **`autoLogSleep`** (no sleep logged for today → `readLastNight()` → `saveSleepEntry`, quality 'okay'; runs on visibilitychange and **only after `dailyLogs` lands** in `loadSecondaryData` — before that an empty day may be one logged on another device, and it would be overwritten) / **health readings** `health` (`readings` from `GET /api/health/readings?days=90`, reset in `endSession`, never cached locally) + `loadHealthReadings` (Health screen open; boot when a habit links to a non-sleep reading; ticks linked habits after) / `syncHealthFromPhone({force})` (native: `readHealthForSync(7)` → `POST /api/health/sync`, then reload; throttled 15 min; boot, resume, Health open) / `connectHealth` (the only path to `requestHealthAccess`) / `saveHealthReading` / `updateHealthReading` / `deleteHealthReading` (hand-typed rows only; the server refuses phone rows) / `healthTodayValue(link)` (a linked habit's today: live phone value, else the synced phone row, plus every hand entry today) / `loadPhoneNight` (boot and visibilitychange, after `autoLogSleep`: today unlogged and the Sleep & mood card enabled → `state.phoneNight` from native.js `readLastNight` via dynamic import, stamped with today's key so `lastNightGuess` drops it after midnight; memory only, `freshUserState` clears it; absent export or a throw = no phone row. It feeds Home's "Save it?" row when `autoLogSleep` has not already saved the night) / `autoTickFocusHabits` (after a saved focus session, from `/api/focus/stats` todayMinutes) — dated check-in with the number, Undo on the toast, tried once per habit per day (`autoTickTried`), `addQuickExpense(it)` / `addQuickIncome(it)` (booked through `quickMoney` in **`scripts/quick-add.js`**: the intent's `date`, the account Money's own form would start on (`defaultAccount`: expense = `settings.lastAccountId`, else first cash; income = first bank/wallet), a named `currency` converted at the user's `settings.fx` rate with `orig` kept; each returns the new id for `removeQuickMoney`, the toast's Undo), **`runQuickAdd(text)`**, `rememberPhotoFood`, `showFoodLoader(name)` (the full-screen "Estimating calories" over a food save, CSS in app.css "Food loader"; shown after 200ms so a fast save does not flash it). Also `quickMood(mood, night)` (Home's one-tap mood; `night` is the "Slept ...?" row above it, logged by the same tap, toast with Edit). |
| modals: `openSleepSchedule` (an unlogged night opens on `lastNightGuess`, else 23:00 / 07:00; the date is "Morning you woke up" and a live line names the night — "Last night · 7 h 30 min" — instead of "for today"), `openMoodCheckin`, `openDailyPlan`, `openAddFood(opts)` (`opts.file`: a plate photo already taken, estimated as soon as the form opens via `estimatePlate`; `estimateFromPhoto(file)` defaults to the form's own picker and sends notes.js `shrinkPhoto`'s 1280px JPEG: a raw camera photo is over the 2,000,000-char DTO cap), `addSuggestedReminder`, `deleteWaterEntry`, `deleteFoodEntry` (both undoable, no confirm: `summarySlot` takes the entry and its totals out and puts both back; rows carry `data-water-id` / `data-food-id` for the exit and return animation; once the food row has gone (`deferDelete`'s `afterRemove`, after the render) focus moves to the next row's `.gb-food-row-edit`, else the previous, else `.gb-food-add` — it used to fall to body), `openEditFood(entry)` (the food row's text; `PUT /api/food/entries/{id}`). `logFoodEntry` throws; it posts typed calories to `/entries/manual`. Log food (`openAddFood`) opens on the Food field (then Amount + Calories; Day, Home/Hotel and Slot come after, they have defaults) and **closes on Add**: a typed entry goes to `logFoodLater(payload)`, which saves (and estimates) under the screen, with an "Estimating calories" toast while an estimate runs and a **Retry** toast on failure that keeps the payload; field refusals are `fieldRefusal` under the field. Only a plate photo's items still wait behind `showFoodLoader`. Under the Food field, one sideways-scrolling row of "had before" chips: favourites first (`favouriteFoods`, `loadFavouriteFoods`, `starFoodEntry(entry, on)` from the star in `openEditFood`), then `recentFoods` (`GET /api/food/recent`, dropped on every log), duplicates merged; typing filters it, and **one tap logs that food** (its grams, `pieces`, kcal and a favourite's macros, on the dialog's day and slot). A typed name matching one of them (`remember`, on `change` and again at save) fills its last portion, by the piece if it was counted, and its kcal, which follows the amount until typed over (`kcalFor` / `autoKcal`, shared with the barcode label). Both caches dropped in `endSession`. Both dialogs carry a Slot picker (default `mealSlotAt(now)`). "Scan a barcode" exists only where `canScanBarcode()` (BarcodeDetector + getUserMedia): `openBarcodeScanner(onCode)` is its own overlay whose `onClose` stops the camera tracks however it closes; its `getUserMedia` is the permission ask (no `permissions.query` pre-check), and a failure shows nutrition.js `cameraErrorMessage(err, isNative())` (in the app, Android only prompts because the mobile manifest declares CAMERA); the code goes to `GET /api/food/barcode/{code}` and fills name, grams (serving, else 100) and kcal, which follows the grams until typed over; at save, `labelFor(product, grams)` sends the label's macros/sugar/sodium while the name still matches. `copyYesterdaySlot(slot)` is the Food card's "Copy yesterday's …" (`POST /api/food/entries/copy`); `yesterdaySlots()` decides which slots get one, from `state.calendarFoodByDate[yesterday]` (fetched once per day per session if the calendar hasn't already) `openDailyPlan` plans tomorrow after 21:00 (`planTarget`). |
| notifications (`refreshNotifications`, `markNotificationRead`, `respondMentorshipRequest`, `unreadNotifs`; **the bell is paged** — `NOTIF_PAGE` = 30 via `notifPageUrl(filter, before)`, `setNotifFirstPage`, `loadOlderNotifs` ("Load older"; `before` is inclusive server-side so repeats are dropped by id, and a page with nothing new ends the stream), `notifPaging.beyond` = the server's unread past the loaded pages (`syncNotifBeyond`, from `unread-count`) so the badge still counts them all; an empty bell shows `bellPressing()` instead of "all caught up" when there is one (the most overdue High task → `openEditTask`, the longest daily streak ending at midnight → Habits; one line each) and hides the chips; filter chips `NOTIF_FILTERS` over `notifCategory(n)` (the row's `category`, else its kind), each chip with its own cursor — `notifCursor`/`notifHasMore`; header **Mark all read** (`markAllNotificationsRead` → POST `mark-all-read`) and **Clear read** (`clearReadNotifications` → DELETE `read`), both optimistic with rollback; the old "Clear all" is gone from the UI), header popovers (`toggleNotifOpen`, `toggleProfileOpen`, `toggleMoreOpen`, `profileDropdown`), routing (`screenFromHash`, `setScreen`, `returnToScreen` + `landAfterSignIn` — a signed-out deep link or the screen a session expired on is where the next sign-in lands; `render()` sets `document.title` per screen), **`applyTheme(theme)`** — the only writer of `data-theme`, because the native status bar has to be repainted alongside it — `toggleTheme`, `pickedTheme` / `setThemeChoice` (Settings' System / Light / Dark) |
| profile + settings — **moved intact to `scripts/settings.js`, a lazy chunk**: app.js keeps only `openProfileSettings(initialTab)` (imports the chunk, hands it `settingsContext()`, the app functions it uses by the same names) and `repaintReminderSettings()`; the names below live in settings.js now: `saveProfileDetails`, `CountryPhoneInput`, `buildSegSlider`, `customisePanes()` (builds the Display + Layout panes), `securitySection()` (devices — `ipLabel` words loopback as "This computer" and private ranges as "Local network", real IPs stay — + password, then `accountSecuritySections()`: change email — new address + password → code from the new inbox — and two-step sign-in setup/disable off `GET /api/auth/security` (headed "Change email", since the Account section above already has an "Email" row); the setup key and otpauth link are shown as text with `copyText`, no QR library; recovery codes are shown once), **`openProfileSettings(initialTab)`** (the one Settings modal), `getNutritionSuggestion` |
| calendar: `syncSelectedDateToVisibleMonth`, `rerenderCalendarToolbarIfActive`, `rerenderCalendarMonthInPlace`, `calPrevMonth`/`calNextMonth`/`calToday` (= `calGoTo(new Date())`; `calGoTo(day)` is separate because `calToday` is passed as an onclick), `selectDate`, `retryCalendarFoodDate`, `addReminder`, `repaintCalendarGrid`, `deleteReminder`, `openIcsImportDialog` (Import .ics: lazy `import-ui.js`, account zone, refetch + repaint after) |
| **command palette** (just before `render()`): `openPalette(help)` imports `palette.js` on first use (a failed import is retried next time) and calls `openPalette(paletteProps())` or, for `?`, `openShortcutHelp(GO_KEYS, SCREEN_LABEL)`; `paletteProps()` = every searchable item from state (actions gated by `featureOn`, screens = `SCREENS` filtered by `screenEnabled`, tasks → `openEditTask`, habits → `openHabitForm`, goals → Goals, reminders → `openDay` on the calendar, notes via `listNotes` = `GET /api/notes` → `openNoteById` / `pendingNoteOpen`, taken by ScreenNotes' `openOnMount`), plus `runQuickAdd` and the recent picks (`ui_prefs.paletteRecent`, last 5, written by `saveRecent` → `saveUiPrefs`). One module-level `keydown` listener: Ctrl/Cmd+K always (focuses the palette if open); with no field focused and no `[aria-modal]` open: `/` palette, `?` help, `n` New task, `g` then a `GO_KEYS` letter within 1.5 s (`goToScreen`; `s` = Settings). Header button: `AppHeader({onSearch})` |
| shared UI: `openModal` (now a two-line wrapper over gb-kit's, adding `render()` after a successful primary — the layout itself lives in `gb-kit.js`), `segmented`, `openAddSheet(prefill)` (its Reminder option opens `openReminderSheet`, below; its first option, Photo, calls `snap.js`'s `openSnap` with `shrinkForSnap` + `snapRoutes()`: `SNAP_ROUTES` receipt / plate / groceries into the existing scanners, minus any whose feature (`SNAP_FEATURE`) is off, and Groceries unless `state.inFamily === true` (from `GET /api/family` via `noteFamily`: once after wave 2 when Family is on, and on every Family-screen `getFamily`; the scan 400s without a family); none left = no Photo option; its Quick add is `quickAddBox({ onLeave, onCancel, text, preview })` (its submit is `runQuickAdd`), shared with Home: `homeQuickAdd()` caches one node per signed-in user so a re-render keeps the typed text; `onLeave` closes the sheet once a parse found something; the line is cleared only once it is logged, via `openQuickAddPreview(rows, sub, onLogged, onCancel)`. openModal has no close hook, so the preview watches its own node leave the page: not logged by then = cancelled, and the sheet's `onCancel` is `openAddSheet(text)`, which reopens with the line and the caret at its end (Home's box just refocuses); `prefill` is that line (a string) or a share's `{ text, preview }`, which reads the line at once into the preview), `toDateTimeLocal`, `taskForm` (shared by `openAddTask` / `openEditTask`; Today / Tomorrow / Pick chips (`.gb-due-chips`) above the `datetime-local` set the end of that local day, a second tap clears, no chip by default; a new task's title is read by `parseWhen` into Due with a removable `.gb-when-chip`, a hand-picked due wins; its "Add a reminder" button calls `remindAboutTask`, which hands the title — plus the due day and time when the due date is still ahead — to the calendar form via `prefillCalendarReminder` + `calGoTo`), **task templates** (`openTaskTemplates` from New task's "Add from a template"; named checklists in `ui_prefs.taskTemplates` = `[{id, name, items:[title]}]`, max 20 x 30; `addTemplateTasks` POSTs one task per line with `allSettled`, so a partial failure keeps what saved; New task's "Add another" / Shift+Enter saves and clears only the title, for a run of tasks), `colorPicker`, `openAddHabit` / `openHabitForm(habit)` (`colorPicker`, `openHabitForm`, `habitHistoryPanel`, `openFreezeCalendar`, `FITNESS_PRESETS`, `HABIT_TEMPLATES` live in **`scripts/habit-dialogs.js`**, a lazy chunk; app.js's `habitDialogs()` imports it and `bind()`s the app functions it uses; one form for new + edit; edit PUTs, sending `''` / `clearReminder` for blanks because PUT reads null as unchanged; a Fitness preset fills the name only when it is empty or still the last preset's; New habit only: a Build / Break segmented (`kind`, create-only; Break hides cadence + fitness presets and sends daily / metric none, default icon `ban`) and `HABIT_TEMPLATES` chips (Drink water, Read 20 min, Walk 8k steps, No sugar = quit, Meditate) that set name, category, kind, metric (Meditate = minutes, Walk = steps) and icon — their icons are in `HABIT_ICONS`, checked by `HabitIconsTest`; the Records (metric) field is shown for every build habit, not only Fitness (only the fitness presets are Fitness-only), and a category change keeps it — it used to reset to none, so saving an unchanged General habit that records minutes wiped its metric; cadence is Daily / Weekly / "N× a week" (`custom`, with a 1–7 `targetPerWeek` field); editing adds a Pause switch → `active`; a new build habit saved with no reminder toasts "Remind you at HH:MM?" from `suggestReminderTime` (habit-stats.js), saved by `updateHabit` on tap — `createHabit` returns the habit for it), `relativeTime` (past a week: "11 Oct", never the locale's ambiguous "11/10/2026"), `notificationDropdown`, `toastStack` (+ `TOAST_IN_MS`). There is no `confirmDelete` any more: app.js deletes are undoable (`deferDelete`) |
| **habit order**: `moveHabit(id, ±1)` (optimistic swap, then `PUT /api/habits/order` with the whole list; saves chained on `habitOrderQueue` so two quick taps can't land out of order; a failure restores the order from before that tap only if nothing moved since), `habitReorderMode` (module flag: the Habits header's Reorder/Done button swaps each row's rest-day + tick for up/down arrows), `refocusMoveButton`. `createHabit` appends (the server files a new habit last). **Habit history**: `habitHistoryPanel(habit)` — the top of Edit habit: 30-day / all-time completion and best streak (`habitStats`, habit-stats.js; best is max with the server's `longestStreak`), a 12-week heatmap from `GET /api/habits/{id}/history?days=730` ("Last 2 years" when `since` is the window's start), today and the 7 days before are buttons that open that day's inline popover (`dayPopover`: tick / un-tick — on a quit habit log / undo a slip — plus the day's note and Save note; `saveDay` POSTs `/checkin` with `{date, done, note}`, optimistic, rolled back on failure; refreshes the score only for today; drops that habit's `goalHabitHistory`). Under the legend, `recentNotes` lists the last 5 noted days. Its `paint()` filters its optional children before `replaceChildren` (a null child printed "null"). A quit habit's panel reads clean / slipped (`kind` into habitStats / heatmapWeeks) and its stats are clean-day rates and the best clean run. `accountTodayKey()` = today in `state.user.timezone`. **Goals ↔ habits**: `goalHabitHistory` (per linked habit, fetched once per day+span by `ensureGoalHabitHistory`; today's tick read live off `state.habits`), `goalHabitSummary()` → GoalRow's `linked` prop, `effectiveGoalProgress()` (a counted-from-habits tracker's `daysFollowed`, plus each goal's derived, never-saved `linkedTasks` {done,total,open} and `work` (milestones + finished tasks when `countTasks`) from `goal-tasks.js`; passed to Goals and Home's GoalsCard). **Goals ↔ tasks**: `mapTask` keeps `goalId`; `taskForm(task, presetGoalId)` adds a Goal picker (open goals + the task's own) sending `goalId` / `clearGoal`; `openAddTask(goal?)` is Goals' "Add a task", and `openAddTask({ dueToday: true })` (Home checklist's "Add a task for today", `onAddTodayTask`) prefills Due with today (`taskForm`'s `presetDue`; a title time phrase overrides it and falls back to it); `toggleTask` → `suggestGoalDone` toasts "Mark goal done" when the tick closed a goal's last open task; `deleteGoal` drops `goalId` off its tasks |
| `ScreenHabits` (row sub-line: `cadenceLabel` + `weekProgressLabel` "2/3 this week" + the streak: a daily habit's as `StreakChain` (dashboard.js, the seven-day bead chain Home draws), a weekly/custom one's as text in `streakUnit` weeks; the heading carries a mono `done/owed` count, and its row wraps (Reorder / Add go under it at 320px with Largest text); "Paused ·" first; a quit habit (`isQuitHabit`) shows `quitHabitLabel` "Breaking · 🛡 5 days clean", no rest-day button, and a `.gb-slip-btn` "I slipped" pill instead of the tick), `habitDueToday` (what `score()`'s local fallback counts, = home-order.js `habitDue`), `featureOn` / `screenEnabled` / `setFeature`, `saveDigestPrefs`, `saveHomeLayout`, `saveNavLayout` |
| **`SCREENS` registry** — screen id → render fn. Start here to find a screen. |
| `captureScrollPosition` / `restoreScrollPosition` |
| auth: `authPost`, `loadAuthDraft`, `setAuthMode`, `authShell` (draws `GARDEN_SVG`, the crest, growing once per load via `gardenGrown`; hides a `SESSION_EXPIRED` error under the notice that already says it), `field`, `renderAuth`, `authFail`, `refuseFocus`, `runAuth`, `shakeRefusal`, `viewSignin` (opens the code screen only on a 403 with `code: email_unverified`, which `AuthService.login` sends for a right password on an unverified email — any other 403, a CORS refusal say, said a code was sent when none was), `viewSignup` (email, name, one password: no confirm field), `viewVerify` (OTP; the sixth digit typed, pasted or autofilled submits, Verify stays), `viewForgot`, `viewReset`, **`routeSignInStep`** (a login/reset refusal carrying `err.code` `totp_required` → `viewTotp`, `deletion_scheduled` → `viewDeletion`; holds email + password in `state.authPending`, memory only — a reload lands on sign-in), `completeSignIn`, `backToSignin`, `viewTotp` (authenticator or recovery code; re-POSTs `/login`, or `/cancel-deletion` when the cancel needed 2FA), `viewDeletion` ("Cancel deletion"), `loginCard` |
| `privacyLink()` (the hosted policy at `publicSiteUrl()/privacy.html`, new tab / system browser) under the sign-in card (`.gb-login-legal`) and in Settings › Account › About. **`endSession(reason)`** — the ONE way out (`logout` = `'logout'`, `handleAuthExpired` = `'expired'`, account deletion = `'deleted'`): `closeOverlays({discard: true})` + popovers, then **`flushPendingWrites()`** (Sign out only, all inside one 4 s race: feat/ov-undo's pending deletes, awaited; then the outbox's queue and `flushWaterQueue`), `bumpSession()` + `_inflightGets.clear()`, `revokeOnServer(token)` (Sign out only: web push unsubscribed with a token-bound fetch, then the revoke; with no connection the token goes to `gb.revoke.pending` (`queueRevoke`), sent by `flushRevokes` on 'online' and at boot, and once more with keepalive on `pagehide` (an ephemeral WebKit store loses the queue on reload)), device alarms, focus timer (`resetFocusSession`), socket, `purgeUserCache` (keeps the outbox and the water queue on `'expired'`) + `deleteUserCaches()` (`session.js` `USER_CACHES`, the SW's URL-keyed `gb-api-get`), `clearSession`, `clearReminderForm`, `Object.assign(state, freshUserState(EMPTY_STATE))`, then module memory (bell paging, toast timers, `loadedFor`, Insights throttle, food chips, `pendingWater`, `weekGen`). Every sign-in goes through `completeSignIn`, which starts from `freshUserState` too. `node scripts/session.test.mjs` fails on a `state` field neither reset nor listed device-level, and on a sign-out path that skips `endSession`; `downloadMyData` / `downloadDataButton` (GET `/api/auth/export` → JSON file via `offerFile` (save-file.js), which toasts the app's "not available yet" itself; "downloading" only on `'saved'`; Account settings + the delete-account sheet), `openDeleteAccount` (schedules the deletion — 7 days, every session revoked — then `endSession('deleted')` and a reload), `mentorSkeleton` / `loadingContent`, **Buddy wiring** (`mentorApi()` — thread endpoints, `act.task/habit/reminder` for the one-tap chips (a task/habit chip's toast Undo is `unmake`: removes it now and sends `sendTaskDelete` / `sendHabitDelete` directly, no deferred delete and no second Undo toast; a failed send puts it back); `mentorThreadId` = the open thread, memory only; `takeMentorStarter()` / `openReflectionCard(n)` prefill the composer from a `buddy_checkin` card — the bell tap, or an unread one < 3 h old when the push opened `/#mentor`; `reflectionLabel()`), `offlineBanner`, `weeklyReviewNudge` (Home only), `handleOnline` (`loadData().then(flushOutbox)` + `flushWaterQueue`)/`handleOffline`, **`render()`**, `installOutsideClickToCloseHeaderPopovers` |

**Service worker and launch URLs (top of file).** `initServiceWorker()` (web build only; the app
unregisters any worker) uses `registerSW` from `virtual:pwa-register`: `onNeedRefresh` → the toast
"A new version is ready." with Reload (`updateSW(true)`: the waiting worker takes over, the page
reloads); `onRegisteredSW` re-checks (`reg.update()`) on every return to the foreground, and re-offers
the toast if it was dismissed. Never skipWaiting on its own: the old page keeps the old precache until
Reload (vite.config.js workbox comment). `pendingLaunch = launchIntent(location.search)` is read at
module load and the query is stripped at once (a reload must not log a second glass);
**`runLaunchIntent()`** runs after the first `loadData()` wave 1: `water` → `quickAddWater(WATER_ACTION_ML)`
+ "Logged 250 ml of water." (when it landed online), `task` → `openAddTask()`, `focus` →
`focusAutoStart = true; setScreen('focus')`, `quickadd` → `openAddSheet()`, a share →
`openAddSheet({text, preview: true})`, which reads the words at once and always shows Quick add's
preview (even a controls-only sentence), so nothing is written until the user confirms. Signed out,
it waits for the sign-in's first load.

**`screenFromHash` reads `SCREENS` itself** — there is no id list to keep in step. The `SCREEN_IDS`
array that used to live here was missing `report`, so refreshing on Progress or opening any link to
it silently landed on Home. Don't reintroduce a second list.

## Rules when editing

- **Popover-only state changes call `repaintOverlays()`, never `render()`.** The bell, the account
  menu and the "More" sheet are siblings of the active screen, but `render()` calls `cfg.render()` and
  builds a brand-new screen — so toggling any of them threw away whatever state that screen owned.
  On Family that meant tapping the bell with Pantry open dumped you back on Members; Money, Mentor
  and Circle have the same exposure. `repaintOverlays()` swaps just `#gb-notif-slot`,
  `#gb-profile-slot`, `.gb-nav-wrap` and the bell badge (`paintBellBadge`), syncs the bell/avatar
  `aria-expanded` (`syncHeaderExpanded`, which `render()` calls too, and which keeps the three panels
  in gb-kit's back stack via `syncPanelHistory`; `render()` refills both slots with `fillHeaderSlots`), moves focus into the More sheet
  on open and back to its button on close, and falls back to a full
  render before first paint. **Reading a notification is a popover-only change too** — the read-all
  link, `markNotificationRead`, the bell's invite accept/decline (`respondMentorshipRequest`) and
  the `refreshNotifications` poll all end in `repaintOverlays()`.
  They used to call `render()`, so "Mark all read" visibly reloaded whatever screen you were on.
- **`installOutsideClickToCloseHeaderPopovers` tears down the previous listeners** via the
  module-level `popoverCleanup` before attaching new ones. Each call builds fresh closures, so
  without that a bell → avatar → bell sequence left orphaned `mousedown`/`keydown` listeners on
  `document` for the rest of the session. It covers the bottom-nav More sheet as well (Escape
  closes all three); mousedown inside `.gb-nav-wrap` is ignored, since the nav handles its own taps.
  It also calls `syncPanelBackEntry()`: while any of the three is open they hold **one**
  gb-kit `trackOverlay` entry (`untrackPanels`), so hardware / browser Back closes the panel
  (`closeHeaderPanels`) before it leaves the screen or minimises the app.
- **Deep links**: boot calls native.js `onDeepLink`; the link's hash (`deepLinkHash`) is written to
  `location.hash` and the `hashchange` handler routes it like a typed URL (signed out →
  `returnToScreen`). A hash with a query forces `setScreen` on the screen already showing, so
  `#/circle?join=CODE` still reaches Circle's `joinFromLink` when Circle is open.
- **Lazy screens: family, circle, timer, goals, report, mentor, notes, money.** The first six exported only their
  `Screen*` to app.js and nothing else imported them — ~151 KB of source a Home visitor never touches.
  `SCREENS[x].render()` must stay synchronous, so `lazyScreen(loader, build)` returns a skeleton now
  and **`replaceWith`s** the real root when the chunk lands. Replace, not wrap: the desktop width cap
  is `.gb-scroll > .gb-rise:not(.gb-goals):not(.gb-mentor)`, so a wrapper would steal the cap and
  break those two exceptions. It also bails if the placeholder is no longer `isConnected` — a later
  render() made its own, and a stale one must not resurrect itself. A chunk that has loaded once is
  kept in `lazyModules` (keyed by the loader's source text) and later renders build synchronously,
  so a tap on Goals, Report, Timer or Notes no longer flashes the grey placeholder.
  **`money.js` is lazy too** (`SCREENS.money` → `lazyScreen(() => import('./money.js'), …)`). What
  app.js needs at boot (`emptyMoney`, `normalizeMoney`, `docDiff`, `applyDocDiff`, `ledgerDiff`,
  `applyLedgerDiff`, `docPart`, `LEDGER_ARRAYS`) comes from **`money-core.js`**, Home's card from
  `money-home.js`; Settings' Money pane (`customisePanes` → `moneyPane`) wraps
  `MoneyCustomisePane` in `lazyScreen` too, followed by **`bankFeedSection()`** (Connect your bank:
  `GET /api/money/bank`, empty when the server says `configured: false`; `openConnectBank` asks
  for the mobile number, POSTs `connect` and opens the AA's approval URL through the Capacitor
  `Browser` plugin or `window.open`; Sync now adopts the fresh `/api/money` with `adoptServerMoney`). The split took the boot chunk from 551,884 B to
  447,141 B raw (170.4 → 137.8 kB gzip). Don't add a static `from './money.js'` import here —
  import from `money-core.js`, or reach the screen's code through `import()`. On Vite DEV the
  self-check block at the bottom imports `money.js` so its `_demo()` still runs at boot.
  Adding a lazy screen? Nothing to do in `vite.config.js`: lazy chunks are precached on purpose
  (no `globIgnores`), so the shell and its chunks version together — see the `workbox` comment there.
- **`connectWebSocket()` imports @stomp/stompjs dynamically** and gives it a `brokerURL` on the native
  WebSocket: `(API_BASE || location.origin)` with `http` -> `ws`, + `/ws` (the backend's plain, non-SockJS
  endpoint; absolute API_BASE in the Capacitor app). sockjs-client and its `global` shim are gone (they
  added an unload listener that kept every page out of the bf-cache). Nothing awaits it. `wsConnecting` guards the await
  window, and it re-checks `state.user`/`stomp` after the import in case you logged out meanwhile.
  `beforeConnect` re-reads `loadToken()` before every (re)connect and deactivates when there is
  none — the token used to be captured once, so a rotated session retried a dead one forever.
  The frame handler fans two things out as window events: `kind: 'family_changed'` (a transient
  frame from `FamilyEvents`, never a bell card) → `gb:family-changed`; any `mentorship_*` /
  `system` push → `gb:circle-changed`. family.js / circle.js listen and refetch while mounted.
- **Boot is two waves: `loadData()` then `loadSecondaryData()`.** All twelve calls used to sit in one
  `Promise.all` behind a full-screen splash, so the slowest gated first paint — including `/api/money`
  (a blob up to 512 kB) and `/api/daily-logs?days=60`, neither of which Home draws. `/api/weekly-review`
  was worse: awaited *after* that Promise.all, a whole extra round trip in series.
  Wave 1 is the five calls Home can't paint without (tasks, habits, score, water, reminders); wave 2
  is the other seven in parallel. What wave 2 failed to get is kept as `state.loadFailed` (a Set of the toast's labels: 'money', 'goals', ...) so a screen can show an error in place of its empty state; Money does (`loadFailed` / `onRetryLoad` props). `/api/quotes/today` is the odd one out — `loadQuote()` fires it
  un-awaited *beside* wave 1, because wave 2 doesn't begin until wave 1 has fully landed and the
  quote is the one thing on the loading screen that isn't a grey box. Anything else the placeholder
  starts showing belongs there too, not in wave 2. Safe only because every `state` field has a cache-backed or empty
  default — first paint shows cached values and corrects itself.
  **While wave 1 is in flight only the CONTENT COLUMN waits**: `render()` paints the real shell
  (header, nav — neither needs the API) and puts `loadingContent()` in `.gb-scroll`.
  **A placeholder must not describe a screen that doesn't exist**: `loadingContent()` returns
  `mentorSkeleton()` (chat bubbles + a composer bar) on the Buddy screen, and everywhere else the
  quote card ALONE — `.gb-boot-quote`, no grey rows. Bubbles, not cards, because a boot on
  `#/mentor` otherwise looked like Home had loaded and then rearranged completely; and no rows at
  all on Home because the three identical grey cards promised a shape Home never takes (a score
  ring, a brief, a mini calendar), which on a throttled link read as stuck rather than loading.
  `screenSkeleton()` still backs `lazyScreen()`, where grey rows are honest — that one waits on a
  chunk for a screen already on display.
  **`SELF_LOADING_SCREENS` (`family`, `circle`) skip the boot screen entirely**: they fetch through
  their own `api` callbacks and paint their own loading state, so refreshing on `#/family` used to
  mean quote card → family skeleton → family, two placeholders deep, with wave 1 gating a screen
  that reads none of it. `loadData()` leaves `state.loading` false for them and — crucially — skips
  its closing `render()` while you're still on one, because that render would rebuild the subtree
  and restart the screen's own fetch. Membership requires BOTH properties; mentor has the api
  callbacks but no loading paint, so it stays on `mentorSkeleton()`. That replaced a
  full-screen splash which threw the whole app away, so everything appeared at once when the fetch
  landed. It also hid a worse bug: `tasks`/`habits`/`goals` are NOT cache-backed, so a `[]` first
  paint flashed each list screen's "nothing here yet" empty state. Don't render a screen off wave-1
  state before `state.loading` clears. Measured on a throttled link,
  Home went from 1448 ms to 900 ms.
  Two ordering constraints in wave 2: `recordTrendsToday()` reads `state.food`, and `state.achReady`
  must stay last so achievements never fire on partial data. Wave 2 never throws into the UI — a
  failure leaves Home on wave-1 data instead of replacing it with a crash, and names what didn't
  load in one error toast with Retry (not when offline, not on 401). It also skips its final
  `render()` if `state.screen` has changed since it started, so it can't rebuild a screen that owns
  its own subtree out from under the user.
- **All fetches go through `api()`**. Don't add a bare `fetch` — you'd lose auth headers and
  the 401 → `handleAuthExpired` path.
- **Adding a screen:** register in `SCREENS`; if it needs a nav slot, also `NAV_CATALOG` in
  `gb-kit.js`. Gate it with `screenEnabled` if it's a toggleable feature.
- **Toasts: errors last, the stack holds, and the stack is not a live region.** An error stays
  `errorToastMs` (6–12s, by length) whatever shorter time the call site passed; hovering, tapping or
  focusing the stack holds every timer (`holdToasts`). Screen readers hear toasts through
  `announce()`'s two persistent regions (`#gb-sr-alert` assertive for errors, `#gb-sr-status`),
  because `render()` rebuilds the stack. Offline: the banner is the only status message —
  `handleOffline` toasts nothing, a `NO_CONNECTION` error while offline is reworded to what happened
  to the action (`OFFLINE_ACTION`), and `handleOnline` clears both before "Back online". On a phone the
  stack is centred, and an open dialog moves it to the top (`body:has(.gb-modal-overlay.is-open)` in `app.css`).
- **Habit rows show only rest-day + check.** The name/streak is a `.gb-row-open` button that opens
  `openHabitForm`, whose `danger` action is Delete, restyled after `openModal` into a quiet ghost
  text button in danger colour (a full red bar took a third of a phone screen). Editing shows
  `habitHistoryPanel`: the grid starts at the habit's first week (3 to 12 weeks, from `since`), and a
  done day's popover names what was logged ("Logged 7,300 steps", `metricSummary` over the row's
  `value` / `durationMin` — today's from the habit until the history rows carry them) and leads with
  Save note, Un-tick secondary. `openMeasuredCheckin`'s placeholders read "Last time N" when there
  is a last value, for every metric.
- **`toast` is late-bound** via `scripts/toast.js` — app.js calls `registerToast()` at boot so screen
  modules can fire toasts without importing app.js (cycle). `toast.action(msg, label, run)` is the
  one-button toast (Family's shopping "Undo").
- **Deletes are undoable, not confirmed (`deferDelete`, queue in `scripts/undo-queue.js`).** The item
  leaves state at once (`listSlot` / `summarySlot` remove + restore-at-index), a `pushToast(msg, 'info',
  Infinity, {Undo}, {onGone})` toast offers Undo for `UNDO_MS` (6 s), and `commit` (the real DELETE, via
  api() and, offline, the outbox) runs when the window passes. The queue's timer pauses with
  `holdToasts` / `releaseToasts`; closing the toast or pushing it off the 4-toast stack (`onGone`)
  commits at once; Undo / settle dismiss it `quiet`. Undo toasts never collapse by message.
  `visibilitychange` hidden, `pagehide` and `logout()` call `undoQueue.flush()` (requests leave
  synchronously, before the token goes); `handleAuthExpired` `clear()`s it. `render()` and
  `overlayOutbox()` call `undoQueue.reapply()` so a list reloaded mid-window keeps the item hidden. A
  failed commit restores the item and toasts its `errorText`. Confirms stay only where undo is
  impossible or not ours: account deletion, family / circle leave + delete, removing a member,
  mentorship, Notes' delete forever, clearing Buddy chat, shared posts and menus, Money.
- Some screens (money, family, mentor, circle) repaint their own subtree; calling `render()` for them
  is wasteful and can drop their local view state.
- **Banners in `.gb-scroll` render on EVERY screen.** `offlineBanner()` earns that; the weekly
  review nudge does not, and `weeklyReviewNudge()` gates on `state.screen === 'home'` itself. It
  used to sit above all twelve screens, including the Buddy chat, where it stole a row from the
  message list and read as part of the conversation. Keep a new banner's "where" beside its "when",
  not at the call site in `render()`. It also gates on `!state.loading` — its answer depends on
  `state.trends`, which isn't there yet mid-boot (next rule).
- **Only cookie-eligible keys are readable synchronously at module load.** `CacheStorage` seeds its
  in-memory map from cookies, and `cookieEligible()` is a short allowlist (token, session, theme,
  premium, textScale, apiBase; achSeen left it for ui_prefs, see `checkAchievements`). The session
  cookie is a slim projection (`cookieValue`: no email, phone, body, diet or token copy), so at
  module init `state.user` lacks those fields; the `init().then()` block fills them in from the
  Cache API copy. Everything else — quote, trends, money, wellness — lives in
  the Cache API and arrives when `CacheStorage.init()` resolves. A `loadFooCache()` called at module
  init therefore always returns null; re-read it in the `init().then()` block at the bottom of the
  file, which then `render()`s. The quote-of-day cache sat unused for exactly this reason, so every
  boot showed the generic "Do one small thing today." until the network answered.
- **`syncUserSession(user)` is the only way a signed-in user may reach `state`.** It is where
  `hydrateUiPrefs()` runs, which mirrors the account's server-side theme / text scale / premium
  skin / onboarding flag into the local cache keys the views read synchronously. Sign-in, OTP
  verify, password reset and change-password each used to do `state.user = user; saveSession(...)`
  instead, so a fresh device painted Home in this device's defaults and only snapped to the user's
  real skin when something happened to call `/api/auth/me` (which only `toggleTask`/`toggleHabit`
  do). A token on the payload wins over the stored one — at sign-in nothing is stored yet, and a
  password change has just revoked what is.
- **The premium skin is CSS-only.** `togglePremium` flips `data-premium` on `<html>` and nothing
  else branches on `state.premium` — keep it that way; the whole look lives in `styles/premium.css`.
  That file is **loaded on demand** (`loadPremiumCss()`, a dynamic CSS import, precached): the
  attribute only turns `'on'` once the rules are in, the toggle fetches before its view transition,
  and at boot `applyPremium(on, true)` sets `'loading'`, which hides `#root` (app.css) so a reload
  with premium on never paints a classic frame. Offline and never cached: falls back to `'off'`.
  Even the header seedling ships in the markup on every screen and is shown by CSS. The one
  exception is `shakeAuthCard()`, which gates its haptic buzz on it.
- **`toggleTask` / `toggleHabit` paint before they fetch.** They flip `done` in `state`, recompute
  the ring with `optimisticScore()` and `render()` immediately, then reconcile with the server's
  version; a failure flips just that row back (not the whole array, which undid any other row
  ticked meanwhile), and once the toggle itself has succeeded a failed score refresh no longer
  reverts it. `togglesInFlight` ignores a second tap on a row whose toggle is still in flight —
  two `/toggle` PATCHes raced and the last response won. The round trip is two calls deep
  (toggle, then `/api/score/today` and `/api/auth/me` together under `Promise.all`), which is why
  awaiting it made the checkbox feel broken. `score()` prefers `state.score` when it is non-zero, so a local tick alone does NOT move
  the ring — that is what `optimisticScore()` is for. Don't re-add an `await` before the paint.
  The **confirming** `render()` is gated on `toggleSignature()` changing, because `render()`
  replaces the whole app DOM: when the server just agrees with the optimistic paint, repainting
  was visible a second after the tap as icons re-hydrating and the tick animation restarting.
  The signature is only what's on screen (score, level, ticks, pills, sub-lines; XP only while the
  profile popover is open) — `doneAt`/`updatedAt` still land in `state` and paint on the next
  render. Widening it back to the whole state object brings the flicker back.
- **`resetStaleCompletedTasks` is gone — don't bring it back.** It un-ticked, on every boot, any
  task completed before today, which is why a task you finished yesterday reappeared this morning
  looking like you never did it. The day boundary belongs to the server now:
  `TaskMidnightSweep` soft-deletes completed tasks at the user's own local midnight, so they
  simply aren't in `/api/tasks` any more. A client-side reset on top of that would resurrect
  whatever the sweep hadn't reached yet.
- **Quick add writes one clear read at once, with Undo; it previews the rest.** The sheet puts the
  line first and focuses it. A **single** model read (not `fallback`, nothing skipped, not unknown or
  unticked, not a control) is applied straight from `quickAddBox` and toasted as "Logged: <row>"
  with Undo (`announceQuickAdd`); two or more, a fallback read, or an unclear row get the preview.
  `applyIntent` answers each write with its undo (task, habit tick/new, goal, water, food, sleep and
  mood when the day already had one, expense, income, note (deleted for good), reminder), `true` when
  it can't be undone; `undoAll` offers Undo only when every part can be taken back, else a lone
  first sleep / mood offers Edit. `settleIntent` (in `parseQuickAdd`) keeps what the words said: the
  server's default medium energy is dropped unless stated, a one-off reminder at an hour gone today
  moves to tomorrow (EXS-5), a task title's "tomorrow 5pm" becomes `dueAt` (`parseWhen`, dates.js).
  "Slept 7h" merges into the day's night (`quickSleepPayload` → `sleepFromHours`, nudges.js: the
  logged or usual wake anchors it; the row says "replaces 11:00 PM to 6:30 AM"). A handler's own
  refusal is repeated by text (`lastError`) so toasts dedupe to one.
  `parseQuickAdd` reads the sentence and writes nothing (it sends `today` and `now` as one pair in the account's zone: `todayKey()` + `accountNowHHMM()`, which the .ics import's `now` uses too);
  **`runQuickAdd(text, beforeShow, opts)`** is the one caller-facing entry (`opts`: `preview`, `onLogged`, `onCancel`, `example`) (parse → toast if nothing read, else close the caller via `beforeShow` and preview, or apply a controls-only sentence) — `quickAddBox` (the add sheet and Home) and the command palette all go through it; don't inline it again;
  (**Starter packs** reuse that preview: `openStarterPacks` wraps `starterPicker(mod)` (`{ body, apply, picked }`, also first-run step 1) = goal chips over a live checkbox list from
  `planStarter` (starter-packs.js), `starterRow` words each row, `applyStarter` writes habits through
  `createHabit`, reminders and goals straight to the API (no per-row toast), water through
  `updateWaterGoal`, budgets in one `saveMoney`, then `loadData()`.)
  `openQuickAddPreview` lists each intent in plain words with a checkbox; `applyQuickAdd` runs only
  what is still ticked and returns `[{it, ref}]` (ref = the undo); the toast says where it went
  (`loggedToLine`: "Logged to Money and Food.") with Undo for all of it (`undoAll`). The preview says "Log
  this?" / "Log it" for one row, its primary is disabled while nothing is ticked and starts focused
  (`[autofocus]`, not the sheet, which drew a ring round the whole dialog); a foreign amount with no
  rate gets an inline "Set a $ rate: 1 $ = ₹ [ ] Set" (`rateRow`) that writes `settings.fx` through
  `saveMoney`, re-reads the row converted and ticks it. Money rows name the account they'll move
  ("· Cash", `quickMoney`'s `accountId`), and `addQuickExpense` falls back to the user's fixed
  default tag (`quickCategory`, quick-add.js) before Others. The can't-read-that toast uses the same
  feature-aware example as the placeholder (no "spent 200" with Money off). `parseQuickAdd`
  strips emoji from every string the model sent (`stripEmoji`), drops the model's `note` (written
  in the past tense over a preview nothing has been logged from), and lists intents a switched-off
  feature dropped (`skippedLine`: "Money Buddy is off, so the expense was skipped.") in the
  preview's sub. Expense / income / food / sleep may carry `date` (user-local YYYY-MM-DD; the row
  says "yesterday" or "9 Oct" when it isn't today, `withDay`); expense / income may carry an ISO
  `currency`: converted when the user set a rate, else the row reads "$12 (no rate set)" and starts
  unticked (`d.unticked`). Amounts use Money's `fmtIn` in the home currency; a sleep row shows a
  quality only when one was given; a mood intent sends no energy it didn't name. **Quick taps save
  only what was given:** `saveSleepEntry` keeps the day's own quality or sends null (Home's "Yes"
  on last night's guess used to save "okay"/last night's), `saveMoodEntry` likewise for stress and
  energy, and `sleepFromHours` passes a missing quality as null (or the logged night's). (The backend still defaults
  a null to "okay"/"normal" in `WellnessService` — that half is the server's.) `limited: true`
  (the AI budget is spent; the server read it with its patterns) is a success: the preview's sub
  says "Read without AI this time". It used to parse and apply in one call, so a single misread — "spent 200 on
  lunch" landing as 200 ml of water — wrote itself into a tracker with no way to see it coming or
  take it back. A habit name it can't match renders as "No such habit", unchecked and disabled.
  A failed model call comes back `unavailable: true` ("Couldn't reach the assistant"), distinct
  from an empty parse ("try being more specific"). A **reminder** intent previews as every field
  it carries (`reminderSummary`) and is saved through `addReminder`, so the past-day/time refusals hold.
  **It is the one command box.** `applyIntent` covers every type the server returns — logs (task,
  `task_done` via `matchOpenTask`, habit, `habit_new`, goal, water, food via `logFoodEntry`, sleep,
  mood, expense via `addQuickExpense` / income via `addQuickIncome` (both keep paise and book through quick-add.js `quickMoney` / `defaultAccount`: an expense to the last-used account, else the first cash; income to the first bank or wallet), note, reminder) and controls (`focus` sets
  `focusAutoStart`, which timer.js's `autoStart` prop starts — `startFocusOn(link, true)` from a task row sets it too; `open` → `setScreen` /
  `openProfileSettings`; `setting` → `setThemeChoice` / `updateWaterGoal`). Controls run last, and a
  sentence made only of controls (`CONTROL_INTENTS`) skips the preview. `INTENT_FEATURE` drops an
  intent whose tracker is off. A `fallback` answer (no model / model down, read by the server's
  regexes) still previews, under "Read without the assistant".
- **Voice input is one helper, `listenOnce(btn, lang)`** (Web Speech API in a browser, the native
  SpeechRecognition plugin in the Capacitor app; a second tap stops; it says why when it can't). Used
  by Quick add's mic, and by **`captureReminder`** — listen, then Quick add's parser — behind the mic
  beside the reminder text in the calendar form (`setVoiceReminder`) and Settings → Reminders.
  Speaking fills **every** field it named for a check before Add; nothing is saved by the mic. With
  no assistant (no key, or down) the words alone go in, and a toast says so. Language: `speechLang()`
  = `ui_prefs.qaLang` (Quick add's picker saves it there, nowhere else), else the device's language matched
  against `VOICE_LANGS` — the one default both mics use.
- **Pull to refresh is hand-rolled** (`initPullToRefresh`). A WebView gives you none, and the
  app had none — swiping down at the top of a screen did nothing. Listeners sit on `document`, not on
  `.gb-scroll`, because `render()` replaces that element and would throw a listener on it away. A drag
  is only claimed when it starts at `scrollTop === 0` and is more vertical than horizontal, so normal
  scrolling and the calendar's side-swipes are untouched; past 72px of (resisted) pull it calls
  `loadData()`. Skipped while a dialog is open. Indicator is `#gb-ptr`, styled in `app.css`.
  Only `touchstart` is always on (passive); the non-passive `touchmove` is attached for a touch that
  began at the top and removed as soon as the drag isn't a downward pull — a permanent non-passive
  `touchmove` on `document` made every scroll on every screen wait on the main thread.
- **`loadData()` after the first load is a refresh** (`loadedFor`, reset on sign-out): back online,
  pull to refresh and Quick add keep the screen up and repaint it in place; a failed call there is a
  toast. Only the first load shows the loading card and can end on the crash card — except **in the
  phone app** with no response at all (`session.js` `bootFromSnapshot`): there is no service worker,
  so wave 1 (+ goals) is kept per account as `gb.boot.<uid>` (`saveBootSnapshot`, app only) and
  `paintBootSnapshot` paints it under the offline banner (a toast when the device thinks it is
  online), counted as loaded so 'online' refreshes in place. The web gets the same from `gb-api-get`.
- **The offline outbox (`scripts/outbox.js`, block beside `flushWaterQueue`).** Write-ahead: `createTask`,
  `toggleTask`, `updateTask`, `deleteTask`, `plainToggleHabit`, one-off `addReminder` go through
  `sendAhead(op, send)`, which puts the op in the outbox marked `live` BEFORE the request (a page
  that unloads mid-request replays it; `outbox.reviveLive()` once per account per page load in
  wave 1) and drops it on an answer, or re-queues it through `queueWrite` and rethrows with
  `err.queued` on no response. `quickAddWater` does the same with a `live` glass in the water
  queue. `createTask` returns `'queued'`, so callers skip their own "Task added." `armOutboxRetry()`
  retries on a timer (30 s doubling to 5 min) while anything waits, and visibilitychange flushes
  (`flushQueued`). These writes keep their
  optimistic paint when `api()` fails with **no response** (`networkError`: no status, or
  `!navigator.onLine` — a 5xx still rolls back and toasts; both it and `offlineError` live in app-logic.js
  and are false for a `sessionEndedError`, which has no status: queued, A's write replayed under B's token;
  `postWellness`, `quickAddWater` and `persistMoney` return early on one too): `toggleTask`, `createTask`,
  `deleteTask`, `plainToggleHabit`, `addReminder` (one-offs only — a series waits for the server),
  `deleteReminder` (`scope=all` only), and Notes' `onCreate` (text only — no `<img>`, no cover).
  Sleep and mood (`saveSleepEntry` / `saveMoodEntry` → `postWellness`) queue on a 5xx too (Render
  waking): both are upserts by date, so a replay is safe; a 4xx puts the day back and toasts.
  loadSecondaryData lays queued ones over the server's logs (`overlayQueuedWellness`, app-logic.js; the queue as it was when the logs were requested *and* as it is now, since loadData's `flushOutbox` runs alongside and can send one in between) —
  they used to say "saved locally" and be wiped by the next load. `plainToggleHabit` queues the tap
  (instead of a live `/toggle`) while a check-in for that habit and day is still queued, so the pair
  cancels rather than flipping the server the wrong way. A task or reminder made offline has a `tmp-`
  id: `updateTask` / `patchTaskNow` / `toggleReminderDone` / `snoozeReminder` / `editReminder` send
  `realId(id)` and, while it is still temporary, say `STILL_SYNCING` (`liveId`) instead of a 400.
  Each calls `queueWrite(op)` (enqueue + the Money/water wording `SAVED_ON_PHONE`, nothing for a
  cancelled pair) into the instance `outbox` (CacheStorage `gb.outbox.<uid>`). Creates get a
  `tmp-…` id; anything touching a temp id goes straight to the outbox even online, and `realId(id)`
  / `outboxIds` map a temp id to the server's once its POST lands. A habit tick is queued as a
  **dated** `POST /checkin {date, done}`, never `/toggle` — replayed tomorrow, a toggle ticks the
  wrong day. `overlayOutbox()` re-applies what's queued over lists just read (loadData wave 1, the
  post-flush refetch); `queuedNotes()` leads Notes' `onList`. `flushOutbox()` runs after wave 1 and
  from `handleOnline` (after `loadData()`, so its refetch can't share wave 1's in-flight GET),
  toasts drops (4xx) and conflicts (409) separately, then `refreshOutboxStores(kinds)` refetches
  tasks / habits / reminders + score + `/me` and renders (not on screens that own their subtree, nor
  Notes). `outboxChip()` — "N changes waiting to sync" — sits in `profileDropdown()`;
  `paintOutboxChip()` repaints just the profile slot. Each op's `idemKey` goes out as
  `Idempotency-Key`, so a POST whose answer was lost is answered from the server's replay cache, not
  run twice (CODEMAP `common/`). The task / reminder / note writes mint that key **per tap**, send it
  on the live request too and pass it to `queueWrite` (as water and Money do): the live attempt and
  its replay are one request to the server. `queueWrite` and `flushOutbox` are async and await
  `CacheStorage.ready()`, as does loadData before `overlayOutbox()`: until the Cache API has
  hydrated, the queue reads as empty and an enqueue would overwrite the persisted one. The water
  queue (`<money key>.water`) does the same in loadData, `flushWaterQueue` and the offline store. ponytail: a temp note can't be edited until it syncs.
- **`render()` keeps focus and scroll.** Same screen: focus goes back to the same control
  (`focusLocator` / `refocus` in `a11y.js`: id, else a data-* key, else child position), and a11y.js
  does the same when a dialog closes over a re-rendered screen. A real screen change focuses
  `#gb-main`. Each screen's scroll is filed in `scrollByScreen` when you leave and restored when you
  come back. `tweenFromLast()` starts the score ring, water fill and goal bars from their last
  value so their CSS transition plays instead of jumping (`TWEENED` lists them): the old value
  paints one frame and the new one is set two rAFs later, with no forced layout. A snapshot at the
  top restores nothing (no `scrollHeight` read).
- **A dynamic import that 404s reloads the page once** (`isStaleChunkError` + `CHUNK_RELOAD_KEY`). A
  deploy renames every hashed chunk, so an already-open tab asks for a name the server no longer has
  and `import('./circle.js')` rejects — which is why Circle and Family "sometimes" refused to open and
  were fine after a manual reload. The guard flag is cleared when a chunk **loads**, never on boot:
  clearing it on boot wiped the guard on the way back up and a genuinely missing chunk reloaded
  forever. Second failure lands on the crash card with its retry button. Settings (`openProfileSettings`) and the habit dialogs (`openHabitForm` / `openFreezeCalendar`) are lazy chunks too and go through the same `reloadIfStaleChunk(err)` before their toast.
- **Insights history loads when Report opens, and once per session for Home.** `loadInsightHistory()` (called from
  the `report` entry in `SCREENS`, and from the end of `loadSecondaryData` while `state.insightHistory` is still null, so Home's Outlook ranks the same top insight on a cold start — it renders Home when it lands; `setFeature` clears the throttle and re-reads it, as the Outlook stayed empty after Water was switched off until a reload; throttled to once per ten minutes — stamped only when some part
  came back, one fetch in flight at a time via `insightReq`, which sign-out clears so a late reply
  can't land on the next account) fetches focus sessions,
  finished tasks, water times, two days of score parts, every daily habit's history in one `GET /api/habits/history?days=60` (`{habitId: {since, days}}`; a 404/405 from an older server falls back to one `/{id}/history` call per habit) and a year of
  daily logs (`year`, `/api/daily-logs?days=366`, for Report's pixels and records — boot loads 60) into
  `state.insightHistory`, then `repaintReport()`s — which the 7/30 toggle uses too: it swaps only
  the Report sections whose markup changed and holds the view on the first unchanged one. `loadWaterUsualHours()` runs after wave 1 when
  the water nudge or the Water feature is on; `state.waterUsualHours` feeds `reSyncDeviceAlarms` (nudge on) and Home's
  `waterUsualHours` prop (the one-thing card nudges water only for people who log it); Home re-renders only when it changed, and only once wave 2 has landed (`achReady`): loadSecondaryData waits up to 1.5 s for boot's request (`waterHoursLoad`) so it lands in wave 2's own repaint. `flushWaterQueue` repaints only when it had glasses to send. Both keep boot at perf.e2e's 6 `#root` paints.
- **`reSyncDeviceAlarms()` after every change to its four inputs.** In the app, timed reminders,
  the water nudge and habit reminders are on-device alarms (`syncDeviceAlarms` in `push.js`)
  because the server can only deliver to a Web Push subscription the WebView can't register. The
  inputs are `state.reminders`, `ui_prefs.water`, `state.habits` and `ui_prefs.notifySound` — the
  chime rides on each queued notification, so changing it has to rebuild the queue too. Cancelled
  and rebuilt whole, so anything that changed without a re-sync keeps ringing with the old list or
  the old sound. Wired at: boot, reminder add, reminder delete (inside `repaint()`, which the
  rollback also calls), habit add, habit delete, habit check-in (both `plainToggleHabit` — success
  and rollback — and the measured check-in dialog in `openMeasuredCheckin`, so a habit just marked
  done stops ringing today's alarm), the moment notification permission is granted, every
  water-setting change, and every sound change.
- **`buddyReact(mood)` is hooked to meaning, not to convenience.** The nod fires from
  `toggleTask` / `toggleHabit`, and only on the way to done — un-ticking is a correction, not an
  achievement. The head-shake fires from `pushToast` for errors only. Hooking the nod to every
  success toast (the first attempt) made it celebrate "Changes saved" and the skin toggle, which
  is feedback about nothing. Don't widen it back for coverage's sake.
- **An effect for a change made in a dialog goes through `landSoon(selector)` / `removeSoon(selector, drop)`**, never `landed()` straight from the save handler. Every dialog re-renders the screen as it closes (`afterPrimary: render`) and takes 180 ms to go, so an effect played at once animates a row under the scrim that is about to be replaced. `removeSoon` also defers the state change, so the row is still there to leave. Rows carry `data-task-id` / `data-food-id`; note cards `data-id`.
- **`shakeRefusal(el)` belongs to the whole UI, not the login page**, and not to the premium skin
  either (`.gb-shake` lives in `styles/app.css`). Whatever surface refused the user is what shakes:
  the offending auth input, the sign-in card when the failure names no field, the modal sheet when
  `openModal`'s `onPrimary` throws. One refusal, one gesture — pass the element, don't add a second
  animation.
- **An auth error belongs under its field, not only in a toast.** `state.errorField` names the input
  (`'email'`, `'password'`, `'name'`, `'otp'`); `field(label, input, key)` marks that input
  `.is-invalid` and prints the message under it, and `authShell` falls back to the card-level line
  only when no field owns the error. Both the client-side checks (`authFail`) and server refusals
  (`runAuth(action, errField)`) route through it — a `runAuth` without an `errField` is for failures
  that are nobody's field, like a dropped connection, and stays a toast.
- **Every hidden password has a reveal** (`passwordField`), reachable by Tab (it was `tabindex=-1`, so keyboard users could not check what they typed), and whether it is revealed lives on the
  input's own `type` — never a closure flag — so `renderAuth` restoring the type after an error
  restores the eye with it. Reset carries a confirm field (`errorField` key `'confirm'`); sign-up
  does not — the eye covers a typo, and reset covers a forgotten one.
- **The 6-digit code is six boxes over one real input** (`otpBoxes`). Six real inputs would mean
  hand-rolling focus hops, paste-splitting, backspace-into-the-previous-box and the numeric
  keyboard; the one field keeps all of that (plus `autocomplete=one-time-code`) and just goes
  transparent, with `.gb-otp-box` painted from its value. Anything that writes the value from
  outside must fire an `input` event or the boxes go stale — `renderAuth` does. `field()` therefore
  takes the node to render and finds the `<input>` inside it. `viewVerify` submits on the input that
  makes six digits **only when `e.isTrusted`**: `renderAuth`'s synthetic repaint after a refusal
  would otherwise resend the wrong code in a loop; `submit` returns while `state.loading`, so a tap on
  Verify during the auto-submit is the same request. The WhatsApp number verification in
  Settings → Alerts uses the same helper; it drives `.is-busy` itself (`otpBoxes(input, busy)`)
  because that flow has no `state.loading`.
- **Re-render auth screens with `renderAuth()`, never bare `render()`.** The views build their
  inputs fresh on every render, so a plain `render()` throws away whatever the user had typed —
  fail on the password and the email vanishes too. `renderAuth` carries the values across by
  position, which is safe because a refusal never changes which view is on screen.
- **The home greeting is time-aware** (`greetingFor`) and uses `firstName()`. Both are kept short
  on purpose: `.greet-name` clamps to 2 lines at ~134px, so a long greeting + full name clips.
- **Toast entrances are age-driven, not identity-driven.** `render()` rebuilds every toast node, and
  several call sites do `toastSuccess(...); render();` — which replaces the node mid-entrance. So
  `toastStack` compares `Date.now()` to the toast's `at` and resumes the animation with a negative
  `animation-delay`; past `TOAST_IN_MS` it stamps `is-settled` and the animation is dropped. Keep
  `TOAST_IN_MS` in step with `gb-toast-in` in `styles/app.css` (both skins). A dismissed toast
  is held `TOAST_OUT_MS` in `leavingToasts` (rendered `.is-leaving`, `gb-toast-out`) before it
  leaves `state.toasts`; a set, not a class, so a render during the exit keeps it leaving.
- **Settings' tap targets are real 44px** on tabs (`.gb-segnav-btn`) and segments (`.gb-seg`) inside
  `.gb-settings-body`; Layout's up/down arrows sit side by side there (32px, 12px apart, each with a
  44px `::before`); switches keep their 46x26 look over the shared 46x44 `::before`. The water
  reminder window's two time inputs carry aria-labels.
- **There is exactly one Settings modal** (in `settings.js`, see the region map). `openProfileSettings` owns all six tabs — Profile,
  Display, Alerts, Reminders, Layout, Account. The tab bar (`buildSegSlider`) sizes each tab by its
  label and the thumb measures the tab under it (a `ResizeObserver` re-measures); six equal tabs
  cut "Reminders" to "Reminde" on a phone. Each tab and pane name each other (`aria-controls` /
  `role=tabpanel` + `aria-labelledby`) and the bar is a gb-kit `rovingGroup` (arrows, Home/End).
  Section labels are `h3.gb-settings-sec-label` under the dialog's `h2`. **Reminders** is `reminderSettingsPane()`: the default
  lead and snooze length (`ui_prefs.reminderLead` / `snoozeMinutes`, both read by the server), a
  quick add (`reminderQuickAdd(onAdded)`, through `addReminder`, which returns the reminder or null; Enter with no time picked first reads the words through `parseQuickAdd`'s reminder intent for text / day / time / repeat, and saves as typed when that finds nothing or fails offline — `addReminder` queues a one-off offline; the same form is + then Reminder's sheet, `openReminderSheet`, which closes on save), and every reminder
  soonest-first by `nextOccurrence` (`recurrence.js`), with a two-tap delete of the whole series and
  a tap-to-cancel snooze chip. `repaintReminderSettings()` is called by add/delete/snooze and is a
  no-op once the pane leaves the page.
- **Buttons on the phone's notifications**: `armNotificationActions()` (once, after wave 1 of
  `loadData`, so a press that cold-started the app finds its habit / reminder) listens through
  native.js `onLocalNotificationAction`; `handleNotificationAction` routes a press to the in-app
  handlers. A plain **tap** opens push.js `notificationTarget(extra)` — reminder → Calendar on its
  day (`calGoTo`), habit → Habits, water → Home, focus alarm → the timer. Buttons: water → `quickAddWater(WATER_ACTION_ML)`, reminder Snooze → `snoozeReminder`, Done →
  `toggleReminderDone(id, day, true)` (no day = a snoozed ring: nothing), habit Done →
  `plainToggleHabit` today or a dated `/checkin` for the day it rang. `reSyncDeviceAlarms` passes
  `snoozeLabel`. The web's buttons never reach the page: the service worker POSTs a signed ticket.
- **Snooze in the app**: `snoozeReminder(id, minutes, notifId)` / `cancelReminderSnooze(id)`. Offered
  on the toast a reminder raises over the websocket (`pushToast`'s 4th argument, `{label, run}`, is
  a single action button) and on **unread** reminder cards in the bell — a snooze marks its card
  read, so the button going is the receipt. `snoozableReminder` offers it for a reminder this device
  never loaded (made elsewhere since); the server is the one that refuses an untimed one.
  `reSyncDeviceAlarms` passes the default lead to push.js.
- **`openCustomToneDialog()`** — the Tone list's "+ Add your own sound…": record (if `canRecordChime`)
  or pick a file, like Alerts, under the same `CUSTOM_MAX_COUNT` (and the server's). At the cap it
  says so, lists the four as buttons that pick that sound, and links to Settings. Resolves the new
  key or null. It and Alerts' `addCustomSound` share **`uploadNewCustomSound`** (upload; a 4xx drops
  the local copy and toasts, so it can't retry at every sign-in). Only Profile waits for Done; every other tab saves on touch
  (so Cancel does not undo a theme change, by design). Done collects every Profile problem into
  one toast and brings the Profile tab up, focused on the first bad field (the timezone for the
  server's "Unknown timezone"). Alerts holds push, **"Notify me about" People / Money / Habits** (`notifyMuteRows` → `ui_prefs.notifyMute`; off = no web push for it — `PushService` checks — and, for Habits, no device alarms either: `reSyncDeviceAlarms` sends `habits: []`; the bell still records them), **"Keep read notifications for" 7 / 30 / 90 days** (`keepReadPicker` → `ui_prefs.notifyKeepReadDays`, read by the nightly sweep), **"Buddy › Evening reflection"** (switch + time → `ui_prefs.buddyReflection` "HH:MM", absent/null = off; sent by `mentor/ReflectionScheduler`), the notification-sound picker (`segmented` over `CHIMES` from `chime.js`, saved to `ui_prefs.notifySound` and previewed on tap), WhatsApp, the digest and the working week.
- **The user's own sounds (up to `CUSTOM_MAX_COUNT`, now 5: files, or voice recorded in the Alerts tab) live in two places, and the split is deliberate.** The bytes are in this
  device's `CacheStorage`, each sound under its own `gb.notifySound.<id>` behind an index at `gb.notifySounds` of `{id, name, updatedAt, synced}` (`storeCustomChimes` writes bytes only when they changed — one combined list rewrote ~1.6 MB to flip a flag) — that copy is what
  plays, so the picker is instant and works with no connection — *and* on the account via
  `PUT /api/notifications/custom-sounds/{id}` (`uploadCustomChime`; the id is `newSoundId()`'s), which is the only reason a second
  device can find them. A server 4xx on upload (another device filled the last slot) drops the local copy too, or it would retry at every sign-in. Never in `ui_prefs`: a few hundred kB of base64 would ride along with every
  `/api/auth/me`. `pullCustomChime()` runs once per load — from boot once the Cache API has hydrated (a reload with a stored session never reaches `syncUserSession`, so before this an already signed-in device never saw another device's sounds) and from `syncUserSession`; it waits on `customChimesLoaded` so it never merges against an unloaded list. The Alerts list is `.gb-sounds` (the name is the rename button — `renameCustomSound`, local first then PATCH, reverted with a toast if the PATCH fails; its field stops Enter/Escape from reaching the sheet, or Settings closes; two-tap Remove, no stacked confirm modal), the recorder panel `.gb-sound-rec`; the account's list wins for every sound the server has seen (so a delete elsewhere lands here), only bytes this device lacks or holds older are fetched, and a `synced: false` sound is uploaded rather than dropped. **Lock-screen alarms still fall
  back to the phone's own tone** — Android takes a notification's sound from its channel, which
  needs a bundled asset, and a data URL is not one (`soundFile()` in `push.js`). Display and Layout come from `customisePanes()`, Account absorbs
  `securitySection()` plus `shareProgressRow()` (the Privacy switch — writes `shareProgress` to
  ui_prefs, which the *server* reads to decide whether a mentor may open this user's progress). Don't add a second settings surface; the app had three (Settings / Security /
  Customise) and nobody could guess which held what.
- **First-run setup is once per account, decided after wave 1.** `loadData()`'s first load calls
  `maybeStartFirstRun()`: no `ui_prefs.setupDone` and no tasks / habits / reminders /
  `onboardingDone` → `openFirstRunSetup()`. Progress is `ui_prefs.setupStep` (saved on open and every Next, cleared with `setupDone`): an app closed mid-way resumes there (`openFirstRunSetup(resumeAt)`, `SETUP_ORDER`; a run saved on the old notify / features steps lands on the next one offered). One `openOverlay` sheet (`.gb-setup-modal`, CSS in
  app.css "First-run setup") whose steps come from pure `firstRunSteps` (`app-logic.js`), plus main's health step on the phone (`connectHealth`; closing the sheet sets `ui_prefs.healthAsked` there): goal (`starterPicker`, the Home starter-pack picker, so one to three chip
  taps plus "Set it up" leave Home already set up; the button reads "Next" — "Done" when it is the only step — until a chip is on; a sign-out while starter-packs.js loads opens nothing and resets `firstRunOpen`), then timezone (`saveDeviceTimezone`) **only when the device and account zones differ** — signup sends the device zone, so normally it is goal alone, with no "Step 1 of 1" header and no second "You're all set" toast after apply's. No steps at all (no chunk, zones match) marks `setupDone` without a sheet. Push is not a step (`askPushOnce` asks at the first timed save); features are not either — everything is on (opt-out), and Settings › Layout has the switches; nothing reads whether setup ran except `setupDone` itself. An account
  with data is marked `setupDone` silently. Every way out (Done, Skip, Escape, backdrop) goes
  through `onClose`, which saves `setupDone` + `tzAsked`, asks for push if the goal step made timed items, and re-arms the timezone offer — which
  returns early while `setupDone` is unset, so the two never ask the same question twice.
- **Panes mount twice:** once in the `tabDefs` array (for the tab bar) and once as a child of
  `.gb-settings-body`. Miss the second and the tab renders empty — that's how the Display tab was
  dead until Aug 2026. `buildSegSlider` only toggles `display`; it never mounts anything.

