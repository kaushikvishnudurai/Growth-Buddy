# scripts/family.js — Family tab + AI meal planner

Exports `ScreenFamily({ api })`. Self-contained: owns its data + view state, repaints its own subtree
(`paint()`), so the parent only passes thin fetch wrappers. Registered in `SCREENS.family`.

Consts at top: `RELATIONSHIPS` (mother…other), `DIETS` (Vegetarian/Non-Veg/Eggetarian/Vegan),
`REL_GENDER`, `MEALS`, `AGE_ACCENT` / `AGE_PLURAL` (age-band styling).

Almost everything lives inside `ScreenFamily` as closures:

| Area | Functions |
|---|---|
| data | `applyFamily`, `applyPlan`, `load`, `SECTION_LOADERS` / `loadSection` / `retrySection` / `sectionError` — each planner section loads and fails on its own: a failure sets `model.sectionErrors[key]` and the section shows "Could not load … · Try again" instead of a fake empty list. `run(promise, onOk)` — the save wrapper: disables only the pressed control (read off `window.event`), toasts errors, repaints once after success and not at all on failure, so a failed form keeps what was typed |
| live | `onFamilyChanged` listens for `gb:family-changed` (another member changed members / chores / shopping / pantry / plan / weekly / recipes — `FamilyEvents` on the server) and refetches that slice (a `plan` change also refetches `history`); `paintSoon` defers the repaint while a panel is open or a text field has focus |
| members | `statusPill`, `memberCard` (owner sees ★ Make owner on mapped accounts), `removeMember`, `transferOwner`, `membersSection`, `familySummary`, `leaveFamily` (members only — an owner transfers first) |
| panels (slide-over forms) | `openPanel`/`closePanel`/`panelHeader` (close restores the list's scroll offset; an open panel is on gb-kit's back stack via `trackOverlay`, so back closes it), `memberFormControls`, `addChooserPanel`, `addPanel`, `editPanel`, `profilePanel`, `linkPanel` |
| invites | `invitesSection` |
| meal planner | `ingredientChips`, `plannerSection`, `planActions`, `mealList(meal, items, {live, cookId, onCook})`, `chipRow`, `planView`, `nutriStat`. On the **live** plan only (not a favourite's copy) each meal has a `cookPicker` (`assignCook` → `plan.cooks[meal] = memberId`, stored in the plan JSON) and each dish is a `dishItem` button that opens `recipePanel` |
| plan history | `pastPlans` (`model.planHistory`, the current plan filtered out) — **Use again** calls `reusePlan`, which copies the row forward server-side; `planDishes` summarises a plan |
| recipes | `recipePanel(dish)` (ingredients one per line + steps ≤4000 together + cook minutes; saving it empty deletes it), `recipeFor` / `dishKey` — the same key as the server's `shoppingKey` |
| chores | `choresSection` (draft lives in `model.choreDraft` so a chip tap's repaint keeps the typed title), `assigneeChips` (Anyone + members), `choreRow` (assignee `select` styled as a chip → `updateChore`; Undo on delete re-adds), `tickChore` + `pendingChoreTicks` / `overlayChoreTicks` (optimistic, as the shopping tick) |
| multi-day plan | `weeklySection`, `weeklyView`, `weekDayCard(d, index, wk)` — a cook per meal per day; the server addresses the day by **position** (`index + 1`), not `d.day` |
| pantry | `pantrySection`, `pantryRow` (a **Low** toggle → `updatePantry` with the whole item), `restockButton` ("Add expiring & low items to list" → `shoppingFromPantry`; also on Shopping) |
| shopping | `shoppingSection`, `shopRow`, `tickShopping` (optimistic tick, rolled back on failure; `pendingTicks` is laid back over any list that lands meanwhile via `overlayPending`), `restoreShopping` (the delete toast's Undo re-adds the line). Build-from-plan toasts the server's `message`. `shopTools`: **Share** (`shareShopping` — `navigator.share`, else clipboard; unticked lines only, `shoppingText`) and **Print** (`printShopping` puts `gb-print-shopping` on `<body>` for the length of the print; `@media print` in app.css then shows only `shopPrintout`, which is `display:none` on screen) |
| favourites | `favouritesSection`, `favCard` |
| shell | `sectionNav`, `switchSection`, `activeSection`, `sectionBadge`, `emptyState`, `skeleton`, `paint` |

Helpers: `initials`, `cap`, `toList`/`fromList` (comma string ↔ array), `field`. The grocery and
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
