# family/FamilyService.java (largest backend class)

Backs everything under `/api/family` (`FamilyController`). Two halves: **household membership** and
the **AI meal planner** (Claude via the Cloudflare gateway, with a deterministic fallback).

## Public API

### Membership
| Method | Notes |
|---|---|
| `getFamily(userId)` | read-only snapshot |
| `addMember(userId, req)` | member may be **unmapped** (no account) |
| `updateMember` / `updateProfile` | profile = the food/nutrition profile |
| `removeMember` | owner only; tells a linked member they were removed (or their invite withdrawn) |
| `transferOwnership(userId, memberId)` | owner only, to a **mapped** member with an account; the old owner stays a member |
| `searchUsers(userId, q)` | to link an existing account |
| `linkMember(userId, req)` | sends an invite + a bell notification. A target already mapped elsewhere is refused unless they are a **solo owner** (`isSoloOwner`: their family has no other mapped account) |
| `listInvites` / `acceptInvite` / `declineInvite` | see "Accepting" below; decline tells the owner (`revertInvite` drops an invite-only row or hands a slot back as unmapped) |
| `leaveFamily(userId)` | members only — the owner is refused until they `transferOwnership`; tells the owner |

**Accepting** (`acceptInvite`) takes `lockByLinkedUser` (SELECT … FOR UPDATE on every row naming the
user) and decides on what that returns, so two racing accepts serialise. Every other pending invite
is declined in the same transaction. A solo owner may accept: `foldSoloFamilyInto` **moves** their
unmapped profiles to the new family, withdraws the invites they had sent, retires their self row
(copying its food profile onto an invite-only membership), and leaves the old family row + its
pantry/shopping/plans in place but unreachable — nothing is deleted by an accept; account deletion
removes it. Anyone in a family with another account must leave first.

**Access is MAPPED, not linked**: `requireMemberAccess` / `requireManageOrSelf` count a row only when
its status is `mapped` — an `invited` row names the invitee too.

**Live sync**: membership, chores, shopping, pantry, plan (reuse / cook), weekly (cook) and recipe writes call `changed(fam, actor, section)` →
`FamilyEvents.changed`, a transient `family_changed` frame on `/user/queue/notifications` to every
other mapped member, sent after commit (not a `Notification` row). Frontend: `gb:family-changed`.

### Meal planning
| Method | Notes |
|---|---|
| `scanGroceries(req)` | photo/text → ingredient list |
| `generateMealPlan(userId, req)` | the big one (~130 lines) |
| `getLatestPlan(userId)` | **latest row per family wins** |
| `planHistory(userId)` | last 8 rows, newest first, current included — plans were always rows, never overwritten |
| `reusePlan(userId, planId)` | "Use again": copies the row forward as a new one, so it becomes current and the history is untouched |
| `assignCook` / `assignMultiDayCook` | `cooks: {meal: memberId}` on the plan JSON (on `days[day-1]` for weekly — by position). No column. `setCook` notifies a mapped cook who isn't the actor |
| `generateMultiDay` / `getLatestMultiDay` | weekly/monthly, optional occasion theme |
| `markPlanCooked(userId, planId)` | feeds `bumpDishes` preference learning — **once per plan** (`cooked_at` stamps the first tap) |
| `saveFavourite` / `listFavourites` / `deleteFavourite` | |

### Chores
`listChores`, `addChore`, `updateChore`, `toggleChore(userId, id, done)` (sets; `null` flips), `deleteChore` —
all return the whole list, open first then by due date. Writes need `requireMemberAccess` (mapped).
The assignee must be a live row of the same family (`requireFamilyMember`, else 400); a removed member's
chores read as unassigned. `notifyAssignee` sends a bell notification on create, and on update only when
the assignee changed — never to the actor. **Repeating chores** (`repeat_rule` daily | weekly) keep
`done_at` and `choreDone` compares it to the viewer's today (`UserClock`), so a tick lasts its day / week.

### Recipes
`listRecipes`, `saveRecipe` (upsert on `family_recipes.dish_key` = `shoppingKey(dish)`; ingredients +
steps ≤ 4000 together, cook minutes 0-1440; all empty → delete, returns null → 204), `deleteRecipe`.

### Pantry & shopping
`listPantry`, `addPantry`, plus `/pantry/scan`, `/pantry/{id}` PUT+DELETE;
`addShopping`, `toggleShopping(userId, id, checked)` (sets; `null` = the old flip), `deleteShopping`,
`generateShopping` — dedupes case-insensitively against the list and the pantry (`newShoppingLines`,
`shoppingKey`), falls back to a deterministic list from the plan's dishes when the AI is off or
fails (`fallbackShopping` over `DISH_INGREDIENTS`), and returns `added` + a `message`. **A dish with
a family recipe shops from it first** (`splitByRecipe` → `parseIngredientLines`: one per line,
"Toor dal: 200 g" / "Toor dal - 200 g" split into name + quantity); only the dishes without one go to the
AI / the map. `restockFromPantry` (`/shopping/from-pantry`): `restockLines` = pantry items marked
`low` or expiring on/before the user's today + 2 (expired included), deduped against the list only.

## Internals worth knowing before editing

- **Access control helpers** — use these, don't hand-roll checks: `requireMyFamily`,
  `requireFamily`, `requireMember`, `requireOwner`, `requireManageOrSelf`,
  `requireMemberAccess`, `requirePantry`.
- `resolveOrCreateFamily` / `currentFamily` — a user gets a family lazily on first use.
- **LLM prompt assembly:** `buildContext` ← `appendMemberLines`,
  `appendAvailableLines`, `appendListLine`, `memberPhysique`,
  `inferGender`, `learnedDishesNote`, `pantryNames`, `sanitize`.
- **LLM response handling:** `stripFences` strips ``` fences, `readJson`,
  `extractDishNames` + `collectMeals`, and **`fallbackPlan` / `fallbackMultiDay`**
  — the deterministic plans returned when the AI gateway is unconfigured or fails. Keep that path
  working; the UI must never hard-fail on a missing API key.
- **Preference learning:** `bumpDishes(familyId, dishes, weight)` writes
  `FamilyDishPreference` rows (accepted / cooked / favourited signal), read back via
  `learnedDishesNote` into the next prompt.
- Column-packing helpers: `writeList` / `readList` store `List<String>` as a delimited
  string; `applyProfile` / `readProfile` map the food profile.

Entities: `Family`, `FamilyMember`, `FamilyMealPlan`, `FamilyMultiDayPlan`, `FamilyFavouriteMenu`,
`FamilyDishPreference`, `FamilyPantryItem` (+`is_low`), `FamilyShoppingItem`, `FamilyChore`, `FamilyRecipe`.
The last two are family-owned: `AuthService.FAMILY_OWNED_TABLES` deletes them with the family. DTOs: `FamilyDtos`,
`FamilyPlannerDtos`. Frontend: [scripts/family.js](../scripts/family.js.md).
