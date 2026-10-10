# scripts/app.js — app shell

The hub: owns all state, routing, rendering, and **every** backend call. No exports (entry module).
Screen modules are leaves it calls into; they get thin `api` wrapper objects, never the state.

## Region map

| Region |
|---|
| imports, date helpers (`todayLabel`, `greetingFor` + its dev self-check, `firstName`, `dateKey`), `loadTheme` (follows the OS until a theme is picked), `syncDeviceTimezone` / `offerDeviceTimezone` (asks once per phone zone, `ui_prefs.tzAsked`; `sameZone` treats aliases like Calcutta/Kolkata as equal), quote-of-day cache (`quoteDateStr`, `loadCachedQuote`, `cacheQuote`), toasts (`pushToast`, `toastError`, `toastSuccess`, `dismissToast`) |
| `score()` (+ `optimisticScore()`, the same sum with the server's number ignored), `loadSession`, `loadToken`, `saveSession` |
| wellness store (`emptyWellness`, `loadWellness`, `persistWellness`), goal progress (`loadGoalProgress`, `persistGoalProgress`, `updateGoalProgress` — optimistic; the newest save's failure rolls back and toasts) |
| **money store**: `moneyStorageKey`, `loadMoney`, `cacheMoney`, `saveMoney(next, base)` → `ledgerDiff(base, next)` laid onto the live state with `applyLedgerDiff` → pending queue (`queueLedger`/`flushLedger`, replayed at boot via `overlayPending`) + `putDocIfChanged`; an entry the server refuses (a `rejected` id, or a whole-batch 4xx other than 401/408/409/429) is put back to the server's copy by `rollbackMoneyItems(ids)`, those ids only; `accountRequest` (queued behind ledger writes); UI prefs `saveUiPrefs(patch)` → `PUT /api/auth/ui-prefs`, `hydrateUiPrefs` |
| streak freeze: `emptyStreakFreeze`, `loadStreakFreeze`, `reconcileStreakFreeze`, `effectiveStreak`, `habitFreezeState`, `freezeTokensLeft`, `protectStreak`, `declineStreakBreak`, `toggleRestDay` (both go through `freezeWrite`: optimistic habit + token count, one per habit in flight, exact rollback). Backend owns the tokens; this only reads fields + calls protect/unprotect. Achievements: `achievementProps`, `checkAchievements` (fires `celebrate()` on first unlock) |
| local trends: `emptyTrends`, `loadTrends`, `persistTrends`, `recordTrendsToday` |
| `purgeUserCache` (logout only: removes every `gb.*.<uid>` key, keeps a non-empty money pending queue), `clearSession`, `syncUserSession`, **`api(path, options)` / `apiFetch`** — the single network chokepoint; attaches the bearer token and, in the Capacitor app, the `X-GB-Device` label from `native.js` so the signed-in-devices list can name the handset — `handleAuthExpired` |
| `mapTask` (keeps the stored `priority`; overdue is a separate `overdue` flag, never a priority override, or the edit dialog writes it back), `formatTaskTime`, `cacheFoodSummary`, `loadCalendarFoodForDate`, in-place repaints (`rerenderCalendarSideIfActive` — coalesced to one repaint per tick, deferred while a field in the panel has focus, keeps its height while the day's food loads, puts the caret back in the reminder text after an add — `rerenderHomeMiniCalendarIfActive` (coalesced the same way; answers "is there a card?" synchronously, rebuilds it in a microtask), `updateCalendarDaySelection`) |
| **`loadData()`** (boot fetch fan-out), `loadQuote()`, `connectWebSocket` / `disconnectWebSocket` |
| mutations: `toggleTask`, `toggleHabit`, `refreshScore`, `refreshScoreLater` (create/update dialogs close on the write; the ring lands after), `refreshCurrentUser`, `createTask`, `updateTask`, `patchTaskNow` / `pauseTask` (optimistic one-field task change), `createHabit`, `updateHabit`, `createGoal` (places the POSTed goal, no reload), `toggleGoal` (optimistic, reconciles from the PATCH answer), goal actions CRUD, `deleteHabit`, `quickAddWater` (optimistic; `pendingWater` taps are laid over each server answer, the same amount twice inside 600ms is dropped), `updateWaterGoal`, `logFoodEntry`, `saveSleepEntry`, `saveMoodEntry`, `addQuickExpense`, **`runQuickAdd(text)`**, `rememberPhotoFood`, `showFoodLoader(name)` (the full-screen "Estimating calories" over a food save, CSS in app.css "Food loader"; shown after 200ms so a fast save does not flash it) |
| modals: `openSleepSchedule`, `openMoodCheckin`, `openDailyPlan`, `openAddFood`, `addSuggestedReminder`, `deleteWaterEntry`, `deleteFoodEntry` (both `confirmDelete` first; food plays `removeSoon`). `logFoodEntry` throws, so a failed save keeps Log food open |
| notifications (`refreshNotifications`, `markNotificationRead`, `respondMentorshipRequest`, `unreadNotifs`), header popovers (`toggleNotifOpen`, `toggleProfileOpen`, `toggleMoreOpen`, `profileDropdown`), routing (`screenFromHash`, `setScreen`, `returnToScreen` + `landAfterSignIn` — a signed-out deep link or the screen a session expired on is where the next sign-in lands; `render()` sets `document.title` per screen), **`applyTheme(theme)`** — the only writer of `data-theme`, because the native status bar has to be repainted alongside it — `toggleTheme`, `togglePremium` |
| profile + settings (biggest block): `saveProfileDetails`, `CountryPhoneInput`, `buildSegSlider`, `customisePanes()` (builds the Display + Layout panes), `securitySection()` (devices + password), **`openProfileSettings(initialTab)`** (the one Settings modal), `getNutritionSuggestion` |
| calendar: `syncSelectedDateToVisibleMonth`, `rerenderCalendarToolbarIfActive`, `rerenderCalendarMonthInPlace`, `calPrevMonth`/`calNextMonth`/`calToday`, `selectDate`, `retryCalendarFoodDate`, `addReminder`, `repaintCalendarGrid`, `deleteReminder` |
| shared UI: `openModal` (now a two-line wrapper over gb-kit's, adding `render()` after a successful primary — the layout itself lives in `gb-kit.js`), `segmented`, `openAddSheet`, `toDateTimeLocal`, `taskForm` (shared by `openAddTask` / `openEditTask`), **task templates** (`openTaskTemplates` from New task's "Add from a template"; named checklists in `ui_prefs.taskTemplates` = `[{id, name, items:[title]}]`, max 20 x 30; `addTemplateTasks` POSTs one task per line with `allSettled`, so a partial failure keeps what saved), `colorPicker`, `openAddHabit` / `openHabitForm(habit)` (one form for new + edit; edit PUTs, sending `''` / `clearReminder` for blanks because PUT reads null as unchanged; a Fitness preset fills the name only when it is empty or still the last preset's), `relativeTime`, `notificationDropdown`, `toastStack` (+ `TOAST_IN_MS`), `confirmDelete` |
| `ScreenHabits`, `featureOn` / `screenEnabled` / `setFeature`, `saveDigestPrefs`, `saveHomeLayout`, `saveNavLayout` |
| **`SCREENS` registry** — screen id → render fn. Start here to find a screen. |
| `captureScrollPosition` / `restoreScrollPosition` |
| auth: `authPost`, `loadAuthDraft`, `setAuthMode`, `authShell` (draws `GARDEN_SVG`, the crest, growing once per load via `gardenGrown`; hides a `SESSION_EXPIRED` error under the notice that already says it), `field`, `renderAuth`, `authFail`, `refuseFocus`, `runAuth`, `shakeRefusal`, `viewSignin`, `viewSignup`, `viewVerify` (OTP), `viewForgot`, `viewReset`, `loginCard` |
| `logout`, `mentorSkeleton` / `loadingContent`, `offlineBanner`, `weeklyReviewNudge` (Home only), `handleOnline`/`handleOffline`, **`render()`**, `installOutsideClickToCloseHeaderPopovers` |

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
  `aria-expanded` (`syncHeaderExpanded`, which `render()` calls too), moves focus into the More sheet
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
- **Six screens are lazy: family, circle, timer, goals, report, mentor.** Each exported only its
  `Screen*` to app.js and nothing else imported it — ~151 KB of source a Home visitor never touches.
  `SCREENS[x].render()` must stay synchronous, so `lazyScreen(loader, build)` returns a skeleton now
  and **`replaceWith`s** the real root when the chunk lands. Replace, not wrap: the desktop width cap
  is `.gb-scroll > .gb-rise:not(.gb-goals):not(.gb-mentor)`, so a wrapper would steal the cap and
  break those two exceptions. It also bails if the placeholder is no longer `isConnected` — a later
  render() made its own, and a stale one must not resurrect itself. A chunk that has loaded once is
  kept in `lazyModules` (keyed by the loader's source text) and later renders build synchronously,
  so a tap on Goals, Report, Timer or Notes no longer flashes the grey placeholder.
  `money.js` **can't** join them yet: Home's Money card (`MoneyHomeCard`) and `normalizeMoney` on
  every load pull all 154 KB in eagerly. Splitting those few exports into a light module is the
  single biggest remaining bundle win.
  Adding a lazy screen? Also add its chunk to `globIgnores` in `vite.config.js`, or the service
  worker will precache it on first visit and undo the point.
- **`connectWebSocket()` imports sockjs-client and @stomp/stompjs dynamically** (~155 KB, 15% of the
  old bundle, for the notification channel alone). Nothing awaits it. `wsConnecting` guards the await
  window, and it re-checks `state.user`/`stomp` after the import in case you logged out meanwhile.
- **Boot is two waves: `loadData()` then `loadSecondaryData()`.** All twelve calls used to sit in one
  `Promise.all` behind a full-screen splash, so the slowest gated first paint — including `/api/money`
  (a blob up to 512 kB) and `/api/daily-logs?days=60`, neither of which Home draws. `/api/weekly-review`
  was worse: awaited *after* that Promise.all, a whole extra round trip in series.
  Wave 1 is the five calls Home can't paint without (tasks, habits, score, water, reminders); wave 2
  is the other seven in parallel. `/api/quotes/today` is the odd one out — `loadQuote()` fires it
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
  failure leaves Home on wave-1 data instead of replacing it with a crash. It also skips its final
  `render()` if `state.screen` has changed since it started, so it can't rebuild a screen that owns
  its own subtree out from under the user.
- **All fetches go through `api()`**. Don't add a bare `fetch` — you'd lose auth headers and
  the 401 → `handleAuthExpired` path.
- **Adding a screen:** register in `SCREENS`; if it needs a nav slot, also `NAV_CATALOG` in
  `gb-kit.js`. Gate it with `screenEnabled` if it's a toggleable feature.
- **`toast` is late-bound** via `scripts/toast.js` — app.js calls `registerToast()` at boot so screen
  modules can fire toasts without importing app.js (cycle).
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
  premium, textScale, apiBase; achSeen left it for ui_prefs, see `checkAchievements`). Everything else — quote, trends, money, wellness — lives in
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
  Even the header seedling ships in the markup on every screen and is shown by CSS. The one
  exception is `shakeAuthCard()`, which gates its haptic buzz on it.
- **`toggleTask` / `toggleHabit` paint before they fetch.** They flip `done` in `state`, recompute
  the ring with `optimisticScore()` and `render()` immediately, then reconcile with the server's
  version; a failure flips just that row back (not the whole array, which undid any other row
  ticked meanwhile), and once the toggle itself has succeeded a failed score refresh no longer
  reverts it. `togglesInFlight` ignores a second tap on a row whose toggle is still in flight —
  two `/toggle` PATCHes raced and the last response won. The round trip is three calls deep
  (toggle → `/api/score/today` → `/api/auth/me`), which is why awaiting it made the checkbox feel
  broken. `score()` prefers `state.score` when it is non-zero, so a local tick alone does NOT move
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
- **Quick add previews before it writes.** `parseQuickAdd` reads the sentence and writes nothing;
  `openQuickAddPreview` lists each intent in plain words with a checkbox; `applyQuickAdd` runs only
  what is still ticked. It used to parse and apply in one call, so a single misread — "spent 200 on
  lunch" landing as 200 ml of water — wrote itself into a tracker with no way to see it coming or
  take it back. A habit name it can't match renders as "No such habit", unchecked and disabled.
  A failed model call comes back `unavailable: true` ("Couldn't reach the assistant"), distinct
  from an empty parse ("try being more specific").
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
  toast. Only the first load shows the loading card and can end on the crash card.
- **`render()` keeps focus and scroll.** Same screen: focus goes back to the same control
  (`focusLocator` / `refocus` in `a11y.js`: id, else a data-* key, else child position), and a11y.js
  does the same when a dialog closes over a re-rendered screen. A real screen change focuses
  `#gb-main`. Each screen's scroll is filed in `scrollByScreen` when you leave and restored when you
  come back. `tweenFromLast()` starts the score ring, water fill and goal bars from their last
  value so their CSS transition plays instead of jumping (`TWEENED` lists them).
- **A dynamic import that 404s reloads the page once** (`isStaleChunkError` + `CHUNK_RELOAD_KEY`). A
  deploy renames every hashed chunk, so an already-open tab asks for a name the server no longer has
  and `import('./circle.js')` rejects — which is why Circle and Family "sometimes" refused to open and
  were fine after a manual reload. The guard flag is cleared when a chunk **loads**, never on boot:
  clearing it on boot wiped the guard on the way back up and a genuinely missing chunk reloaded
  forever. Second failure lands on the crash card with its retry button.
- **Insights history loads when Report opens, not at boot.** `loadInsightHistory()` (called from
  the `report` entry in `SCREENS`, throttled to once per ten minutes) fetches focus sessions,
  finished tasks, water times, two days of score parts, each daily habit's history and a year of
  daily logs (`year`, `/api/daily-logs?days=366`, for Report's pixels and records — boot loads 60) into
  `state.insightHistory`, then `repaintReport()`s — which the 7/30 toggle uses too: it swaps only
  the Report sections whose markup changed and holds the view on the first unchanged one. `loadWaterUsualHours()` runs after boot only when
  the water nudge is on and feeds `state.waterUsualHours` into `reSyncDeviceAlarms`.
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
- **Every hidden password has a reveal** (`passwordField`), and whether it is revealed lives on the
  input's own `type` — never a closure flag — so `renderAuth` restoring the type after an error
  restores the eye with it. Sign-up and reset also carry a confirm field (`errorField` key
  `'confirm'`).
- **The 6-digit code is six boxes over one real input** (`otpBoxes`). Six real inputs would mean
  hand-rolling focus hops, paste-splitting, backspace-into-the-previous-box and the numeric
  keyboard; the one field keeps all of that (plus `autocomplete=one-time-code`) and just goes
  transparent, with `.gb-otp-box` painted from its value. Anything that writes the value from
  outside must fire an `input` event or the boxes go stale — `renderAuth` does. `field()` therefore
  takes the node to render and finds the `<input>` inside it. The WhatsApp number verification in
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
  `TOAST_IN_MS` in step with `gb-toast-in` in `styles/premium.css`.
- **There is exactly one Settings modal.** `openProfileSettings` owns all five tabs — Profile,
  Display, Alerts, Layout, Account. Only Profile waits for Done; every other tab saves on touch
  (so Cancel does not undo a theme change, by design). Done collects every Profile problem into
  one toast and brings the Profile tab up, focused on the first bad field (the timezone for the
  server's "Unknown timezone"). Alerts holds push, the notification-sound picker (`segmented` over `CHIMES` from `chime.js`, saved to `ui_prefs.notifySound` and previewed on tap), WhatsApp, the digest and the working week.
- **The user's own sound lives in two places, and the split is deliberate.** The bytes are in this
  device's `CacheStorage` under `gb.notifySoundFile` (`storeCustomChime`) — that copy is what
  plays, so the picker is instant and works with no connection — *and* on the account via
  `/api/notifications/custom-sound` (`syncCustomChimeUp`), which is the only reason a second
  device can find it. Never in `ui_prefs`: a few hundred kB of base64 would ride along with every
  `/api/auth/me`. `pullCustomChime()` runs from `syncUserSession` and takes the account's copy
  when this device has none or an older `gb.notifySoundFileAt`. **Lock-screen alarms still fall
  back to the phone's own tone** — Android takes a notification's sound from its channel, which
  needs a bundled asset, and a data URL is not one (`soundFile()` in `push.js`). Display and Layout come from `customisePanes()`, Account absorbs
  `securitySection()` plus `shareProgressRow()` (the Privacy switch — writes `shareProgress` to
  ui_prefs, which the *server* reads to decide whether a mentor may open this user's progress). Don't add a second settings surface; the app had three (Settings / Security /
  Customise) and nobody could guess which held what.
- **Panes mount twice:** once in the `tabDefs` array (for the tab bar) and once as a child of
  `.gb-settings-body`. Miss the second and the tab renders empty — that's how the Display tab was
  dead until Aug 2026. `buildSegSlider` only toggles `display`; it never mounts anything.
