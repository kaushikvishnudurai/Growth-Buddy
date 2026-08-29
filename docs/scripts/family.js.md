# scripts/family.js — Family tab + AI meal planner (2032 lines)

Exports `ScreenFamily({ api })`. Self-contained: owns its data + view state, repaints its own subtree
(`paint()` at ~1998), so the parent only passes thin fetch wrappers. Registered in `SCREENS.family`.

Consts at top: `RELATIONSHIPS` (mother…other), `DIETS` (Vegetarian/Non-Veg/Eggetarian/Vegan),
`REL_GENDER`, `MEALS`, `AGE_ACCENT` / `AGE_PLURAL` (age-band styling).

Almost everything lives inside `ScreenFamily` (line 112 → 2032) as closures:

| Area | Functions (line) |
|---|---|
| data | `applyFamily` (147), `load` (151), `run(promise, onOk)` (192) — the async wrapper that toasts errors |
| members | `statusPill` (209), `memberCard` (219), `removeMember` (322), `membersSection` (1187), `familySummary` (1127), `leaveFamily` (1175) |
| panels (slide-over forms) | `openPanel`/`closePanel`/`panelHeader` (335–344), `memberFormControls` (357), `addChooserPanel` (419), `addPanel` (465), `editPanel` (515), `profilePanel` (560), `linkPanel` (640) |
| invites | `invitesSection` (1232) |
| meal planner | `ingredientChips` (747), `plannerSection` (781), `planActions` (967), `mealList` (1023), `chipRow` (1043), `planView` (1060), `nutriStat` (1115) |
| multi-day plan | `weeklySection` (1434), `weeklyView` (1534), `weekDayCard` (1571) |
| pantry | `pantrySection` (1595), `pantryRow` (1723) |
| shopping | `shoppingSection` (1769), `shopRow` (1856) |
| favourites | `favouritesSection` (1897), `favCard` (1922) |
| shell | `sectionNav` (1374), `switchSection` (1309), `activeSection` (1417), `sectionBadge` (1359), `emptyState` (1286), `skeleton` (1986), `paint` (1998) |

Helpers: `initials`, `cap`, `toList`/`fromList` (comma string ↔ array), `field`,
`readImageDataUrl` (file → data URL for the grocery photo scan).

Backend: everything under `/api/family` — see [FamilyService](../backend/FamilyService.java.md).
A member may be **unmapped** (a profile with no account) or linked to a real user via an invite.
Styles: `styles/app.css` §"FAMILY tab & AI South Indian meal planner" (~6040 and ~5409).

Two things in there that look odd and aren't:

- **`sectionNav` renders two nested divs.** `.gb-family-sectionnav` is the sticky opaque backdrop;
  `.gb-family-sectionnav-strip` inside it scrolls and carries the fade mask. They can't be one
  element — a mask on the sticky element fades its own background, and page content shows through.
  The mask is unconditional by design: tabs are `flex: none` and left-packed, so when they all fit,
  it falls on empty background and is invisible.
- **The member grid uses `minmax(0, 1fr)`, never a bare `1fr`.** A bare `1fr` is `minmax(auto, 1fr)`,
  whose `auto` floor let the left card grow to 331px against the right's 291px and pushed the grid
  36px past its own container, so the right column stopped lining up with the summary card above it.
- **The sticky strip uses `--nav-bg` + `backdrop-filter`, not a flat fill**, and drops its border and
  rounds its bottom corners at >=1024px. A flat `var(--bg)` is only invisible over a flat background;
  the premium skin paints `.gb-app` with three radial gradients, so the strip showed up as a dark
  rectangle. And at >=1024px the screen is capped at 900px (`.gb-scroll > .gb-rise:not(...)`) while
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
