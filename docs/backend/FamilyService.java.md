# family/FamilyService.java — 1492 lines (largest backend class)

Backs everything under `/api/family` (`FamilyController`). Two halves: **household membership** and
the **AI meal planner** (OpenAI, with a deterministic fallback).

## Public API

### Membership
| Method | Line | Notes |
|---|---|---|
| `getFamily(userId)` | 119 | read-only snapshot |
| `addMember(userId, req)` | 128 | member may be **unmapped** (no account) |
| `updateMember` / `updateProfile` | 150 / 171 | profile = the food/nutrition profile |
| `removeMember` | 181 | |
| `searchUsers(userId, q)` | 198 | to link an existing account |
| `linkMember(userId, req)` | 225 | sends an invite |
| `listInvites` / `acceptInvite` / `declineInvite` | 290 / 313 / 325 | |
| `leaveFamily(userId)` | 341 | |

### Meal planning
| Method | Line | Notes |
|---|---|---|
| `scanGroceries(req)` | 373 | photo/text → ingredient list |
| `generateMealPlan(userId, req)` | 446 | the big one (~130 lines) |
| `getLatestPlan(userId)` | 427 | **latest row per family wins** |
| `generateMultiDay` / `getLatestMultiDay` | 630 / 688 | weekly/monthly, optional occasion theme |
| `markPlanCooked(userId, planId)` | 703 | feeds `bumpDishes` preference learning |
| `saveFavourite` / `listFavourites` / `deleteFavourite` | 574 / 607 / 617 | |

### Pantry & shopping
`listPantry` (714), `addPantry` (724), plus `/pantry/scan`, `/pantry/{id}` PUT+DELETE;
`addShopping` (807), `toggleShopping` (823), `deleteShopping` (834), `generateShopping` (844).

## Internals worth knowing before editing

- **Access control helpers** — use these, don't hand-roll checks: `requireMyFamily` (904),
  `requireFamily` (1201), `requireMember` (1192), `requireOwner` (1206), `requireManageOrSelf` (1212),
  `requireMemberAccess` (1220), `requirePantry` (912).
- `resolveOrCreateFamily` (1135) / `currentFamily` (1124) — a user gets a family lazily on first use.
- **LLM prompt assembly:** `buildContext` (1354) ← `appendMemberLines` (1033),
  `appendAvailableLines` (1051), `appendListLine` (1390), `memberPhysique` (1256),
  `inferGender` (1276), `learnedDishesNote` (1007), `pantryNames` (960), `sanitize` (1402).
- **LLM response handling:** `stripFences` (1440) strips ``` fences, `readJson` (1343),
  `extractDishNames` (966) + `collectMeals` (978), and **`fallbackPlan` (1422) / `fallbackMultiDay`
  (1070)** — the deterministic plans returned when OpenAI is unconfigured or fails. Keep that path
  working; the UI must never hard-fail on a missing API key.
- **Preference learning:** `bumpDishes(familyId, dishes, weight)` (988) writes
  `FamilyDishPreference` rows (accepted / cooked / favourited signal), read back via
  `learnedDishesNote` into the next prompt.
- Column-packing helpers: `writeList` / `readList` (1316 / 1332) store `List<String>` as a delimited
  string; `applyProfile` / `readProfile` (1294 / 1306) map the food profile.

Entities: `Family`, `FamilyMember`, `FamilyMealPlan`, `FamilyMultiDayPlan`, `FamilyFavouriteMenu`,
`FamilyDishPreference`, `FamilyPantryItem`, `FamilyShoppingItem`. DTOs: `FamilyDtos`,
`FamilyPlannerDtos`. Frontend: [scripts/family.js](../scripts/family.js.md).
