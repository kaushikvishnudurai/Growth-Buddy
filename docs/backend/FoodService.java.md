# food/FoodService.java — 481 lines

Backs `/api/food`: food logging, a food search, and **photo → nutrition estimation** via the AI gateway.

| Method | Line | Notes |
|---|---|---|
| `estimateFromPhotoMulti(req)` | 71 | multi-dish estimate (~90 lines, the biggest method) — `POST /photo-estimate-multi` |
| `estimateFromPhoto(req)` | 261 | single-dish — `POST /photo-estimate` |
| `search(query)` | 200 | food lookup for the add-food form |
| `addEntry(userId, req)` | 208 | returns the refreshed `FoodSummaryResponse` |
| `deleteEntry(userId, entryId)` | 249 | also returns the refreshed summary |
| `summary(userId, date)` | 191 | the day's totals — what the Home food card reads |
| `photoHistory(userId)` | 171 | the "recent scans" list |
| `recordPhoto(userId, req)` | 178 | writes a `FoodPhotoLog` |

Both mutating entry methods return the whole day summary, so the frontend never needs a follow-up
GET after a write.

## Notes

- Photo estimation goes through `OpenAIClient` (Claude via Cloudflare). When it is unconfigured the estimate path must
  degrade gracefully rather than 500 — check that before changing the response shape.
- `FoodPhotoLog` is a lightweight log (not the image itself) powering `PhotoHistoryCard` in
  `scripts/dashboard.js`; the frontend also caches its own copy via `rememberPhotoFood` in app.js.
- These endpoints are behind `AiRateLimitInterceptor` (per-user limit on AI-backed routes).
- Entries are per (user, date); `FoodEntry` holds the nutrition columns.

DTOs: `FoodDtos`. Frontend: `openAddFood` in `scripts/app.js` (~1669), `FoodCard` / `ScreenFood` /
`PhotoHistoryCard` in `scripts/dashboard.js`.

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
