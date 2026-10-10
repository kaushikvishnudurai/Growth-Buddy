# scripts/mentor.js — Buddy chat screen

Exports `ScreenMentor({api, threadId, starter})` and the pure helpers `richParts`, `crisisMatch`,
`parseSse`, `actionChips`, `streamVisible`, `streamFailure` (checked by `node scripts/mentor.test.mjs`). Lazy-loaded
from app.js's `SCREENS.mentor`, which passes `api: mentorApi()` — `get(threadId?)` (none → `/api/mentor/chat`,
the newest thread; a 404 falls back to it), `post/stream(…, threadId)` → `/api/mentor/threads/{id}/messages[/stream]`,
`clear(threadId)`, `threads {list, create, rename, remove}`, `onThread(id)` (app.js remembers it in
memory, `mentorThreadId`), `act {task, habit, reminder}`, `today`, `reflection {label, open}`. Backend side of the stream: CODEMAP §"Streamed Buddy
replies".

## Pure helpers (top of file)

| Symbol | What |
|---|---|
| `RICH` / `richParts(text)` | tiny markdown → `[{type: 'b'｜'i'｜'t', text}]`. `**bold**`, `*italic*` **only when the asterisks hug the words** — `2 * 3 * 4` and `a * b` stay plain (they used to render as `<em>`). An italic never spans a line |
| `renderRich(text)` | `richParts` → a DocumentFragment of text / `<strong>` / `<em>`. Newlines are kept by CSS, not `<br>` |
| `CRISIS` / `crisisMatch(text)` | regex over the user's **own** message, before it is sent. Leans wide on purpose (a false positive costs one card, a miss costs more). Runs on-device, independent of the model, the network or AI being configured |
| `crisisCard()` | helpline card (Tele-MANAS 14416, US 988, findahelpline.com) appended under the user's bubble. **Never sent or saved** — it is DOM only, and a Retry removes it with the failed row |
| `parseSse(buf)` | buffered SSE text → `{events: [{event, data}], rest}`. `rest` is the partial event still waiting for its blank line — the caller prepends it to the next chunk. `data` is JSON-parsed; a non-JSON event is **dropped**, not fatal. `:` lines are keep-alives. CRLF normalised |
| `actionChips(actions)` | `message.actions` (server-parsed, MentorActions.java) → ≤3 chip descriptors `{type, label, icon, title, time, aria}`; unknown types, blank titles, repeats and non-HH:MM times dropped |
| `streamVisible(text)` | what a streaming bubble shows: everything before the first ````` (the actions fence), and a trailing half-arrived `` ` `` / ` `` ` held back. The saved reply never has the fence — the server strips it |
| `actionsRow(actions, onAction)` / `bubble(role, content, actions, onAction)` / `typingBubble()` | the chips row; message row (a bot row is avatar + `.gb-msg-col` = bubble + chips) / the three-dot "Buddy is typing" row |

## `ScreenMentor` — inner functions

Owns its thread and messages locally so a keystroke never round-trips global state.

| Fn | What |
|---|---|
| `syncChipState` | send / Stop / Clear enablement. While `stopCtl` is set the send button is **hidden and Stop shows** |
| `renderMessages(msgs)` | whole-list paint — **first load and clear only**. Empty → "Talk to Buddy" welcome + 3 suggestion buttons |
| `append(node)` | everything else. Removes the welcome if showing |
| `load()` | GET. A failure shows **only** the error + Retry (`.gb-mentor-loadfail`), chips hidden — the welcome under an error used to invite a send into a chat that never loaded. `loaded` gates send |
| `failRow(message, onRetry)` | error + Retry under a failed send |
| `streamReply(text, typing)` | reads `api.stream(text, signal)` with a `ReadableStream` reader + `parseSse`. `delta {text}` → plain `textContent` (no rich render mid-stream: half a `**` would flash); `done {message, userMessage}` → `renderRich`, resolves; `error {status, message}` → throws with the server's words. Every other break goes through `streamFailure(err, got, row)` (exported, tested): once any word arrived, a close without `done`, a Stop (`AbortError`) or a network `TypeError` mid-read all throw `{partial, row}` (+`stopped` for Stop); the server's `error` event and a break before the first word pass through, and an empty assistant row is removed |
| `send()` | appends user bubble, crisis card if `crisisMatch`, typing bubble. Tries `streamReply` when `api.stream` exists; **only an error carrying `.fallback`** (no response, 404/405, not `text/event-stream` — thrown by app.js `apiStream`) drops to `api.post`; a 429 or Stop does not |
| `clearAll()` | `confirmDialog` → `api.clear(threadId)` → `renderMessages([])` |
| `setTitle` / `refreshTitle` | the thread bar's name; `refreshTitle` re-reads the list after a send into a thread still on a starting title (the server auto-titles it) |
| `switchTo(id, title)` / `newChat()` | change thread and `load()`. Refused while `busy`; `load()` ignores a reply for a thread no longer open (`asked !== threadId`) |
| `openThreads()` / `threadRow(t, close, onGone)` | the chats sheet (`openModal`, primary = New chat): pick, inline rename (Enter / Escape / blur, kept from the sheet's own Enter), **two-tap delete** (no stacked confirm); the open chat deleted → the newest. Footer: "Evening reflection: …" → Settings › Alerts |
| `openActionSheet(chip)` | a chip's confirm sheet, prefilled (title; date + time for a reminder, optional daily reminder for a habit). Save → `api.act.*`; a past date / time is a `fieldRefusal` under the field |

## Invariants

- **`cache` holds only what the server has.** A failed send's bubble is never pushed (it used to be
  cached as if Buddy had said "something glitched").
- **Partial reply** (Stop or a dropped line after some words): the server already saved those words,
  so the bubble stays, is rich-rendered and cached as Buddy's, and there is **no Retry** — it would
  ask the same question twice. A non-Stop partial adds an error line.
- **Stop before any word** lands on the failure path: the server deleted the user's message again,
  so it is offered back with Retry (no `console.error` for a Stop).
- Offline (`navigator.onLine`) fails fast with `OFFLINE`, for both load and send.
- a11y: the list is `role=log` + `aria-live=polite`, which is why a send **appends** rather than
  repainting (a repaint re-reads the conversation). Enter sends, Shift+Enter is a newline.

- **A send is pinned to its thread** (`sendThread`): the thread buttons are disabled while `busy`, so a reply can't land in a chat you switched to.
- **`starter`** (evening reflection) prefills the composer once, after the first load; it is never auto-sent.

Styles: `app.css` (`.gb-msg-*`, `.gb-mentor-*`, `.gb-thread-*`).
