# scripts/notes.js — Notes (694 lines)

Quick jottings with a rich-text editor. Exports `ScreenNotes` (~390) and `sanitize`. The screen owns
its own list (`onList()` on mount) rather than living in `state` — notes are read here and nowhere
else, so loading them at boot would buy a slower boot and nothing more.

| Piece | Line | What |
|---|---|---|
| `COLORS` / `colorOf` | 10 | the five swatches a note can wear, plus `null` = no colour. Same palette family as habits |
| `ALLOWED` / `DROP` | 25 / 38 | the allow-list: tag → attributes it may keep. Anything else is **unwrapped** (element dropped, text kept) so a paste from the web loses its markup, not its words. `DROP` is for elements whose text is not worth keeping — unwrapping a `<script>` would paste its source into the note |
| `sanitize(html)` | 52 | **the security boundary.** Runs on the way IN (before save) and on the way OUT (before paint), because a note saved by an older build never went through today's version. Walks a `DOMParser` document — inert, nothing executes — rather than pattern-matching a string. `<a>` keeps only `http(s)/mailto/#//` hrefs and gets `rel="noopener noreferrer"` |
| `textOf(html)` | 109 | plain text, for the card preview and the "make a task" title |
| `richEditor({html, placeholder, onInput})` | 150 | contenteditable + toolbar. Returns `{node, area, read(), focus()}`; `read()` is already sanitised. Toolbar buttons fire on **mousedown**, not click — by click time the caret has left the editor and the command applies to nothing. `styleWithCSS(false)` keeps `<b>`/`<i>` instead of `<span style>`, which sanitize() would strip. Paste is intercepted and sanitised so what lands is what saves |
| `TOOLS` | 130 | bold, italic, underline, H2 (second press → paragraph), bullet + numbered list, link |
| `sheet(...)` | 249 | local modal wrapper (same overlay contract `a11y.js` looks for: `.gb-modal-overlay > .gb-modal[role=dialog]`). Head row = title + `headActions` (where delete lives, as an icon); footer = Close + primary on one row |
| `colorRow(selected, onPick)` | 309 | swatch row; `null` is a real choice and gets a swatch of its own |
| `ScreenNotes` | 334 | composer (collapsed to one line until tapped), card grid, `NoteCard`, `togglePin`, `openNote` (edit sheet: title, editor, colour, pin, delete, make-a-task, add-a-reminder), `sortNotes`, `paint` |
| `_demo()` | 668 | the runnable check, Vite DEV only — ten asserts on `sanitize` (scripts dropped, handlers stripped, `javascript:` hrefs removed, links hardened, formatting and lists kept, unknown tags unwrapped, attributes stripped) |

**`document.execCommand` is deliberate** (`ponytail:` at `richEditor`). It is deprecated and
universally implemented; the replacement is "write your own document model over `beforeinput`",
which is a text-editor project, not a feature. The cost is bounded: fixed command set, output
through `sanitize()`, and the fallback if a browser ever drops it is a plain textarea. Reach for an
editor library when notes need tables, images or collaboration.

**Rich text means storing HTML**, so `sanitize` is not optional decoration — it is why the body can
be handed to `innerHTML` at all. If you add a tag to `ALLOWED`, add an assert to `_demo()`.

Backend: `/api/notes` (list, POST, PATCH `{id}`, DELETE `{id}`) → `note/NoteService`
(soft delete; `""` clears a colour where `null` means "leave it alone"; 64 kB body cap),
covered by `NoteServiceTest`. Wiring: `SCREENS.notes` in `app.js`, `NAV_CATALOG` in `gb-kit.js`,
the "Note" row in the quick-add sheet, and the `notes` feature toggle in `FEATURE_DEFS`.
"Add a reminder" hands the text to the calendar via `prefillCalendarReminder` rather than growing a
second reminder form. Styles: `app.css` §"Notes — composer, rich-text editor, sticky cards".
