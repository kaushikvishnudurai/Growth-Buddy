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
| shell | `sectionNav` (1382), `switchSection` (1317), `activeSection` (1414), `sectionBadge` (1367), `emptyState` (1286), `skeleton` (1986), `paint` (1998) |

Helpers: `initials`, `cap`, `accentClass`, `toList`/`fromList` (comma string ↔ array), `field`,
`readImageDataUrl` (file → data URL for the grocery photo scan).

Backend: everything under `/api/family` — see [FamilyService](../backend/FamilyService.java.md).
A member may be **unmapped** (a profile with no account) or linked to a real user via an invite.
Styles: `styles/app.css` §"FAMILY tab & AI South Indian meal planner" (~6040 and ~5409).
