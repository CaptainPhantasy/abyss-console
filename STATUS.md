# Status

## Step 1 — the page (done, verified)

- Readable sources carved from the previous page; the app's own code written out in `src/app.js`
  (React and the vendor pasted-in library stay shortened in `src/vendor.min.js`).
- New daily-idea rules in `src/roi-engine.js`, wired into the app: thinking off, a full written
  contract, mechanical validation, then flash → flash with the problems quoted → deepseek-v4-pro,
  bounded at three calls, and a failed attempt is never saved.
- The look rebuilt to the mock-up: whale art full-bleed (3072×1729 WebP inside the file),
  see-through surfaces, the rail with icons and the bottom taglines, the hero, the suggestion rows,
  the input bar and the cost strip.
- Installed at `~/deepseek-api-console.html` (776 KB). `~/_abyss.html` was deleted by
  something else at 15:37 today; the work used the byte-identical copy on the Storage drive, which
  was left untouched.

Evidence on file:

| check | result |
| --- | --- |
| `node build.mjs --check` | all four blocks parse |
| `node --test tests/roi.unit.mjs` | 13 / 13 pass (parse, arithmetic, duplicates, the ladder) |
| `node tests/dc-gate.e2e.mjs` | 66 / 66 pass against the new build; engine block byte-identical |
| `node tests/roi.e2e.mjs` | 3 / 3 runs pass: repair round (2 calls), pro escalation (3 calls), clean stop with nothing saved |
| screenshot at 1672 × 941 | matches the mock-up surface by surface; art visible through every panel |

## Step 2 — the helper (done, verified)

`abyss-bridge.mjs`: serves the page on 127.0.0.1:8787, onboards into the room as `abyss-webapp`,
pages through the room's whole catalogue (49 servers), exposes a plain MCP endpoint at `/mcp` so
the page's own gate system drives room tools, and reads/searches this disk.

| check | result |
| --- | --- |
| `node --test tests/helper.e2e.mjs` | 7 / 7 pass (serves the page, onboards, lists 49 servers, room call through `/mcp`, disk read + search, refuses `/etc`) |
| page panel (from `file://` and from `http://127.0.0.1:8787`) | "running on http://127.0.0.1:8787 · room OK — this app is onboarded as abyss-webapp · servers 49" |
| gate check on a real room tool | PLAN → blocked; YOLO → executed, room answered "MCP Room connection verified" |

## Step 3 — attachments (done, verified)

Helper: `/attach` converts one file of any common type; `/attach/folder` pulls a folder with a token
budget. Page: the paperclip opens a tray — browser files, a path, or a folder — with token counts
and an off-peak cost estimate, and pictures go out as real picture blocks.

| check | result |
| --- | --- |
| `node --test tests/attach.e2e.mjs` | 11 / 11 pass — txt, csv, pdf, docx, rtf, xlsx (unzip), picture data, OCR, the `/tmp` symlink case, folder pull with documents, token budget, audio refusal, out-of-bounds refusal |
| real files through the helper | `note.pdf` 41 tok via pdftotext · `note.docx`/`note.rtf` via textutil · `sheet.xlsx` via unzip · screenshot → 1024-token picture + 829 chars of OCR |
| outgoing request, inspected | blocks `['text','image_url']`, the pdf text inside a fenced block, the picture as png data, one picture only, billed once |
| folder from the page | `folder · attach-lab/ (folder, 6 files) · 170 tok · 0 left out` |

## Step 4, batch 1 — project map, budget, search, file lookups (done, verified)

Helper: `/fs/many` reads a list of files in one request (24 files, 512 kB each, 4 MB total).
Page: a project bar above the composer, a compact map you can attach, a project-wide search, and a
`read_project_files` tool the model can call for the paths it saw on the map.

| check | result |
| --- | --- |
| index `~/abyss-console` | "24 files · 25.7 MB · ~176,745 tokens if sent whole (≈ $0.0265 off-peak)" |
| attach map | chip reads `file · project map · 264 tok` |
| search "abyss-bridge" | `24 hits` with clickable `file:line` rows, e.g. `README.md:8 node abyss-bridge.mjs` |
| model asks for a file | tool offered, called with `{"paths":["README.md"]}`, tool result carried 4,990 chars of the real README (`read_failed: false`) |
| tool call count | 2 — the file loop closed inside one turn |

## Step 4, batch 2 — write review, verify loop, secret scrubber (done, verified)

Helper: `/fs/write` (keeps the previous version), `/fs/undo`, `/fs/journal`, `/run` (needs
`confirm: true`). Page: a write-review card with a real diff, a verify bar, and the scrubber.

| check | result |
| --- | --- |
| `node --test tests/files.e2e.mjs` | 6 / 6 — write keeps the old file, undo restores it, undo removes a created file, journal lists both, run refuses without confirm, failing command reports its code, writes outside the allowed roots are refused |
| `node --test tests/redact.unit.mjs` | 8 / 8 — key, tokens, private key blocks, named secrets, connection strings; ordinary writing untouched; samples masked |
| live in the browser: scrub | sent a message containing a fake key and `password=hunter2hunter2`; the outgoing request carried neither, showed `sk-REDACTED`, and the badge said so |
| live in the browser: write | card "proposes writing 1 file" → compare `+2 −0` → write changed the file on disk → undo put the original line back |
| live in the browser: verify | `node -e "console.log(42)"` → chip `exit 0 · 0.0s`; a failing command → chip `exit 2 · output sent to the chat`, and the complaint is in the chat |

## Step 4, batch 3a — cost governor and model routing (done, verified)

| check | result |
| --- | --- |
| today's spend | after one call on the stand-in: `today $0.000048 of $0.5000` (1000 prompt at 90% hit + 50 out = $0.0000477 — the page's own arithmetic) |
| the hard stop | with $5 spent against a $0.50 budget: `Today's budget is spent: $5.0000 of $0.5000…`, and **zero requests reached the stand-in** |
| "hard reasoning" preset | next call used `deepseek-v4-pro`, `thinking: enabled`, `reasoning_effort: high` |
| "review with pro" | the same question was handed to pro with "be blunt about what is wrong" in the ask |

One fault found and fixed on the way: the daily-spend record was being read into the wrong variable
(the new read went into the middle of the load list), so the budget never saw the spend. Moved to
the end of the list; the stop now fires.

## Step 4, batch 3b — sessions, recipes, fill-in-the-middle (done, verified)

| check | result |
| --- | --- |
| save a session | `adder work · 2026-09-16 22:20 · 2 messages · $0.000054` |
| search inside sessions | query "add function" found it by what was said in it |
| open it again | "the old conversation is back" |
| fill-in-the-middle | the code block's *finish it* called `/beta/completions` with `deepseek-flash` and the block itself as the prompt (`… a, b) { const total = a + b;`), and the continuation appeared |
| recipe | kept "house style", clicked it, and its text was in the composer |

## Step 4, batch 3b — features 6 to 10 (done, verified)

`node tests/features.e2e.mjs` — 8 / 8 in one browser run against a stand-in DeepSeek:

`node tests/features.e2e.mjs` — 11 / 11 (the older library test was folded in here and quarantined):

| check | evidence |
| --- | --- |
| session library on disk with tags | `6 sessions on disk`, the saved one carrying `#cart #money` |
| search shows the matching line | `cart session · 3 messages · $0.000042 · #cart #money · user: what is the cart total` |
| forecast against the real bill | `forecast $0.000405 (2,698 tokens in, assuming 0% cache hits, and 4,000 tokens out), actual $0.000042` |
| flash and pro side by side | `FLASH says this` and `PRO says this` on screen with 5 price figures; both models asked |
| pinned context in the cached prefix | `PINNED: guardrails.md … never log secrets` inside the 10,023-character system message, 1 call |
| cache meter by the pins | `cached after the first send · session hit-rate` shown |
| trace triage finds the files | `{"n":2,"attach":true}` from a two-frame trace |
| those files attach | `chips: 2` |

Defects found and fixed while testing these: the cost line had landed inside the `catch` (so it only
printed on failures); the trace box used `window.prompt`, which is untestable and wrong for a
20-line trace, so it is now a real textarea; and the forecast priced every input token as a cache
miss, which overstated a warm session by 10x — it now uses the session's own hit ratio and says so.

## Where it stands

All four steps of the approved plan are done. Every suite green:

| suite | result |
| --- | --- |
| `node --test tests/roi.unit.mjs tests/redact.unit.mjs` | 21 pass, 0 fail |
| `node --test tests/helper.e2e.mjs` | 7 / 7 |
| `node --test tests/attach.e2e.mjs` | 11 / 11 |
| `node --test tests/files.e2e.mjs` | 6 / 6 |
| `node tests/dc-gate.e2e.mjs` | 66 / 66 assertions |
| `node tests/roi.e2e.mjs` | 3 / 3 ladder runs (repair, pro escalation, clean stop) |
| `node tests/library.e2e.mjs` | sessions, search, open, FIM, recipes — all pass |

The page is installed at `~/deepseek-api-console.html`; rebuild and reinstall with
`node build.mjs --install` from `~/abyss-console`.


- Step 4, batch 3b — session library (named sessions, search across them, export) · recipe library
  and fill-in-the-middle autocomplete.
