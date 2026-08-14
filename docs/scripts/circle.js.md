# scripts/circle.js — Growth Circle (1164 lines)

Exports `ScreenCircle` (~824). People search + mentorship invites + circle challenges. Repaints its
own subtree (`paint()` ~929); refresh helpers `refreshOutgoing` (1004), `refreshIncoming` (1014),
`refreshAll` (1028).

| Piece | Line | What |
|---|---|---|
| `PersonRow` | 7 | one person; trailing control depends on `person.relationship`: `mentoring` / `mentee` → status pill (clickable, opens status), `pending` → pending state, `none` → offer/request buttons |
| `showPartnerStatus` | 75 | partner's shared progress sheet |
| `statusLabel` / `STATUS_LABELS` | 153 | `pending` → "Invite pending", `accepted` → "Connected", `rejected` → "Declined" |
| `OutgoingRow` / `IncomingRow` | 158 / 218 | request rows with revoke / accept |
| `openSearchModal` | 288 | find-someone modal: `paintLoading` / `paintEmpty(msg, onRetry)` / `paintList` / `loadPeople`, plus browse |
| `openFormModal` | 447 | generic field-list modal |
| `ChallengesPanel` | 526 | circle challenges: `leaderboardRows` (529), `challengeBlock` (547), `startChallenge` (566), `newCircle` (593), `circleCard` (612), `refresh` (674), `openBrowse` (741) |
| `openSheet` | 792 | bottom sheet wrapper |
| `openNoteModal` / `promptAndSend` | 839 / 913 | send an invite with a note |
| `revokeAndRefresh` | 917 | revoke an outgoing request |
| `launchSearch` | 1033 | entry point from the header |

Backend: `/api/mentorship` (requests, accept/reject/revoke, incoming/outgoing, connection status),
`/api/circles` (mine, join/leave, posts, challenges), `/api/users/search|browse` for the people list.
Challenge ranking is by habit check-ins completed (`CircleChallenge`).
Styles: `app.css` §"Circle (person rows + status pills)" (~975), §"Search modal" (~874),
§"Circle challenges + leaderboard" (~1476).
