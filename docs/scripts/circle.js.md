# scripts/circle.js — Growth Circle

Exports `ScreenCircle`. People search + mentorship invites + circle challenges. Repaints its
own subtree (`paint()`). `refreshAll` is the ONLY loader: it awaits outgoing and
incoming together and paints once. Loading them separately made the screen paint twice with half
the data and visibly jump, so don't reintroduce per-list refreshers.

| Piece | What |
|---|---|
| `sectionSkeleton(rows)` | shimmer rows every section starts with. All three (Connections, Your invites, Challenges) used to render empty and then jump when their fetch landed |
| `PersonRow` | one person; returns `null` for `relationship: 'self'`. The two mentorship directions are INDEPENDENT, so it renders a slot each from `person.mentorLink` / `person.menteeLink` (`active` → status pill, clickable on the `mentorLink` side only, `pending` → pending pill, `none` → invite button). You can mentor someone *and* be mentored by them. |
| `showPartnerStatus` | a MENTEE's progress sheet, for their mentor. **One direction only** — a mentee gets no window on their mentor, like a manager seeing a report's board and not the reverse. `/connections/{id}/status` 403s the mentee side (`PartnerStatusAccessTest`), and the mentee can switch it off entirely in Settings → Account → Privacy (`shareProgress` in ui_prefs). The rows and the `mentorLink` pill just don't offer the tap; a refused load prints the server's message in the sheet's subtitle |
| `checkedToday` / `paintCheckPill` / `CheckPill` | the mentor's "Checked today" tick. `checkedAt` is stamped SERVER-side (`MentorshipService.markChecked`, called when the progress sheet loads) and compared against the reader's LOCAL day here — so no nightly job has to expire anything. `paintCheckPill` writes in place so opening the sheet flips the pill without a repaint |
| `statusLabel` / `STATUS_LABELS` | `pending` → "Invite pending", `accepted` → "Connected", `rejected` → "Declined" |
| `RequestRow` | a PENDING invite addressed to me, with Accept / Decline (`onRespond`, the same endpoints as the bell). Painted into `requestsEl`, the "Requests for you" card above Connections, which renders nothing at all when there are none |
| `OutgoingRow` / `IncomingRow` | request rows with revoke / accept. On an accepted row the caller can open (i.e. a mentee's), the check pill REPLACES the "Connected" status pill — inside a card headed "You mentor", "Connected" says nothing the heading doesn't |
| `localISO` / `shortDay` | the reader's local day as `YYYY-MM-DD` (date inputs, upcoming checks: string compare orders them) / a short weekday label |
| `askNudge` | Cheer / Nudge form (optional line, 140 chars) → `mentorshipApi.nudge`. The server caps it at 3 a day per sender per link (429), and the form's toast shows that message |
| `openChat` | the thread sheet for one accepted link: `role=log` + `aria-live=polite`, newest 50 then "Load older" (`?before=` the oldest held), composer (Ctrl/Cmd+Enter sends). Partner lines arrive live via `gb:mentorship-message` (app.js re-dispatches the server's transient `mentorship_message` frame), deduped by id; the listener goes in `openOverlay`'s `onClose`. Cheers/nudges show as centered event lines |
| `WeekCard` | the mentor's "This week": the mentee's check-ins Monday to today (their zone) vs last week, and top-5 streaks. `shared: false` (mentee's progress sharing off) shows only a one-liner — the server never sends the numbers |
| `LinkExtras` | under every accepted connection (`gb-conn-item` wraps row + extras): the agreement (either side edits, `PUT {id}/agreement`), Cheer / Nudge / Message, and — mentor side only — This week (refetched on every open) |
| `openSearchModal` | find-someone modal: `paintLoading` / `paintEmpty(msg, onRetry)` / `paintList` / `loadPeople`, plus browse. `paintList` drops `currentUserId` — the single choke point every list passes through, so you can never invite yourself. The typed search stamps each keystroke with `seq`; a server answer for an older query is dropped |
| `openFormModal` | generic field-list modal; field types text/number/date, `checkbox`, and `select` (`options: [{value, label}]`) |
| `ChallengesPanel` | circle challenges: `METRICS` / `metricOf` (label, unit and empty text per `metric`; no metric = habit check-ins), `leaderboardRows`, `challengeBlock` (Active / Upcoming / Ended; says how many members keep progress private — `hiddenCount`), `startChallenge` (what counts + a start date, today or later), `newCircle` (Private checkbox → `visibility: 'private'`), `joinWithCode`, `circleCard`, `addCard`, `removeCard`, `refresh`, `openBrowse` (holds the join-with-code button, since private circles are never listed). An action touches only its card: a new challenge reloads that card's list, a new or joined circle is appended (`addCard`); `refresh` is the initial load and the error retry only |
| `openCircleMenu` / `openMembers` | the card's ⋯ sheet: the private code (members only), Members (owner: Make owner / Remove), and Leave — or Delete for the owner, who can't leave |
| `PostsFeed` / `PostRow` | the circle's posts, opened by the card's Posts button (lazily — one fetch per opened card): composer + newest 50 + "Load older" (`?before=` the oldest held). Each post: a kudos toggle (`gb-kudos`, `aria-pressed`; one per member, server-enforced by the `(post_id, user_id)` key) and, for its author or the circle's owner, delete |
| `openSheet` | bottom sheet wrapper |
| `openNoteModal` / `promptAndSend` | send an invite with a note |
| `revokeAndRefresh` | revoke an outgoing request |
| `launchSearch` | entry point from the header |

Backend: `/api/mentorship` (requests, accept/reject/revoke, incoming/outgoing, connection status;
and `MentorshipChatController`: `{id}/nudge`, `{id}/messages`, `{id}/agreement`, `{id}/week`, where
`{id}` is the accepted request's id), `/api/circles` (mine, join/leave, posts + kudos + delete,
challenges), `/api/users/search|browse` for the people list. Wired in app.js as `mentorshipApi` and
`challengesApi`. Challenge ranking is by the challenge's `metric` (`ChallengeMetrics`: habit check-ins,
focus minutes, water-goal days); members with `shareProgress` off are left off the board
(`ProgressSharing`, the switch the mentor window and the weekly card read).
**Live:** the screen listens for `gb:circle-changed` (app.js re-broadcasts every mentorship push)
and runs `refreshAll`; the listener retires itself once the screen has been mounted and is gone.
Server-side, `MentorshipService.checkCanInvite` refuses an invite on a side that is already
accepted or pending (either sender — the mirror case), and for 7 days after the other person
declined; declined/cancelled rows drop out of the lists after 7 days (`visible`).
`paint()` splits Connections into two cards — **You mentor** and **Who mentors you** — by the same
rule the rows use for the progress window (an offer you sent, or a request sent to you, makes you
the mentor). Empty groups are skipped; no connections at all still falls back to the single empty card.

Styles: `app.css` §"Circle (person rows + status pills)", `.gb-conn-group` + `.gb-check-pill`, §"Search modal",
the "Circle: Requests for you, the card's tools/feed" block after `.gb-browse-row`, then the kudos /
connection extras / weekly card / chat sheet block right after `.gb-circle-code`,
§"Circle challenges + leaderboard".
