# gcal/GoogleCalendarService.java — 393 lines

**Read-only** Google Calendar integration. OAuth "web" flow with the narrowest scope (read events).
Backs `/api/google/calendar` (`GoogleCalendarController`).

## Records (the wire shapes, lines 72–75)

```java
Status(boolean configured, boolean connected, String email)
EventDto(String id, String title, String date, String time)
EventsResponse(boolean connected, List<EventDto> events)
Config(boolean configured, String clientId, String redirectUri)   // never returns the secret
```

## Methods

| Method | Line | Notes |
|---|---|---|
| `requireAdmin(userId)` | 111 | guards `saveConfig` — only an admin may set the app's OAuth client |
| `isConfigured()` | 137 | any OAuth client saved at all |
| `config()` | 142 | client id + redirect URI for the Settings UI |
| `saveConfig(savedBy, clientId, clientSecret)` | 148 | persists `GoogleOauthSettings`; **secret is stored encrypted, never returned** |
| `connectUrl(userId)` | 167 | consent URL carrying a `state` that identifies the user |
| `handleCallback(state, code)` | 190 | exchanges the code, stores a `GoogleCalendarLink` per user |
| `status(userId)` | 214 | configured / connected / which account |
| `disconnect(userId)` | 220 | drops the link |
| `events(userId, YearMonth month)` | 233 | the month's events; returns `connected=false` rather than throwing when the user hasn't linked |

## Design notes

- **Two levels of setup:** the *app-wide* OAuth client (one row, `GoogleOauthSettings`, entered once
  from Settings by whoever runs the instance, admin-only) and the *per-user* link
  (`GoogleCalendarLink`, one row per connected user). `configured` vs `connected` in `Status` maps to
  exactly that distinction — don't collapse them.
- `state` is how the callback attributes the code to a user; the callback returns HTML (it's a
  browser redirect target, not JSON).
- Event parsing (all-day vs timed, timezone handling) is covered by
  `backend/src/test/java/com/growthbuddy/gcal/GoogleCalendarEventParsingTest.java` — **run/extend it
  when touching the parse path**; it's the only backend test in the repo.
- Frontend: the integration card in Settings (`app.css` §"Integration card", ~6816), plus
  `loadGoogleEventsForMonth` / `refreshGoogleEventsOnReturn` in `scripts/app.js` and the events shown
  in `scripts/calendar.js` and `MiniCalendarCard`.
