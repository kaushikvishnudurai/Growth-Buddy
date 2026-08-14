# food/FoodService.java — 481 lines

Backs `/api/food`: food logging, a food search, and **photo → nutrition estimation** via OpenAI.

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

- Photo estimation goes through `OpenAIClient`. When no API key is configured the estimate path must
  degrade gracefully rather than 500 — check that before changing the response shape.
- `FoodPhotoLog` is a lightweight log (not the image itself) powering `PhotoHistoryCard` in
  `scripts/dashboard.js`; the frontend also caches its own copy via `rememberPhotoFood` in app.js.
- These endpoints are behind `AiRateLimitInterceptor` (per-user limit on OpenAI-backed routes).
- Entries are per (user, date); `FoodEntry` holds the nutrition columns.

DTOs: `FoodDtos`. Frontend: `openAddFood` in `scripts/app.js` (~1669), `FoodCard` / `ScreenFood` /
`PhotoHistoryCard` in `scripts/dashboard.js`.
