# abyss-console

The ABYSS page — one self-contained HTML file with the whale art, the permission-gated
MCP engine, the DeepSeek chat, the cost meter and the daily-idea button.

## Run the helper

    node abyss-bridge.mjs                 # serves the page on http://127.0.0.1:8787
    node abyss-bridge.mjs --port 8788     # another port
    node abyss-bridge.mjs --page /path/to/deepseek-api-console.html

The page alone does chat and daily ideas. The helper adds what a web page cannot do:
reach your MCP room (the room refuses calls from a browser), read files in bulk, and run
commands you approve. It onboards into the room as `abyss-webapp` and keeps its own onboarding token
under `~/.local/share/` (override with `ROOM_TOKEN_FILE`). Closing the tab asks the helper to stop
(a `pagehide` beacon, only from a page the helper itself served); macOS starts it again on the next
visit. The room link is dropped after about 75 seconds of quiet and reconnects on the next call —
that pause is the reconnect, not a hang.

Routes: `/` the page · `/health` · `/room/status` · `/room/servers` · `/room/tools?q=` ·
`/room/call` · `/mcp` (a plain MCP endpoint, so the page's gate and approval system works) ·
`/fs/tree` · `/fs/read` · `/fs/search` · `/attach?path=…&ocr=1` · `/attach/folder?path=…`.

Everything except `/` and `/health` requires the helper's per-install token. It is generated
once into `~/.abyss-console/token` (mode 0600; `ABYSS_TOKEN_FILE` overrides the path) and
injected only into the page the helper serves — so calls from `http://127.0.0.1:8787/` just
work, and a page from any other origin is refused, including other local ports and opaque
origins, preflight included. The request host must also match the helper, and the token-bearing
page cannot be framed or cached. A `file://` copy of the
page carries no token and cannot use the helper's routes.
When using `--port`, the served page connects to that same port automatically.

## Attachments

The paperclip in the composer opens the attach tray: choose files from the browser, or name a path
or a whole folder for the helper to read. Conversions, all verified against real files:

| what | how it is read |
| --- | --- |
| code, text, csv, json, logs | read as text |
| pdf | `pdftotext`; if the file is a scan (no text layer, has pictures) the first pages are rendered with `pdftoppm` and read with OCR |
| word, rtf, odt, html | `textutil` |
| excel, powerpoint | unzipped and the text pulled out |
| pictures, screenshots | sent as picture data the model reads natively (about 1024 tokens each) |
| scanned pages, screenshots of text | `tesseract` when the OCR box is ticked |
| audio and video | refused, with the reason: DeepSeek takes text and pictures only |
| a whole folder | walked with ignore rules, documents included, capped by a token budget you can set, and it says what it left out |

Every attachment shows its size and token count in the tray, with the off-peak cost of the whole
batch before you send. A failed lookup never leaves a half-attached message.

In the page: Settings → *Local helper — your MCP room* → **detect**, then
**use as the MCP endpoint**, then **connect**. Tools then run through the same four gates
as before (PLAN blocks, ASK ALWAYS prompts, ASK WHEN NEEDED auto-runs read-only work, YOLO runs).

## Build

    node build.mjs                 # -> dist/deepseek-api-console.html
    node build.mjs --install       # also writes ~/deepseek-api-console.html
    node build.mjs --check         # parse-check every piece, write nothing
    node build.mjs --no-art        # a copy without the picture (for reading tests)
    node build.mjs --api-base URL  # test build pointed at a stand-in for DeepSeek

## Test

    node --test tests/roi.unit.mjs   # the daily-idea rules, no network at all
    node tests/roi.e2e.mjs           # the three-try ladder in a real browser (needs a stand-in)
    node tests/dc-gate.e2e.mjs       # the 66 permission-gate assertions, unchanged
    node --test tests/helper.e2e.mjs # the helper: serves the page, onboards, calls the room
    node --test tests/attach.e2e.mjs # every common file type, pictures, OCR, folders
    node --test tests/redact.unit.mjs # the secret scrubber
    node --test tests/files.e2e.mjs  # writing, undoing and running commands

`tests/roi.e2e.mjs` and `tests/features.e2e.mjs` drive a real browser against a stand-in service, so
build the test page first: `node build.mjs --api-base http://127.0.0.1:8899`.

`tests/roi.e2e.mjs` needs the test build first:

    node build.mjs --api-base http://127.0.0.1:8899
    node tests/roi.e2e.mjs

## What is where

    src/shell.template.html   the page skeleton, with four placeholders
    src/vendor.min.js         React 18.3.1 + react-dom, shortened, not edited by hand
    src/app.js                the page's own code, written out to be read and edited
    src/roi-engine.js         the daily-idea rules (globalThis.AbyRoi)
    src/mcp-engine.js         the permission-gate engine (globalThis.DCEngine), unchanged
    src/skin.css              the whale picture and the see-through surfaces
    assets/background.webp    the picture that gets embedded (3072x1729, from the TIFF source)
    assets/background-source.tiff  the original art, kept locally (21 MB, not committed)
    assets/background-compare.jpg  the JPEG conversion, for side-by-side comparison
    baseline/                 the page as it was before this refactor
    abyss-bridge.mjs          the local helper (page + room + filesystem + run)
    tests/                    the four test files

## A project: map, budget, search, file lookups

Above the composer sits the project bar. Point it at a folder and press **index**: the helper walks
it and the page reports what a whole-text send would cost ("24 files · 25.7 MB · ~176,745 tokens if
sent whole (≈ $0.0265 off-peak)"). The walk respects the project's own `.gitignore` at its root:
what you would not commit, the map does not index.

The bar also says when it was indexed ("· indexed 03:42"), and it watches for drift cheaply: every
file the walk returns carries its modification time, and coming back to the tab compares the newest
one with the one you indexed. Files changed — the row turns amber with "files changed — press
re-index", and the **re-index** button in the project bar walks the folder again.

- **attach map** puts a compact map in the next message: directories, the most **relevant** files
  (names you have used, recent edits, shallowness — ★ marks the top three), sizes and kinds, plus
  the token arithmetic. Cheap (264 tokens for this project) and it is what tells the model which
  paths exist. If the walk hits its cap, the map says the listing is cut and how much of it is
  shown.
- **search** runs a plain-text search across the project and lists `file:line` hits; clicking one
  attaches that file.
- With a project indexed, the model is offered three tools: `read_project_files` (the paths it saw on
  the map, up to 24 files, 512 kB each), `search_project` (plain-text search, `file:line` hits) and
  `find_references` (where a name is used, matching lines included — what makes a rename safe to do).
  The page runs them through the helper and returns the results as tool messages.

## Git: status, diffs, staging, commits

With a project indexed, the panels carry a git row: the branch and short head, the change list as
chips (click one for its diff against HEAD), **refresh**, **stage all**, **stage this file** from
inside the diff, and a commit box — the commit button is the explicit action, and the helper refuses
to stage or commit without `confirm: true`. The same facts ride in every request: the system message
carries `## GIT: branch <name> at <hash> · N uncommitted changes: <paths>`, so the model can see
what is not committed yet.

## Writes, undo and running commands

A reply that says `### file: <path>` and then a fenced block is treated as a proposal: a card
appears with **compare** (a real line diff against what is on disk now: red and green rows with
context lines, and a warning when a rewrite would delete more than it adds), **write**, and
**undo**. Nothing is written until you press it. Every write keeps a copy of what was there first,
listed in `~/.cache/abyss-bridge/writes.jsonl`, and undo restores it — or removes the file again
if it did not exist before. The build contract asks the model for a unified diff on files that
already exist (the patch card checks and applies it hunk by hunk — a hunk that has drifted within
8 lines, or whose context only differs by trailing spaces, still lands, and the card says where;
a hunk that fits nowhere near is refused with what it expected and what is there instead, never
forced); `### file: <path>` — or a bold filename line — is the form for files that do not exist yet.

A whole-file write to a big file (over 200 lines) that would remove more than 20 of them asks
twice: the first press only arms the button — *write anyway (removes N)* — and says why, so a
model that never saw the tail cannot silently drop it on one click.

The verify bar runs a command in the project folder through the helper. The helper refuses to run
anything unless the request says `confirm: true`, so nothing executes behind your back. The output
and the exit code land in the chat as a message, which is what the model needs to fix a failure.
**apply & fix** does the whole round-trip in one press: it applies what the last reply proposed
(write blocks or a unified diff — every write is journaled and undoable), runs the command, hands a
failure back to the model with the output, and repeats — up to three rounds, with a per-round log
in the chat and a **stop** button that aborts the round in flight. The verify box takes one command
per line; the loop runs them in order, reports each one, and stops at the first failure.

## The cost governor and routing

Above the composer: **today's spend against your daily budget** ("today $0.000048 of $0.5000",
with a "nearly spent" note past 80%). When the budget is reached the page stops before calling: a
red line explains it and **no request leaves the machine**. The counter is keyed to the date, so it
resets tomorrow. This meter is the only always-visible cost number; **cost ▾** shows what the next
send will cost, and each turn keeps its forecast-vs-actual line in the chat as the record. Set the
amount in Settings; `0` means no limit. The row that carries it stays thin on purpose — the panels
toggle, the project, and this one number; session, model, routing, pins, verify and index live one
click away behind **panels**.

A task can also carry its own budget: the task row shows what it has spent, and a number you set
beside it (0 is off) stops both sending and the tool loop once the spend reaches it — so "this task
may spend a cent" is a real ceiling, not a hope.

Next to it, three routing presets — **cheap & cheerful** (flash, thinking off), **everyday coding**
(flash, thinking high), **hard reasoning** (v4-pro, thinking high) — and **second opinion from pro**,
which hands your last exchange to the big model and asks it to be blunt about what is wrong.

## Secrets

Text in chat requests is scrubbed at the moment the request is assembled — the draft,
text attachments, pinned text, tool results, reasoning and replayed tool arguments alike — catching `sk-…` keys, AWS/GitHub/Slack/Google
tokens, private key blocks, passwords in connection strings, and anything written as `api_key=…`,
`password=…`, `token: …` or `Authorization: Bearer …`. The count appears above the composer, and
the scrubber can be switched off in Settings. What it catches is listed in the unit test.
This pattern-based scrubber does not inspect image contents or guarantee detection of every secret.

## The working set: forecast, comparison, pins, traces

- **Forecast against the bill** — before a turn the page says what it expects to spend and what it
  assumed ("2,698 tokens in, assuming 0% cache hits, and 4,000 tokens out"); after the turn it
  prints the actual and the difference. The hit ratio comes from the session's own cache record;
  a session with no history says "cold session — worst case" instead of pretending precision.
- **compare flash vs pro** — the same question to both models at once, side by side, each with its
  own price and token count, and a button to keep whichever answer you prefer. While both calls run
  the button becomes **cancel compare**, and stopping it leaves "cancelled" in both panels.
- **Pinned context** — pin a file and its text is prepended to the system message, which is the
  cached part of the request: paid once, then a hit. The row shows the session hit-rate beside it.
  A pin also remembers the path it was read from and its age (on the chip), and coming back to the
  tab compares it with the file on disk: changed files turn amber — "changed on disk" — and one
  click on **↻** re-reads them in place.
- **trace…** — paste a stack trace or failing output; the page pulls the paths out of it, matches
  them against the indexed project, and either attaches exactly those files or hands the lot to the
  model with a request for a patch.
- **sent ▾** — the last five request bodies exactly as they went out (after scrubbing): model,
  message and tool counts, the full JSON, and a copy button each. The answer to "why did it answer
  that" without reading storage by hand.
- **the task list** — for work that spans turns we keep a plan, not a transcript: the model sets a
  goal and ordered steps through a `task_update` tool, the page shows them (each step toggles done),
  and every request carries `## TASK: …` — so the model reads its own plan instead of re-deriving it.
- **⌘K / Ctrl-K** — a command palette over the things you do most: new chat, sessions, cost
  breakdown, the sent inspector, the change journal, run verify, apply & fix, both compare actions,
  trace, index, settings. Type to filter, Enter runs the first match, Escape closes.

## Sessions and recipes

**Sessions.** Name the current chat, press *save*, and it is kept with its date, its project, its
message count and what it cost. *open (n)* lists them and searches them — by name, by project, or by
anything said inside them. *export* writes the whole thing as a Markdown file with a per-message
table and the cost it ran up. *new* clears the chat without touching anything saved. Saving an open
session again updates it **in place** (same entry — no clones), a **current:** chip shows which
session you are in, and *open (n)* opens sessions as **tabs**: switch between them, close one with ×,
and the saved copy stays on disk.

**The whole library, in one file.** *export library* downloads every saved session and recipe as
`abyss-library-<date>.json`; *import library* reads such a file back from a path you paste and merges
it by id onto the disk copy — the same ids update, new ones are added.

**Recipes.** In Settings, keep an instruction under a name ("house style", "commit message rules").
Clicking one puts its text in the composer, ready to edit or send.

**Fill-in-the-middle.** Every code block has a *finish it* button: it sends the block to the cheap
beta endpoint (`/beta/completions`, non-thinking, `max_tokens 220`) and shows what the model added
beneath, with a *copy the whole thing* button. That is the autocomplete path the cheat sheet
describes, on the model that costs $0.60 per million output tokens.

## Test files

    tests/roi.unit.mjs      the daily-idea rules (13)
    tests/redact.unit.mjs   the secret scrubber (8)
    tests/helper.e2e.mjs    the helper: page, room onboarding, 49 servers, /mcp (7)
    tests/attach.e2e.mjs    every common file type, pictures, OCR, folders (11)
    tests/files.e2e.mjs     write, undo, run (6)
    tests/dc-gate.e2e.mjs   the four permission gates (66 assertions)
    tests/roi.e2e.mjs       the three-try ladder in a browser (3 runs)
    tests/features.e2e.mjs  library on disk + tags + matching lines, forecast vs bill,
                            model comparison, pinned context, trace triage, recipes, fill-in-the-middle

## Changing things

- A number or a default: look for `DEFAULT_SETTINGS`, `PRICES`, `STORAGE_KEYS` in `src/app.js`.
- The daily-idea contract (what the model must return): `SYSTEM_CONTRACT` in `src/roi-engine.js`.
- The look: `APP_CSS` and the `STYLES` object in `src/app.js`, plus `src/skin.css`.
- Then rebuild. The page is one file again; nothing else to install.

## Notes

- The daily-idea run makes at most three calls: flash, flash again with the exact problems
  quoted back, then deepseek-v4-pro (only while the live model list still offers it).
  A failed attempt is never saved as an idea.
- Prices in `PRICES` are off-peak; peak hours (01:00-04:00 and 06:00-10:00 UTC, Mon-Fri) bill 2x
  and the page doubles every figure itself.
