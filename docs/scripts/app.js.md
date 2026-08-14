# scripts/app.js — app shell (6336 lines)

The hub: owns all state, routing, rendering, and **every** backend call. No exports (entry module).
Screen modules are leaves it calls into; they get thin `api` wrapper objects, never the state.

## Region map

| Lines | Region |
|---|---|
| 1–230 | imports, date helpers (`todayLabel`, `dateKey`), `loadTheme`, quote-of-day cache (`quoteDateStr`, `loadCachedQuote`, `cacheQuote`), toasts (`pushToast`, `toastError`, `toastSuccess`, `dismissToast`) |
| 210–250 | `score()`, `loadSession`, `loadToken`, `saveSession` |
| 249–336 | wellness store (`emptyWellness`, `loadWellness`, `persistWellness`), goal progress (`loadGoalProgress`, `persistGoalProgress`, `updateGoalProgress`) |
| 337–412 | **money store**: `moneyStorageKey`, `loadMoney`, `cacheMoney`, `saveMoney(next)`; UI prefs `saveUiPrefs(patch)` → `PUT /api/auth/ui-prefs`, `hydrateUiPrefs` |
| 413–560 | streak freeze: `emptyStreakFreeze`, `loadStreakFreeze`, `reconcileStreakFreeze`, `effectiveStreak`, `habitFreezeState`, `freezeTokensLeft`, `protectStreak`, `declineStreakBreak`, `toggleRestDay`. Backend owns the tokens; this only reads fields + calls protect/unprotect. Achievements: `achievementProps`, `checkAchievements` (fires `celebrate()` on first unlock) |
| 559–625 | local trends: `emptyTrends`, `loadTrends`, `persistTrends`, `recordTrendsToday` |
| 625–740 | `clearSession`, `syncUserSession`, **`api(path, options)` / `apiFetch`** — the single network chokepoint — `handleAuthExpired` |
| 744–935 | `mapTask`, `formatTaskTime`, `cacheFoodSummary`, `loadCalendarFoodForDate`, `calendarReminders`, `loadGoogleEventsForMonth` / `…AroundMonth`, in-place repaints (`rerenderCalendarSideIfActive`, `rerenderHomeMiniCalendarIfActive`, `updateCalendarDaySelection`) |
| 934–1140 | `resetStaleCompletedTasks`, **`loadData()`** (boot fetch fan-out), `connectWebSocket` / `disconnectWebSocket` |
| 1140–1470 | mutations: `toggleTask`, `toggleHabit`, `refreshScore`, `refreshCurrentUser`, `createTask`, `createHabit`, `createGoal`, goal actions CRUD, `deleteHabit`, `quickAddWater`, `updateWaterGoal`, `logFoodEntry`, `saveSleepEntry`, `saveMoodEntry`, `addQuickExpense`, **`runQuickAdd(text)`**, `rememberPhotoFood` |
| 1481–2010 | modals: `openSleepSchedule`, `openMoodCheckin`, `openDailyPlan`, `openAddFood`, `addSuggestedReminder`, `deleteWaterEntry`, `deleteFoodEntry` |
| 2014–2260 | notifications (`refreshNotifications`, `markNotificationRead`, `respondMentorshipRequest`, `unreadNotifs`), header popovers (`toggleNotifOpen`, `toggleProfileOpen`, `toggleMoreOpen`, `profileDropdown`), routing (`screenFromHash`, `setScreen`), `toggleTheme` |
| 2270–4070 | profile + settings (biggest block): `saveProfileDetails`, `CountryPhoneInput`, `buildSegSlider`, `openSecurity` (~2825), **`openProfileSettings(initialTab)`** (~2951), `getNutritionSuggestion` |
| 4071–4262 | calendar: `syncSelectedDateToVisibleMonth`, `rerenderCalendarToolbarIfActive`, `rerenderCalendarMonthInPlace`, `calPrevMonth`/`calNextMonth`/`calToday`, `selectDate`, `retryCalendarFoodDate`, `addReminder`, `repaintCalendarGrid`, `deleteReminder` |
| 4264–4940 | shared UI: `openModal`, `segmented`, `openAddSheet`, `openAddTask`, `colorPicker`, `openAddHabit`, `relativeTime`, `notificationDropdown`, `toastStack`, `confirmDelete` |
| 4940–5256 | `ScreenHabits`, `featureOn` / `screenEnabled` / `setFeature`, `saveDigestPrefs`, `saveHomeLayout`, `saveNavLayout` |
| **5256–5552** | **`SCREENS` registry** — screen id → render fn. Start here to find a screen. |
| 5552–5575 | `captureScrollPosition` / `restoreScrollPosition` |
| 5576–6040 | auth: `authPost`, `loadAuthDraft`, `setAuthMode`, `authShell`, `runAuth`, `viewSignin`, `viewSignup`, `viewVerify` (OTP), `viewForgot`, `viewReset`, `loginCard` |
| 6043–6336 | `logout`, `loadingSplash`, `offlineBanner`, `weeklyReviewNudge`, `handleOnline`/`handleOffline`, **`render()`** (~6143), `installOutsideClickToCloseHeaderPopovers`, `refreshGoogleEventsOnReturn` |

## Rules when editing

- **All fetches go through `api()`** (~646). Don't add a bare `fetch` — you'd lose auth headers and
  the 401 → `handleAuthExpired` path.
- **Adding a screen:** register in `SCREENS` (~5256); if it needs a nav slot, also `NAV_CATALOG` in
  `gb-kit.js`. Gate it with `screenEnabled` if it's a toggleable feature.
- **`toast` is late-bound** via `scripts/toast.js` — app.js calls `registerToast()` at boot so screen
  modules can fire toasts without importing app.js (cycle).
- Some screens (money, family, mentor, circle) repaint their own subtree; calling `render()` for them
  is wasteful and can drop their local view state.
