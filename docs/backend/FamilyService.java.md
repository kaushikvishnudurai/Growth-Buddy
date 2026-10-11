# family/FamilyService.java — the largest backend class

Backs everything under `/api/family` (`FamilyController`). Two halves: **household membership** and
the **planner** (meal plans via the AI gateway with a deterministic fallback, chores, recipes,
pantry, shopping). Docs name symbols — `grep -n` them.

## Public API

### Membership
| Method | Notes |
|---|---|
| `getFamily(userId)` | read-only snapshot |
| `startSolo(userId)` | "Plan meals for just me": `resolveOrCreateFamily` and nothing else, so the self row is copied from Profile; in a family already = that one, unchanged (`FamilyServiceTest`) |
| `addMember(userId, req)` | member may be **unmapped** (no account). `checkedDob` refuses a future birth date and, for mother/father/grandparents/spouse, one under `MIN_ADULT_REL_AGE` (12) |
| `updateMember` / `updateProfile` | owner, or the mapped member themselves (`requireManageOrSelf`) |
| `removeMember` | owner only; tells a linked member |
| `transferOwnership` | the only way an owner can then leave |
| `searchUsers(userId, q)` | name or exact id, 2+ chars, masked email with no domain (`UserRepository.maskEmail`), per-user throttle shared with Circle's search (`UserRepository.throttleSearch`, called in `FamilyController.search` because this method is read-only and a throttle hit is a write) |
| `linkMember(userId, req)` | sends an invite. **A new invite row carries only the name**: the target's DOB, gender, height, weight and diet are copied in `acceptInvite`, never before (they used to be visible to the inviter's whole family, and in its meal-plan prompts, with no consent). Capped per owner (`INVITES_PER_DAY`) and per owner + target pair (`INVITES_PER_PAIR_PER_DAY`), 429 past it |
| `listInvites` / `acceptInvite` / `declineInvite` | accept locks the user's rows, copies the user's profile onto an `inviteOnly` row, then a solo owner's household folds in (`foldSoloFamilyInto`, whose food profile wins). `toMemberResponse` blanks every profile field of an `invited` + `inviteOnly` row, for rows made before the fix |
| `leaveFamily(userId)` | |

### Planning
| Method | Notes |
|---|---|
| `scanGroceries(req)` | photo → ingredient list |
| `generateMealPlan(userId, req)` | one day; prompt = members + sent ingredients + **pantry** (never an expired row) + learned dishes |
| `getLatestPlan` / `planHistory` / `reusePlan` | **latest row per family wins**; history = last 8 |
| `assignCook` / `assignMultiDayCook` | `cooks: {meal: memberId}` on the plan JSON, no column |
| `generateMultiDay` / `getLatestMultiDay` | weekly / fortnight, optional occasion theme |
| `markPlanCooked(userId, planId)` | once per plan; feeds `bumpDishes` |
| `saveFavourite` / `listFavourites` / `useFavourite` / `deleteFavourite` | saves a STORED plan (named or latest), never a client body; use = a new plan row |
| chores: `listChores` / `addChore` / `updateChore` / `toggleChore` / `deleteChore` | `choreDone` reads repeat (daily / weekly) against the user's day |
| `remindChore(userId, id, time)` | a `CalendarReminder` (via `ReminderService.create(userId, text, date, time, repeat)`) in the **assignee's** calendar when mapped with an account, else the caller's, plus a bell to the assignee; due day or today (tomorrow when the time has gone), repeating as the chore does; `sentTo` names who got it |
| recipes: `listRecipes` / `saveRecipe` / `deleteRecipe` | keyed by `shoppingKey(dish)`; empty save deletes |

### Pantry & shopping
`listPantry`, `addPantry`, `updatePantry`, `deletePantry`, `scanPantry`; `listShopping`,
`addShopping`, `toggleShopping` (sets, or flips with no value), `deleteShopping`,
`generateShopping` (recipes first, then AI, then `fallbackShopping`), `restockFromPantry`.

## Internals worth knowing before editing

- **AI methods are not `@Transactional`** (`scanGroceries`, `generateMealPlan`, `generateMultiDay`,
  `scanPantry`, `generateShopping`): a transaction held one of 8 pooled connections through a call
  of up to 45s. Each repository call runs on its own short transaction, as in `MentorService`.
- **An `ApiException` from the AI client is rethrown, not fallen back on** — it is the hourly budget's
  429. Falling back saved a template over the family's real plan and blamed "AI unavailable".
- Any other AI failure, or no gateway configured, uses **`fallbackPlan` / `fallbackMultiDay` /
  `fallbackShopping`**. Keep that path working; the UI must never hard-fail on a missing API key.
- **Access control helpers** — use these, don't hand-roll checks: `requireMyFamily`, `requireFamily`,
  `requireMember`, `requireFamilyMember`, `requireOwner`, `requireManageOrSelf`,
  `requireMemberAccess`, `requirePantry`, `requireChore`. `currentFamily` only follows a **mapped**
  row: an invite grants nothing.
- `resolveOrCreateFamily` / `currentFamily` — a user gets a family lazily on first add / invite, or on `startSolo`.
- The one-day plan's prompt always carries the whole pantry (`pantryNames`), expired items included; the client only names the in-date ones.
- **Live sync:** every write calls `changed(fam, actor, section)` → `FamilyEvents` (after commit) →
  the client's `gb:family-changed`. Sections: members, chores, plan, weekly, pantry, shopping,
  favourites, recipes. A write that skips it leaves other members on stale data.
- **Prompt assembly:** `appendMemberLines` (age band, `memberPhysique`, diet, allergies, avoid,
  favourites, conditions) + `appendAvailableLines` (ingredients + pantry), `learnedDishesNote`,
  `sanitize` on every user string. Shared by the one-day and multi-day plans, both over `diners(familyId)`:
  the roster minus unaccepted invite rows (`invited` + `inviteOnly`), whose legacy profile copy must not
  reach the prompt (`toMemberResponse` masks the same rows).
- **Shopping:** `addToList` is the one writer for both builders: dedupe via `newShoppingLines`
  against UNTICKED lines + pantry; a candidate matching a ticked line re-opens it.
- **Pantry expiry:** `toPantryResponse(item, today)` with the user's today; `EXPIRING_DAYS` is both
  the badge window and the restock window.
- **Expired food is never cooked (food safety):** `pantryNames(familyId, today)` drops rows past
  `expiryDate` (user-local today), so they are neither "available" to a plan nor "have" for the
  shopping list. `expiredNames` (those rows + any sent ingredient with freshness `expired` / quantity
  `EXPIRED...`, see `isExpired(GroceryItem)`) goes in as `appendAvoidLine`, and `dropAvoidedDishes`
  strips every dish naming one (whole word, case-insensitive, plural allowed, also the name without
  `FOOD_DESCRIPTORS` like "fresh": "Fresh Curd" catches "Curd Rice") from AI and fallback plans
  alike, saying so in `suggestions`. Both one-day and multi-day plans.
- **Preference learning:** `bumpDishes(familyId, dishes, weight)` (accepted / cooked / favourited),
  read back via `learnedDishesNote`.
- `writeList` / `readList` store `List<String>` as JSON text; `applyProfile` / `readProfile` map the
  food profile (`dietPreference` trimmed to its 32-char column).

Entities: `Family`, `FamilyMember`, `FamilyMealPlan`, `FamilyMultiDayPlan`, `FamilyFavouriteMenu`,
`FamilyDishPreference`, `FamilyPantryItem`, `FamilyShoppingItem`, `FamilyChore`, `FamilyRecipe`.
DTOs + repositories: `FamilyDtos`, `FamilyPlannerDtos`. Live events: `FamilyEvents`. Frontend:
[scripts/family.js](../scripts/family.js.md).
