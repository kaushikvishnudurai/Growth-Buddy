# scripts/circle.js — Growth Circle (1294 lines)

Exports `ScreenCircle` (~939). People search + mentorship invites + circle challenges. Repaints its
own subtree (`paint()` ~1043). `refreshAll` (~1144) is the ONLY loader: it awaits outgoing and
incoming together and paints once. Loading them separately made the screen paint twice with half
the data and visibly jump, so don't reintroduce per-list refreshers.

| Piece | Line | What |
|---|---|---|
| `sectionSkeleton(rows)` | 10 | shimmer rows every section starts with. All three (Connections, Your invites, Challenges) used to render empty and then jump when their fetch landed |
| `PersonRow` | 35 | one person; returns `null` for `relationship: 'self'`. The two mentorship directions are INDEPENDENT, so it renders a slot each from `person.mentorLink` / `person.menteeLink` (`active` → status pill, clickable on the `mentorLink` side only, `pending` → pending pill, `none` → invite button). You can mentor someone *and* be mentored by them. |
| `showPartnerStatus` | 122 | a MENTEE's progress sheet, for their mentor. **One direction only** — a mentee gets no window on their mentor, like a manager seeing a report's board and not the reverse. `/connections/{id}/status` 403s the mentee side (`PartnerStatusAccessTest`), and the mentee can switch it off entirely in Settings → Account → Privacy (`shareProgress` in ui_prefs). The rows and the `mentorLink` pill just don't offer the tap; a refused load prints the server's message in the sheet's subtitle |
| `checkedToday` / `paintCheckPill` / `CheckPill` | 209 / 221 / 231 | the mentor's "Checked today" tick. `checkedAt` is stamped SERVER-side (`MentorshipService.markChecked`, called when the progress sheet loads) and compared against the reader's LOCAL day here — so no nightly job has to expire anything. `paintCheckPill` writes in place so opening the sheet flips the pill without a repaint |
| `statusLabel` / `STATUS_LABELS` | 237 | `pending` → "Invite pending", `accepted` → "Connected", `rejected` → "Declined" |
| `OutgoingRow` / `IncomingRow` | 243 / 315 | request rows with revoke / accept. On an accepted row the caller can open (i.e. a mentee's), the check pill REPLACES the "Connected" status pill — inside a card headed "You mentor", "Connected" says nothing the heading doesn't |
| `openSearchModal` | 393 | find-someone modal: `paintLoading` / `paintEmpty(msg, onRetry)` / `paintList` / `loadPeople`, plus browse. `paintList` drops `currentUserId` — the single choke point every list passes through, so you can never invite yourself |
| `openFormModal` | 556 | generic field-list modal |
| `ChallengesPanel` | 641 | circle challenges: `leaderboardRows`, `challengeBlock`, `startChallenge`, `newCircle`, `circleCard`, `refresh`, `openBrowse` |
| `openSheet` | 907 | bottom sheet wrapper |
| `openNoteModal` / `promptAndSend` | 954 / 1028 | send an invite with a note |
| `revokeAndRefresh` | 1032 | revoke an outgoing request |
| `launchSearch` | 1156 | entry point from the header |

Backend: `/api/mentorship` (requests, accept/reject/revoke, incoming/outgoing, connection status),
`/api/circles` (mine, join/leave, posts, challenges), `/api/users/search|browse` for the people list.
Challenge ranking is by habit check-ins completed (`CircleChallenge`).
`paint()` splits Connections into two cards — **You mentor** and **Who mentors you** — by the same
rule the rows use for the progress window (an offer you sent, or a request sent to you, makes you
the mentor). Empty groups are skipped; no connections at all still falls back to the single empty card.

Styles: `app.css` §"Circle (person rows + status pills)" (~975), `.gb-conn-group` + `.gb-check-pill`, §"Search modal" (~874),
§"Circle challenges + leaderboard" (~1476).
