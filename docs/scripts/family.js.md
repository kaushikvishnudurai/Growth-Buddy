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
| panels (in-place forms) | `openPanel`/`closePanel`/`panelHeader` (close restores the list's scroll offset; an open panel is on gb-kit's back stack via `trackOverlay`, so back closes it), `memberFormControls`, `addChooserPanel`, `addPanel`, `editPanel`, `profilePanel`, `linkPanel`, `recipePanel` |
| invites | `invitesSection` |
| chores | `choresSection`, `choreRow`, `tickChore` (optimistic, `pendingChoreTicks` overlay), `assigneeChips` |
| today's plan | `plannerSection` (`picked` = selected members still in the family; none picked disables Generate — the server reads an empty list as everyone), `planActions`, `saveMenu` (openModal, not `window.prompt`), `pastPlans` (history + Use again), `planView`, `mealList`, `dishItem`, `cookPicker`, `assignCook`, `chipRow`, `nutriStat` |
| weekly plan | `weeklySection`, `weeklyView`, `weekDayCard` |
| pantry | `pantrySection`, `pantryRow`, `restockButton` |
| shopping | `shoppingSection`, `shopRow`, `tickShopping` (optimistic, `pendingTicks` overlay), `restoreShopping` (undo), `shopTools` / `shareShopping` / `printShopping` / `shopPrintout` |
| saved menus | `favouritesSection`, `favCard` (View, Use today, Delete) |
| shell | `sectionNav`, `switchSection` (a section dropped to null reloads through `loadSection`), `activeSection`, `sectionBadge`, `emptyState`, `skeleton`, `paint` |

Helpers: `initials`, `cap`, `toList`/`fromList` (comma string ↔ array), `fmtDay` (a LocalDate as a local
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
