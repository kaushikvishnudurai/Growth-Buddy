# scripts/app.js — app shell (6336 lines)

The hub: owns all state, routing, rendering, and **every** backend call. No exports (entry module).
Screen modules are leaves it calls into; they get thin `api` wrapper objects, never the state.

## Region map

| Lines | Region |
|---|---|
| 1–230 | imports, date helpers (`todayLabel`, `greetingFor` + its dev self-check, `firstName`, `dateKey`), `loadTheme`, quote-of-day cache (`quoteDateStr`, `loadCachedQuote`, `cacheQuote`), toasts (`pushToast`, `toastError`, `toastSuccess`, `dismissToast`) |
| 210–250 | `score()`, `loadSession`, `loadToken`, `saveSession` |
| 249–336 | wellness store (`emptyWellness`, `loadWellness`, `persistWellness`), goal progress (`loadGoalProgress`, `persistGoalProgress`, `updateGoalProgress`) |
| 337–412 | **money store**: `moneyStorageKey`, `loadMoney`, `cacheMoney`, `saveMoney(next)`; UI prefs `saveUiPrefs(patch)` → `PUT /api/auth/ui-prefs`, `hydrateUiPrefs` |
| 413–560 | streak freeze: `emptyStreakFreeze`, `loadStreakFreeze`, `reconcileStreakFreeze`, `effectiveStreak`, `habitFreezeState`, `freezeTokensLeft`, `protectStreak`, `declineStreakBreak`, `toggleRestDay`. Backend owns the tokens; this only reads fields + calls protect/unprotect. Achievements: `achievementProps`, `checkAchievements` (fires `celebrate()` on first unlock) |
| 559–625 | local trends: `emptyTrends`, `loadTrends`, `persistTrends`, `recordTrendsToday` |
| 625–740 | `clearSession`, `syncUserSession`, **`api(path, options)` / `apiFetch`** — the single network chokepoint — `handleAuthExpired` |
| 744–935 | `mapTask`, `formatTaskTime`, `cacheFoodSummary`, `loadCalendarFoodForDate`, in-place repaints (`rerenderCalendarSideIfActive`, `rerenderHomeMiniCalendarIfActive`, `updateCalendarDaySelection`) |
| 934–1140 | `resetStaleCompletedTasks`, **`loadData()`** (boot fetch fan-out), `connectWebSocket` / `disconnectWebSocket` |
| 1140–1470 | mutations: `toggleTask`, `toggleHabit`, `refreshScore`, `refreshCurrentUser`, `createTask`, `createHabit`, `createGoal`, goal actions CRUD, `deleteHabit`, `quickAddWater`, `updateWaterGoal`, `logFoodEntry`, `saveSleepEntry`, `saveMoodEntry`, `addQuickExpense`, **`runQuickAdd(text)`**, `rememberPhotoFood` |
| 1481–2010 | modals: `openSleepSchedule`, `openMoodCheckin`, `openDailyPlan`, `openAddFood`, `addSuggestedReminder`, `deleteWaterEntry`, `deleteFoodEntry` |
| 2014–2260 | notifications (`refreshNotifications`, `markNotificationRead`, `respondMentorshipRequest`, `unreadNotifs`), header popovers (`toggleNotifOpen`, `toggleProfileOpen`, `toggleMoreOpen`, `profileDropdown`), routing (`screenFromHash`, `setScreen`), `toggleTheme`, `togglePremium` |

**`screenFromHash` reads `SCREENS` itself** — there is no id list to keep in step. The `SCREEN_IDS`
array that used to live here was missing `report`, so refreshing on Progress or opening any link to
it silently landed on Home. Don't reintroduce a second list.
| 2270–4070 | profile + settings (biggest block): `saveProfileDetails`, `CountryPhoneInput`, `buildSegSlider`, `customisePanes()` (~2541, builds the Display + Layout panes), `securitySection()` (~3108, devices + password), **`openProfileSettings(initialTab)`** (~3229 — the one Settings modal), `getNutritionSuggestion` |
| 4071–4262 | calendar: `syncSelectedDateToVisibleMonth`, `rerenderCalendarToolbarIfActive`, `rerenderCalendarMonthInPlace`, `calPrevMonth`/`calNextMonth`/`calToday`, `selectDate`, `retryCalendarFoodDate`, `addReminder`, `repaintCalendarGrid`, `deleteReminder` |
| 4264–4940 | shared UI: `openModal`, `segmented`, `openAddSheet`, `openAddTask`, `colorPicker`, `openAddHabit`, `relativeTime`, `notificationDropdown`, `toastStack` (+ `TOAST_IN_MS`), `confirmDelete` |
| 4940–5256 | `ScreenHabits`, `featureOn` / `screenEnabled` / `setFeature`, `saveDigestPrefs`, `saveHomeLayout`, `saveNavLayout` |
| **5256–5552** | **`SCREENS` registry** — screen id → render fn. Start here to find a screen. |
| 5552–5575 | `captureScrollPosition` / `restoreScrollPosition` |
| 5576–6100 | auth: `authPost`, `loadAuthDraft`, `setAuthMode`, `authShell`, `field`, `renderAuth`, `authFail`, `refuseFocus`, `runAuth`, `shakeRefusal`, `viewSignin`, `viewSignup`, `viewVerify` (OTP), `viewForgot`, `viewReset`, `loginCard` |
| 6043–6336 | `logout`, `loadingSplash`, `offlineBanner`, `weeklyReviewNudge`, `handleOnline`/`handleOffline`, **`render()`** (~6143), `installOutsideClickToCloseHeaderPopovers` |

## Rules when editing

- **Popover-only state changes call `repaintOverlays()`, never `render()`.** The bell, the account
  menu and the "More" sheet are siblings of the active screen, but `render()` calls `cfg.render()` and
  builds a brand-new screen — so toggling any of them threw away whatever state that screen owned.
  On Family that meant tapping the bell with Pantry open dumped you back on Members; Money, Mentor
  and Circle have the same exposure. `repaintOverlays()` swaps just `#gb-notif-slot`,
  `#gb-profile-slot` and `.gb-nav-wrap`, and falls back to a full render before first paint.
- **`installOutsideClickToCloseHeaderPopovers` tears down the previous listeners** via the
  module-level `popoverCleanup` before attaching new ones. Each call builds fresh closures, so
  without that a bell → avatar → bell sequence left orphaned `mousedown`/`keydown` listeners on
  `document` for the rest of the session.
- **Six screens are lazy: family, circle, timer, goals, report, mentor.** Each exported only its
  `Screen*` to app.js and nothing else imported it — ~151 KB of source a Home visitor never touches.
  `SCREENS[x].render()` must stay synchronous, so `lazyScreen(loader, build)` returns a skeleton now
  and **`replaceWith`s** the real root when the chunk lands. Replace, not wrap: the desktop width cap
  is `.gb-scroll > .gb-rise:not(.gb-goals):not(.gb-mentor)`, so a wrapper would steal the cap and
  break those two exceptions. It also bails if the placeholder is no longer `isConnected` — a later
  render() made its own, and a stale one must not resurrect itself.
  `money.js` **can't** join them yet: Home's Money card (`MoneyHomeCard`) and `normalizeMoney` on
  every load pull all 154 KB in eagerly. Splitting those few exports into a light module is the
  single biggest remaining bundle win.
  Adding a lazy screen? Also add its chunk to `globIgnores` in `vite.config.js`, or the service
  worker will precache it on first visit and undo the point.
- **`connectWebSocket()` imports sockjs-client and @stomp/stompjs dynamically** (~155 KB, 15% of the
  old bundle, for the notification channel alone). Nothing awaits it. `wsConnecting` guards the await
  window, and it re-checks `state.user`/`stomp` after the import in case you logged out meanwhile.
- **Boot is two waves: `loadData()` then `loadSecondaryData()`.** All twelve calls used to sit in one
  `Promise.all` behind the loading splash, so the slowest gated first paint — including `/api/money`
  (a blob up to 512 kB) and `/api/daily-logs?days=60`, neither of which Home draws. `/api/weekly-review`
  was worse: awaited *after* that Promise.all, a whole extra round trip in series.
  Wave 1 is the five calls Home can't paint without (tasks, habits, score, water, reminders); wave 2
  is the other eight in parallel. Safe only because every `state` field has a cache-backed or empty
  default — first paint shows cached values and corrects itself. Measured on a throttled link,
  Home went from 1448 ms to 900 ms.
  Two ordering constraints in wave 2: `recordTrendsToday()` reads `state.food`, and `state.achReady`
  must stay last so achievements never fire on partial data. Wave 2 never throws into the UI — a
  failure leaves Home on wave-1 data instead of replacing it with a crash. It also skips its final
  `render()` if `state.screen` has changed since it started, so it can't rebuild a screen that owns
  its own subtree out from under the user.
- **All fetches go through `api()`** (~646). Don't add a bare `fetch` — you'd lose auth headers and
  the 401 → `handleAuthExpired` path.
- **Adding a screen:** register in `SCREENS` (~5256); if it needs a nav slot, also `NAV_CATALOG` in
  `gb-kit.js`. Gate it with `screenEnabled` if it's a toggleable feature.
- **`toast` is late-bound** via `scripts/toast.js` — app.js calls `registerToast()` at boot so screen
  modules can fire toasts without importing app.js (cycle).
- Some screens (money, family, mentor, circle) repaint their own subtree; calling `render()` for them
  is wasteful and can drop their local view state.
- **The premium skin is CSS-only.** `togglePremium` flips `data-premium` on `<html>` and nothing
  else branches on `state.premium` — keep it that way; the whole look lives in `styles/premium.css`.
  Even the header seedling ships in the markup on every screen and is shown by CSS. The one
  exception is `shakeAuthCard()`, which gates its haptic buzz on it.
- **`buddyReact(mood)` is hooked to meaning, not to convenience.** The nod fires from
  `toggleTask` / `toggleHabit`, and only on the way to done — un-ticking is a correction, not an
  achievement. The head-shake fires from `pushToast` for errors only. Hooking the nod to every
  success toast (the first attempt) made it celebrate "Changes saved" and the skin toggle, which
  is feedback about nothing. Don't widen it back for coverage's sake.
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
  Display, Alerts, Layout, Account. Display and Layout come from `customisePanes()`, Account absorbs
  `securitySection()`. Don't add a second settings surface; the app had three (Settings / Security /
  Customise) and nobody could guess which held what.
- **Panes mount twice:** once in the `tabDefs` array (for the tab bar) and once as a child of
  `.gb-settings-body`. Miss the second and the tab renders empty — that's how the Display tab was
  dead until Aug 2026. `buildSegSlider` only toggles `display`; it never mounts anything.
