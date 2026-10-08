# food/FoodService.java — 547 lines

Backs `/api/food`: food logging, a food search, and **photo → nutrition estimation** via the AI gateway.

| Method | Line | Notes |
|---|---|---|
| `estimateFromPhotoMulti(req)` | 76 | multi-dish estimate (~90 lines, the biggest method) — `POST /photo-estimate-multi` |
| `estimateFromPhoto(req)` | 329 | single-dish — `POST /photo-estimate` |
| `search(query)` | 211 | food lookup for the add-food form |
| `addEntry(userId, req)` | 220 | returns the refreshed `FoodSummaryResponse` |
| `deleteEntry(userId, entryId)` | 317 | also returns the refreshed summary |
| `summary(userId, date)` | 200 | the day's totals — what the Home food card reads |
| `photoHistory(userId)` | 180 | the "recent scans" list |
| `recordPhoto(userId, req)` | 187 | writes a `FoodPhotoLog` |

Both mutating entry methods return the whole day summary, so the frontend never needs a follow-up
GET after a write.

## Notes

- Photo estimation goes through `OpenAIClient` (Claude via Cloudflare). When it is unconfigured the estimate path must
  degrade gracefully rather than 500 — check that before changing the response shape.
- `FoodPhotoLog` is a lightweight log (not the image itself). Its card is gone; it still feeds the
  photo achievement (`achievements.js`) and a Home insight (`dashboard.js`); the frontend also caches its own copy via `rememberPhotoFood` in app.js.
- These endpoints are behind `AiRateLimitInterceptor` (per-user limit on AI-backed routes).
- Entries are per (user, date); `FoodEntry` holds the nutrition columns.
- `addEntry` makes **at most one** AI call (`askAi`): grams, kcal/100 g and the four nutrients come
  back together, asked only when a typed gram figure or an OpenFoodFacts hit leaves something
  unknown. When it was asked, the nutrients are stored right away; otherwise FoodWeek's batch fills
  them. Not `@Transactional`: it would hold a connection through OpenFoodFacts and the AI.

DTOs: `FoodDtos`. Frontend: `openAddFood` in `scripts/app.js` (~1669), `FoodCard` / `ScreenFood` /
`FoodSummaryCard` in `scripts/dashboard.js`.

**`food/FoodWeek`** (not in this file) backs the Summary screen: `GET /week` (7 days of kcal against
`users.daily_food_goal_kcal`, plus protein, carbs, fat and fiber: `food_entries.{protein,carbs,fat,fiber}_g`
are filled for the week's missing rows in one AI batch through a guarded `coalesce` UPDATE, never
`save()`, which would re-insert an entry deleted mid-call; until then a per-100 g keyword table stands
in, unstored. Targets: protein 1.6 g/kg for a gain goal, else 1.2, else 60 g; carbs 50% and fat 30%
of the kcal goal; fiber 30 g. The response also carries `averages` (finished days with meals; today
only when it's all there is), `levels` (low/ok/high, under 80% / over 120%) and top-5 `sourcesBy`
nutrient; `proteinTargetG` / `sources` are the older protein-only fields, kept for stale builds) and
`POST /diet-check[?date=YYYY-MM-DD]` (rate-limited; with `date`, one of the last 7 days judged alone, today worded "so far" and told to the AI as in progress; water (via `WaterService.totalsByDay`/`goalMl`) is judged as a fifth gap whenever any was logged that week, `water: null` otherwise; the last AI answer is kept per user and scope; levels come from the same numbers via `rules()`, the AI only writes
the summary and the foods to add, and `rules()` is the whole answer when the AI is off or fails, answering `source: "rules"`, which the
card shows as a "Standard tips for now" line. `rules()` gives every gap its summary names one tip
before any extras, so the cap of 4 can't drop one). Not
`@Transactional` on purpose: it would hold a connection through the AI call. app.js drops the
check on every entry change, since it describes the week's dishes. AI spend: a failed estimate batch
backs off 10 minutes per user (the keyword table fills in meanwhile), and a diet check whose prompt
is identical to the last one returns the last answer; both in memory, so per instance.

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
  OpenFoodFacts lookup, no AI call, no estimate, and `estimateSource` is `manual`. The bound is
  1..5000 to match the column's own CHECK, so a slipped finger is a 400 rather than a constraint
  violation surfacing as a 500.
- The per-100g figure is back-derived from the typed total so every row reports in the same unit,
  and **clamped to 40..900** because that column is CHECKed too. 90 kcal of coffee over a 250g
  default is 36, which the database refuses. The typed total is never adjusted.
