# scripts/notes.js — Notes (1252 lines)

Quick jottings with a rich-text editor. Exports `ScreenNotes` (~751), `sanitize` and `shrinkPhoto` (also used by family.js's photo scans). The screen owns
its own list (`onList()` on mount) rather than living in `state` — notes are read here and nowhere
else, so loading them at boot would buy a slower boot and nothing more.

| Piece | Line | What |
|---|---|---|
| `COLORS` / `colorOf` | 29 | the five swatches a note can wear, plus `null` = no colour. Same palette family as habits |
| `ALLOWED` / `DROP` | 47 / 72 | the allow-list: tag → attributes it may keep. Anything else is **unwrapped** (element dropped, text kept) so a paste from the web loses its markup, not its words. `DROP` is for elements whose text is not worth keeping — unwrapping a `<script>` would paste its source into the note |
| `sanitize(html)` | 97 | **the security boundary.** Runs on the way IN (before save) and on the way OUT (before paint), because a note saved by an older build never went through today's version. Walks a `DOMParser` document — inert, nothing executes — rather than pattern-matching a string. `<a>` keeps only `http(s)/mailto/#//` hrefs and gets `rel="noopener noreferrer"`. `<img>` keeps only `src`+`alt`, and only a `SAFE_IMG` src (base64 png/jpeg/webp/gif data URL) — a remote or SVG image is removed outright |
| `textOf(html)` | 144 | plain text, for the card preview and the "make a task" title |
| `altOf(file)` / `escAttr` / `searchTextOf(note)` | 155 / 163 / 169 | a new photo's alt comes from its file name (extension dropped, `-`/`_` as spaces, bare "image" gives none). Search reads title + text + every `img[alt]`, lowercased |
| `richEditor({html, placeholder, onInput})` | 311 | contenteditable + toolbar. Returns `{node, area, read(), focus()}`; `read()` is already sanitised. Toolbar buttons fire on **mousedown**, not click — by click time the caret has left the editor and the command applies to nothing. A keyboard press (click with `detail === 0`) runs too, and `run()` restores `lastRange` first, since tabbing to the button took the selection out of the editor. `styleWithCSS(false)` keeps `<b>`/`<i>` instead of `<span style>`, which sanitize() would strip. Paste is intercepted and sanitised so what lands is what saves, and the `style` attributes Chrome's `insertHTML` re-adds are stripped right after. A clipboard photo wins only when the HTML beside it has no text: Word/Excel/Notes put a PNG rendering of copied text on the clipboard too. `normalize()` clears the stray `<br>` a browser leaves behind when you delete the last character, which is what lets the CSS placeholder be a plain `:empty` test — no selector can tell one `<br>` from text-plus-a-`<br>`, since `:only-child` ignores text nodes |
| `NOTE_MAX` / `PHOTO_SIDE` / `shrinkPhoto(file)` | 208 | photos are embedded in the body as data URLs: each is redrawn on a canvas at ≤1280px, JPEG 0.82 (~200 kB), over white so a transparent PNG doesn't go black. `NOTE_MAX` is `NoteService.MAX_BODY` (2 MB) less 10 kB for the link attributes `sanitize()` adds and is checked as each photo goes in, and on HTML paste |
| `coverOf(body)` | 265 | the card's cover: first photo centre-cropped to 2:1 at 640x320 JPEG (25-50 kB), retried rougher if over `COVER_MAX` (60 kB = `NoteService.MAX_COVER`), `''` if it still won't fit or won't decode. Sent as `cover` on every create and update |
| photos in `richEditor` | — | `addPhotos(files)` is the one path for paste (`clipboardPhotos`: `files`, falling back to `items` for older Safari), drop and the toolbar's "Add a photo" picker. Lands at `lastRange` (collapsed, so it never replaces selected text) and bails if the editor was closed or hidden while the photo shrank. A new photo gets `.is-developing` (the develop-in animation); a clicked one gets `.is-picked` (selected whole, Backspace removes it). Both classes are stripped by `sanitize()` on read. A file drop is always `preventDefault`ed — otherwise a dropped PDF opens over the app. The toolbar's tag button (`describePhoto`, ~525) edits the picked photo's alt, else the last one clicked |
| `TOOLS` | 194 | bold, italic, underline, H2 (second press → paragraph), bullet + numbered list, link |
| `sheet(...)` | 659 | the note's own layout over `openOverlay` from `gb-kit.js` (which owns the overlay contract `a11y.js` looks for). Head row = title + `headActions` (where delete lives, as an icon); footer = Close + primary on one row |
| `colorRow(selected, onPick)` | 724 | swatch row; `null` is a real choice and gets a swatch of its own |
| `ScreenNotes` | 751 | composer (collapsed to one line until tapped), card grid, `NoteCard` (first photo becomes a 150px cover, `+N` chip for the rest, other photos stay inside the note), `togglePin`, `openNote` (edit sheet: title, editor, colour, pin, delete, make-a-task, add-a-reminder), `sortNotes`, `paint`. A search box above the grid (hidden with no notes) filters on every word, AND, via `searchTextOf` — debounced 150ms, and `filter()` only toggles `hidden` on the cards `paint()` built (rebuilding them re-decoded every cover and blinked). `togglePin` holds one request per note; a failed list load offers Try again The list endpoint keeps each photo's alt with its bytes stripped (`NoteDtos.altOnly`), so photo descriptions are searchable without opening a note |
| `_demo()` | 1215 | the runnable check, Vite DEV only — fourteen asserts on `sanitize` (incl. photo kept, photo attributes stripped, remote and SVG images dropped) (scripts dropped, handlers stripped, `javascript:` hrefs removed, links hardened, formatting and lists kept, unknown tags unwrapped, attributes stripped) |

**`document.execCommand` is deliberate** (`ponytail:` at `richEditor`). It is deprecated and
universally implemented; the replacement is "write your own document model over `beforeinput`",
which is a text-editor project, not a feature. The cost is bounded: fixed command set, output
through `sanitize()`, and the fallback if a browser ever drops it is a plain textarea. Photos went in
without one (they are just `<img>` through `insertHTML`). Reach for an editor library when notes
need tables, image resizing or collaboration.

**Rich text means storing HTML**, so `sanitize` is not optional decoration — it is why the body can
be handed to `innerHTML` at all. If you add a tag to `ALLOWED`, add an assert to `_demo()`.

Backend: `/api/notes` (list, GET `{id}`, POST, PATCH `{id}`, DELETE `{id}`) → `note/NoteService`
(soft delete; `""` clears a colour where `null` means "leave it alone"; 2 MB body cap). **List, POST and PATCH return the body with its photos cut out** (`bodyTrimmed`), plus `cover` and `photoCount`; `openNote` fetches `GET {id}` (`onGet`) before building the sheet whenever `bodyTrimmed` is set — editing the trimmed copy would save it back and delete the photos. The card shows `.is-opening` while that loads, and a placeholder cover (`.is-empty`) for a photo note with no saved cover,
covered by `NoteServiceTest`. Wiring: `SCREENS.notes` in `app.js`, `NAV_CATALOG` in `gb-kit.js`,
the "Note" row in the quick-add sheet, and the `notes` feature toggle in `FEATURE_DEFS`.
"Add a reminder" hands the text to the calendar via `prefillCalendarReminder` rather than growing a
second reminder form. Styles: `app.css` §"Notes — composer, rich-text editor, sticky cards".
