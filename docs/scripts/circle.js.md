# scripts/circle.js — Growth Circle (1210 lines)

Exports `ScreenCircle` (~855). People search + mentorship invites + circle challenges. Repaints its
own subtree (`paint()` ~962). `refreshAll` (~1041) is the ONLY loader: it awaits outgoing and
incoming together and paints once. Loading them separately made the screen paint twice with half
the data and visibly jump, so don't reintroduce per-list refreshers.

| Piece | Line | What |
|---|---|---|
| `sectionSkeleton(rows)` | 16 | shimmer rows every section starts with. All three (Connections, Your invites, Challenges) used to render empty and then jump when their fetch landed |
| `PersonRow` | 35 | one person; returns `null` for `relationship: 'self'`. The two mentorship directions are INDEPENDENT, so it renders a slot each from `person.mentorLink` / `person.menteeLink` (`active` → clickable status pill, `pending` → pending pill, `none` → invite button). You can mentor someone *and* be mentored by them. |
| `showPartnerStatus` | 96 | partner's shared progress sheet |
| `statusLabel` / `STATUS_LABELS` | 174 | `pending` → "Invite pending", `accepted` → "Connected", `rejected` → "Declined" |
| `OutgoingRow` / `IncomingRow` | 179 / 239 | request rows with revoke / accept |
| `openSearchModal` | 309 | find-someone modal: `paintLoading` / `paintEmpty(msg, onRetry)` / `paintList` / `loadPeople`, plus browse. `paintList` drops `currentUserId` — the single choke point every list passes through, so you can never invite yourself |
| `openFormModal` | 472 | generic field-list modal |
| `ChallengesPanel` | 557 | circle challenges: `leaderboardRows` (560), `challengeBlock` (578), `startChallenge` (597), `newCircle` (624), `circleCard` (643), `refresh` (705), `openBrowse` (772) |
| `openSheet` | 823 | bottom sheet wrapper |
| `openNoteModal` / `promptAndSend` | 870 / 944 | send an invite with a note |
| `revokeAndRefresh` | 948 | revoke an outgoing request |
| `launchSearch` | 1053 | entry point from the header |

Backend: `/api/mentorship` (requests, accept/reject/revoke, incoming/outgoing, connection status),
`/api/circles` (mine, join/leave, posts, challenges), `/api/users/search|browse` for the people list.
Challenge ranking is by habit check-ins completed (`CircleChallenge`).
Styles: `app.css` §"Circle (person rows + status pills)" (~975), §"Search modal" (~874),
§"Circle challenges + leaderboard" (~1476).
