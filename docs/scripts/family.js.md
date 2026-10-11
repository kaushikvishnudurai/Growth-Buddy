# scripts/family.js — Family tab + AI meal planner

Exports `ScreenFamily({ api })`. Self-contained: owns its data + view state, repaints its own subtree
(`paint()`), so the parent only passes thin fetch wrappers. Registered in `SCREENS.family`.

Consts at top: `RELATIONSHIPS` (mother…other), `DIETS` (Vegetarian/Non-Veg/Eggetarian/Vegan),
`REL_GENDER`, `MEALS`, `AGE_ACCENT` / `AGE_PLURAL` (age-band styling).

Almost everything lives inside `ScreenFamily` as closures (`grep -n` the name):

| Area | Functions |
|---|---|
| data | `applyFamily`, `applyPlan`, `SECTION_LOADERS` / `loadSection` (one loader per section; a failure sets `sectionErrors[key]` and shows `sectionError`'s retry banner instead of an empty list), `load` (prefetches every section), `onFamilyChanged` (live refetch on `gb:family-changed`, deferred while a panel is open or a field is focused), `run(promise, onOk)` — the save wrapper: disables only the pressed control (read off `window.event`), toasts errors, repaints once after success and not at all on failure, so a failed form keeps what was typed |
| members | `statusPill`, `memberCard` (profile/edit buttons only for the owner or the member themselves, matching `requireManageOrSelf`), `removeMember`, `transferOwner`, `membersSection`, `familySummary`, `leaveFamily` |
| panels (in-place forms) | `openPanel`/`closePanel`/`panelHeader` (close restores the list's scroll offset; an open panel is on gb-kit's back stack via `trackOverlay`, so back closes it), `memberFormControls`, `addPanel` (every Add opens straight on the profile form — no profile-or-invite chooser; "On Growth Buddy already? Invite them" opens `linkPanel`; the name fills the relationship and gender while the select is untouched, via `relFromName` / `NAME_REL` at the top; "Save and add another" saves and reopens a blank form; an `@` in the name is refused, since people search goes by name only), `editPanel`, `profilePanel`, `linkPanel`, `recipePanel` |
| invites | `invitesSection` |
| chores | `choresSection`, `choreRow`, `tickChore` (optimistic, `pendingChoreTicks` overlay), `assigneeChips`; an open chore's bell → `askReminderTime` → `api.remindChore` |
| today's plan | `plannerSection` — the plan first (`planView(resp, actions)`), then the `builder` card (groceries — seeded once from the non-expired pantry (`model.pantrySeeded`) — + Plan for + Generate; expired pantry items are sent as extra ingredients with quantity "EXPIRED, do not use", because `MealPlanRequest` has no avoid list and the server's `pantryNames` lists expired items too; `applyPlan` drops them (`freshness: 'expired'`) when it seeds the chips from a plan's groceries, and `expiredNote` lists them under the chips ("Not using: Curd (expired)"); the chip's remove x is a 44px button with negative margins; Generate focuses the plan heading (`#gb-family-plan-head`, `focusPlanHead`) when it starts and when the plan lands, only if focus fell to `<body>`; `picked` = selected members still in the family; none picked disables Generate — the server reads an empty list as everyone), then `pastPlans`. `planView`: the **day rail** (`mealStop` per meal: node, name, `cookPicker`, `dishItem`s), actions, nutrition (mono numbers, `nutriStat`) with allergens as a checklist, and Buddy's notes folded in a `<details>`. `saveMenu` (openModal, not `window.prompt`), `assignCook` |
| weekly plan | `weeklySection`, `weeklyView`, `weekDayCard` (headed by date via `planDayLabel`: day 1 is the plan's `createdAt` local day; "Day N" only without one) |
| pantry | `pantrySection`, `pantryRow`, `restockButton`. The category follows the name (`pantryCategory`, module-level `CATEGORY_WORDS`: dal → Pulse, curd → Dairy, rice/atta → Grain…) until one is picked; after Add the Item input (`#gb-pantry-name`) takes focus back. The Low toggle is named "<item> running low". The row meta is one `.gb-family-meta-part` (nowrap) per part, so "Vegetable · 500 g" wraps between parts, not inside one |
| shopping | `shoppingSection`, `shopRow`, `tickShopping` (optimistic, `pendingTicks` overlay), `restoreShopping` (undo), `shopTools` / `shareShopping` / `printShopping` / `shopPrintout` |
| saved menus | `favouritesSection`, `favCard` (View, Use today, Delete) |
| shell | `sectionNav`, `switchSection` (a section dropped to null reloads through `loadSection`), `activeSection`, `sectionBadge`, `emptyState`, `skeleton`, `paint` |

Helpers: `nextBirthday(dob)` (29 Feb → 28th in a common year), `askReminderTime(title, sub, onTime)` (the time dialog both reminders use; a member card with a `dob` and not you gets a `calendar-heart` button that adds a yearly reminder via `api.addReminder`), `initials`, `cap`, `onEnter(fn, ...inputs)` (Enter adds, as a form submit would), `toList`/`fromList` (comma string ↔ array), `fmtDay` (a LocalDate as a local
day, never `slice(0, 10)` of an ISO string), `field`. The grocery and
pantry photo scans send `shrinkPhoto(file)` from notes.js (≤1280px JPEG), not the raw 4-12 MB photo.
Messages go through `toast` (toast.js), never `alert()`.

Backend: everything under `/api/family` — see [FamilyService](../backend/FamilyService.java.md).
A member may be **unmapped** (a profile with no account) or linked to a real user via an invite.
Styles: `styles/app.css` §"FAMILY tab & AI South Indian meal planner" (two sections).

Two things in there that look odd and aren't:

- **`sectionNav` renders two nested divs.** `.gb-family-sectionnav` is the sticky opaque backdrop;
  `.gb-family-sectionnav-strip` inside it scrolls and carries the fade mask. They can't be one
  element — a mask on the sticky element fades its own background, and page content shows through.
  The mask is unconditional by design: tabs are `flex: none` and left-packed, so when they all fit,
  it falls on empty background and is invisible.
- **The member grid uses `minmax(0, 1fr)`, never a bare `1fr`.** A bare `1fr` is `minmax(auto, 1fr)`,
  whose `auto` floor let the left card grow to 331px against the right's 291px and pushed the grid
  36px past its own container, so the right column stopped lining up with the summary card above it.
- **The sticky strip is a solid `var(--surface)` with a bottom border, no blur**, and drops its border
  and rounds its bottom corners at >=1024px. `var(--bg)` is only invisible over a flat background
  (the premium skin paints `.gb-app` with three radial gradients, so it showed as a dark rectangle),
  and a backdrop blur re-rasterised on every scroll frame. And at >=1024px the screen is capped at 900px (`.gb-scroll > .gb-rise:not(...)`) while
  the header spans the whole column, so a bar treatment stops mid-canvas. The desktop override has
  to sit *after* the sticky rule in the file — same specificity, source order decides.
- **`.gb-family` insets its children 20px, the sticky nav excepted.** Family was the only screen
  root in the app with no horizontal padding — Home, Goals, Calendar and Achievements all use
  `0 20px` — which is why its cards read as cramped beside the same cards on Achievements. The nav
  is excluded so its backdrop stays full-bleed. `.gb-section-head` (family-only, six uses) lost the
  2px side margin that used to compensate for the missing padding.
- Family avatars all use `--brand-soft`. There was an `AGE_ACCENT` map colouring them by age band
  (adult → pink `--social-soft`); the band is already written on every card, and a family of adults
  got identical circles in the one colour nothing else on the screen uses.
