# food/FoodService.java — 547 lines

Backs `/api/food`: food logging, a food search, and **photo → nutrition estimation** via the AI gateway.

| Method | Notes |
|---|---|
| `estimateFromPhotoMulti(req)` | multi-dish estimate (~90 lines, the biggest method) — `POST /photo-estimate-multi` |
| `estimateFromPhoto(req)` | single-dish — `POST /photo-estimate` |
| `search(query)` | OpenFoodFacts lookup behind `GET /search`; nothing in the app calls it (the form's suggestions are `recent`). Not `@Transactional`: no DB, one HTTP call |
| `recent(userId)` | up to 8 distinct foods (by name, case-insensitive) from the latest 60 entries — `GET /recent`, the "Log food" chips |
| `addEntry(userId, req)` | returns the refreshed `FoodSummaryResponse`. Also `POST /entries/manual` (kcal required), which is outside the AI rate limit. `mealSlot` absent → `defaultSlot` (the local hour of `loggedAt`, `MealSlot.forHour`: 04–10 breakfast, 11–15 lunch, 18–22 dinner, else snack). Label figures (`proteinG`…`sodiumMg`, from a barcode or a favourite) are stored only alongside a typed kcal |
| `copySlot(userId, slot, from, to)` | `POST /entries/copy?slot=` ("Copy yesterday's breakfast"): that slot's entries of `from` (default yesterday) again on `to` (default today) as `manual`, figures included. A pre-slot row (null) counts by its logged hour (`slotOf`). Nothing there → 400. No AI |
| `favourites` / `addFavourite(userId, entryId)` / `deleteFavourite` | `GET/POST /favourites`, `DELETE /favourites/{id}`: a starred entry's name, grams, kcal and macros copied into `food_favourites` (a copy, not a link). Same name again (case-insensitive) refreshes it; capped at `MAX_FAVOURITES` (24); owner-checked both ways. Each answers the whole list |
| `barcode(code)` / `barcodeFrom(json, code)` | `GET /barcode/{code}` (6–14 digits): OpenFoodFacts' **product** endpoint, mapped to a per-100 g `BarcodeProduct` (kcal from kJ / 4.184 when needed, clamped 40..900; sodium in mg, from salt / 2.5 when needed; the label's serving if 10..2000 g; brand prefixed to the name). 404 when unknown or the lookup fails. No AI, no DB |
| `updateEntry(userId, id, req)` | `PUT /entries/{id}`: any of name, grams, kcal, meal, slot, day. Typed kcal → `manual`; new grams alone rescale by the entry's kcal/100 g; a changed name or grams nulls the nutrients for FoodWeek to refill; a moved day gets local noon. No AI |
| `deleteEntry(userId, entryId)` | also returns the refreshed summary |
| `summary(userId, date)` | the day's totals — what the Home food card reads. Also `fiberG` / `sugarG` / `sodiumMg` (`daySum`): the sum over the entries that carry the figure, **null when none does** — fibre is estimated (FoodWeek), sugar and sodium only ever come from a scanned label, so the card shows no made-up 0 |
| `photoHistory(userId)` | the "recent scans" list |
| `recordPhoto(userId, req)` | writes a `FoodPhotoLog` |

Both mutating entry methods return the whole day summary, so the frontend never needs a follow-up
GET after a write.

## Notes

- Photo estimation goes through `OpenAIClient` (Claude via Cloudflare). When it is unconfigured the estimate path must
  degrade gracefully rather than 500 — check that before changing the response shape.
- `FoodPhotoLog` is a lightweight log (not the image itself). Its card is gone; it still feeds the
  photo achievement (`achievements.js`) and a Home insight (`dashboard.js`); the frontend also caches its own copy via `rememberPhotoFood` in app.js.
- These endpoints are behind `AiRateLimitInterceptor` (per-user limit on AI-backed routes).
- Entries are per (user, date); `FoodEntry` holds the nutrition columns.
- **Calories, in order:** the AI (when configured), then `FoodWeek.kcalPer100g` (the keyword
  table's macros as 4/4/9, `estimateSource` "table"), then OpenFoodFacts, then the flat 220/300.
  The table comes before OpenFoodFacts because that is a packaged-goods database: its "dosa" is a
  batter mix. Hotel adds 18% to the table and OpenFoodFacts figures.
- **`pieces`** ("2 dosa") is turned into grams: the AI's answer (told the count), else
  `pieces x FoodWeek.gramsPerPiece(name)` (100 g for anything not in its table). `quantityGrams`
  wins when both are sent. A counted portion is held to the column's 10..2000, not the 80..700 a
  guessed plate gets, so one idli can be 40 g.
- `addEntry` makes **at most one** AI call (`askAi`): grams, kcal/100 g and the four nutrients come
  back together, asked only when a typed gram figure or an OpenFoodFacts hit leaves something
  unknown. When it was asked, the nutrients are stored right away; otherwise FoodWeek's batch fills
  them. Not `@Transactional`: it would hold a connection through OpenFoodFacts and the AI.

DTOs: `FoodDtos`. Frontend: `openAddFood` in `scripts/app.js`, `FoodCard` / `ScreenFood` /
`FoodSummaryCard` in `scripts/dashboard.js`.

**`food/FoodWeek`** (not in this file) backs the Summary screen: `GET /week` (7 days of kcal against
`users.daily_food_goal_kcal`, plus protein, carbs, fat and fiber: `food_entries.{protein,carbs,fat,fiber}_g`
are filled for the week's missing rows in one AI batch through a guarded `coalesce` UPDATE, never
`save()`, which would re-insert an entry deleted mid-call; until then a per-100 g keyword table stands
in, unstored. Targets: protein 1.6 g/kg for a gain goal, else 1.2, else 60 g; carbs 50% and fat 30%
of the kcal goal; fiber 30 g. The response also carries `averages` (finished days with meals; today
only when it's all there is), `levels` (low/ok/high, under 80% / over 120%) and top-5 `sourcesBy`
nutrient; `proteinTargetG` / `sources` are the older protein-only fields, kept for stale builds) and
`POST /diet-check[?date=YYYY-MM-DD]` (rate-limited; with `date`, one of the last 7 days judged alone, today worded "so far" and told to the AI as in progress. **A day still in progress** (a check of today, or a week whose only meals are today's — `averagesOnlyToday`, which also drives `GET /week`'s `levels`) is judged "low" against `dayShare(now)` of the targets: whole hours of a fixed 07:00–23:00 waking day in the user's zone (`UserClock.zoneOf`), floored at 0.25; "high" stays against the full day, since meals are lumpy (`level(avg, target, share)`, `rules(..., share)`; ponytail at `dayShare`). Under 1 the AI is told the share too. Water (via `WaterService.totalsByDay`/`goalMl`) is judged as a fifth gap unless the user turned the `water` feature off (`waterOn(user)`: `users.feature_prefs.water === false`; opt-out, so an unknown user or no prefs is on) — none logged is then 0 ml, "low"; off is `water: null`; the last AI answer is stored in `food_diet_checks` per user and scope with its prompt, and served only to the identical prompt; levels come from the same numbers via `rules()`, the AI only writes
the summary and the foods to add, and `rules()` is the whole answer when the AI is off or fails, answering `source: "rules"`, which the
card shows as a "Standard tips for now" line. `rules()` gives every gap its summary names one tip
before any extras, and lists at least 4 but never fewer than the gaps named, so water as a fifth gap keeps its tip). Not
`@Transactional` on purpose: it would hold a connection through the AI call. app.js drops the
check on every entry change, since it describes the week's dishes. AI spend: a failed estimate batch
backs off 10 minutes per user (the keyword table fills in meanwhile) through the shared
`ThrottleStore` (`recordFailure`/`attempt`/`clearAttempt` on key `food-estimate:<userId>`, i.e. a
hashed `login_attempts` row, swept by the login guard once idle and unlocked), and a diet check whose
prompt is identical to the last one returns the last answer from `food_diet_checks`; both in the
database, so every instance and a restart share them.

## Dating and manual calories

- **Entries can be backdated.** `addEntry` files the day from the request's own `loggedAt`, so any
  past instant works — the "Log food" sheet has a Day picker (capped at today) and sends local noon
  for a past day, which lands on the right date in any zone. The response is that day's summary, so
  the frontend must not push a backdated one into today's Home card (`logFoodEntry` guards on
  `summary.date`).
- **`UserClock`, not `LocalDate.now()` or UTC.** `summary()` defaults to the user's day and
  `addEntry` derives `logDate` from the user's zone. Before that the write used UTC and the read
  used the server's zone, so an IST user's dinner was filed under yesterday and disappeared from the
  Food screen the moment it saved. `FoodEntryTest` pins both directions.
- **`AddFoodEntryRequest.kcal` overrides everything.** Present means the user typed it: no
  OpenFoodFacts lookup, no AI call (not even for the grams: with no `quantityGrams` they come from
  `defaultQuantity`), no estimate, and `estimateSource` is `manual`. The app sends these to
  `/entries/manual` (`logFoodEntry`), so a label read never spends the AI budget. The bound is
  1..5000 to match the column's own CHECK, so a slipped finger is a 400 rather than a constraint
  violation surfacing as a 500.
- The per-100g figure is back-derived from the typed total so every row reports in the same unit,
  and **clamped to 40..900** because that column is CHECKed too. 90 kcal of coffee over a 250g
  default is 36, which the database refuses. The typed total is never adjusted.
