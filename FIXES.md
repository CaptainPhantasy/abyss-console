# Fixes — the refactor ledger

This repo is going through a best-practices refactor, driven by two audited lists:

- **A — 23 issues that affect a human using this page to write code.** Items 1–21 were verified against
  the running app on 2026-09-16; items 22–23 were verified on 2026-09-17.
- **B — 17 coding weaknesses** — places where the page cannot do what a coding harness must.

Each row states the problem, the fix, and the proof that will flip its status from `open` to
`fixed`. A fix is only marked `fixed` when a command's output says so; the command is named in the
row. The work lands in waves — security first, then the change/diff path, then the experience.

## A. Human-use issues

| # | issue (verified) | fix | proof | status |
|---|---|---|---|---|
| 1 | **The helper ran any command a web page asked for.** CORS was `*` and `/run` checked only `confirm:true`; a page from another origin executed a command and a marker file appeared on disk. | Every route except `/` and `/health` now requires a per-install token (`x-abyss-token`), generated once into `~/.abyss-console/token` (0600; `ABYSS_TOKEN_FILE` overrides) and injected only into the page the helper serves; an origin allowlist refuses non-loopback browser origins, preflight included. A `file://` copy carries no token and cannot use helper routes. | `node --test tests/helper-auth.e2e.mjs` — 10/10: no token, wrong token, and the original exploit shape (foreign origin, `confirm:true`) all refused; the token path works end to end. `node --test tests/helper.e2e.mjs` — 7/7 still green. | fixed |
| 2 | **The secret scrubber had a bypass.** It ran on the composed message only, so pinned text and tool results reached the model unscrubbed. | Every chat request is now scrubbed inside `callDeepSeek` — one choke point covering the system message, pinned text, every tool result, the history, attachments and the draft; the fill-in-the-middle prompt gets the same treatment; both honour the Settings toggle. | `node tests/features.e2e.mjs` — 12/12, including "A2 the pinned secret is scrubbed before it leaves": a pin containing `password=hunter2hunter2` reached the stand-in as `password=REDACTED`, never raw. | fixed |
| 3 | **Two change mechanisms** (`### file:` whole-file blocks and unified diffs) with two review cards and no guidance on which the model should use. | One mechanism: diffs for edits; `### file:` only for files that do not exist yet. One review card. | `node --test tests/files.e2e.mjs` + a card-render check | open |
| 4 | **The diff view was not a diff view.** It shows `+2 −0` and six changed lines by number — no context, no per-hunk view. | A real unified-diff view: context lines, per-file and per-hunk accept, a plain-language note when context has drifted. | screenshot read back + `tests/files.e2e.mjs` | open |
| 5 | **No git in the user interface** — no status, no diff against HEAD, no staging, no commit. | Git panel driven by helper routes: status, diff vs HEAD, stage, commit behind an explicit action; branch and change summary injected into the request context. | `node --test tests/git.e2e.mjs` (status/diff/commit against a scratch repo) | open |
| 6 | **Sessions cloned themselves on save** (new id every save; "cart session" existed seven times), and nothing showed which saved session the chat belonged to. | Save updates the session in place (stable id); a "current session" badge; save-as-new only when asked. | `node tests/features.e2e.mjs` — save twice, one entry | open |
| 7 | **Opening a session replaced the chat** instead of opening a tab; the previous conversation left the view. | Sessions open as tabs; switching keeps the open one. | `node tests/features.e2e.mjs` — two sessions open, both reachable | open |
| 8 | **The project map went stale silently.** Indexing is manual; no watching, no incremental update, no staleness warning. | Index age shown; one-click refresh; a visible "stale" badge once files change on disk. | `node --test tests/project.e2e.mjs` — touch a file, badge appears | open |
| 9 | **Pins froze at the moment they were pinned.** Editing the pinned file keeps sending the old text, permanently, with no warning. | Pin age shown, one-click re-read, and the pin notes when the file changed on disk. | `node --test tests/project.e2e.mjs` — edit the pinned file, pin flags stale | open |
| 10 | **No `.gitignore` semantics.** The helper skipped a hardcoded list, not your `.gitignore`, so indexed contents did not match what you would commit. | The project walk respects `.gitignore` (root and nested). | `node --test tests/project.e2e.mjs` — ignored file absent from map | open |
| 11 | **Four cost readouts** (meter, budget row, send estimate, per-turn line) — anxiety, not control. | One meter plus a budget line; per-turn detail behind a click. | screenshot read back | open |
| 12 | **The forecast scared you on a cold session** — it priced input at the session's hit ratio, which is 0% until the cache warms, so turn one read ~10× the real bill ($0.000405 vs $0.000042 measured). | A cold-session forecast uses an honest assumption and says which one. | unit test on `estimateSend` with a cold session | open |
| 13 | **No keyboard model** — no command palette, no shortcuts for fork, pin, run, compare, trace, new session. | Command palette (⌘K / Ctrl-K) plus shortcuts for those actions. | `node tests/features.e2e.mjs` — palette opens, shortcut forks | open |
| 14 | **No cancel, no progress for the slow things** — compare (two calls), run-and-fix, patch check, folder index and trace triage could hold the interface with one status line and no stop. | Progress plus a cancel button for every operation that can hold the interface. | `node tests/features.e2e.mjs` — a slow op cancelled mid-run | open |
| 15 | **Two overlapping "compare" actions** — "review with pro" and "compare flash vs pro" sat side by side doing nearly the same job with different mechanics and no guidance. | One explained action. | screenshot + `tests/features.e2e.mjs` | open |
| 16 | **The 75-second room release was invisible** — nothing said the link was dropped and reconnected, so the first MCP call after a break looked like a stall. | Helper link state on the page: connected / released / reconnecting. | `node --test tests/helper.e2e.mjs` + screenshot | open |
| 17 | **"Closes with the tab" is not what happens.** A supervised daemon outlives the tab and only releases the room bridge; the page does not say so. | The page states the truth, and a best-effort stop on tab close that does not fight the supervisor. | `node --test tests/helper.e2e.mjs` (page says "daemon…", stop beacon route works) | open |
| 18 | **The working set lives in the composer stack** — session, routing, project, verify, pins and tray all stack above the input; even collapsed, the compact row carries eight controls. | Working set moves to the rail / palette; the composer keeps the composer. | screenshot read back | open |
| 19 | **Deleting a session and unpinning were instant**, no confirm, no undo — while file writes got a full journal. | Confirm plus undo (soft delete) for both. | `node tests/features.e2e.mjs` — delete shows undo, undo restores | open |
| 20 | **No request inspector** — the forecast existed, but never what was actually sent, so "why did it answer that" was unanswerable without reading storage by hand. | Per-turn inspector: the exact request that went out, in order, copyable. | `node tests/features.e2e.mjs` — inspector shows the sent body | open |
| 21 | **Small ones:** tags are free text (no autocomplete — `#cart` vs `#carts`); session search needs a click, not Enter; export is Markdown-only and only for the current chat; the API key is collected through a `window.prompt`. | Tag autocomplete; Enter runs the search; export and import the whole library; the key moves to a real field in Settings. | `node tests/features.e2e.mjs` | open |
| 22 | *(2026-09-17)* **The cost footer was re-sent to the model as its own message.** The page appends "Cost of that turn — …" as an unflagged assistant row, and the recorder→request mapper filtered only `error` rows — so every later call carried harness text as the model's own words. The model then "confessed" to writing it and called real measurements fake. | Flag the footer as display-only and filter it out of the request. | unit test on the mapper: footer absent from the built request | open |
| 23 | *(2026-09-17)* **The write-card format did not match the build instruction.** The contract says "each preceded by a bold filename line"; the card detector looks for `### file:` — so a reply that followed the instruction got no card, and nothing could be written. | One documented format, taught in the contract and accepted by the detector. | `node --test tests/files.e2e.mjs` — the taught format renders a card | open |

## B. Coding weaknesses

| # | weakness (verified) | fix | proof | status |
|---|---|---|---|---|
| 1 | **No autonomous apply → test → fix loop.** Applying, running, and feeding failures back are three hand-offs. | One action: apply the patch, run the verify commands, feed failures back, bounded rounds, visible per-round log, cancel. | `node tests/loop.e2e.mjs` | open |
| 2 | **The model cannot search the project.** Search exists in the interface, not as a tool. | `search_project` tool returning `file:line` hits it can then read. | tool test against the fixture project | open |
| 3 | **No references tool** — renames are hopeful; the model guesses which callers exist. | `find_references` tool (text-level, with context lines). | tool test: rename target found in 3 files | open |
| 4 | **Silent truncation** — 512 kB per file, 12k characters per tool result, 60 files per folder pull, none signalled. | Every capped read says "cut at N — ask for the rest". | unit test on the truncation notice | open |
| 5 | **Whole-file writes were allowed** and could clobber a file's tail. | Diffs required above a size threshold (merges with A3). | `tests/files.e2e.mjs` | open |
| 6 | **The map is size-ranked with no retrieval** — context selection is guesswork. | Relevance ranking (recency, keyword hits, path heuristics) plus retrieval. | fixture test: the relevant file ranks above the big irrelevant one | open |
| 7 | **8 steps with no continuation protocol** — the model is not told it was cut off; nothing carries a task list forward. | Step budget with an explicit "cut off — continuing" and the task list carried into the next turn. | `tests/loop.e2e.mjs` — cap hit, continuation offered | open |
| 8 | **No plan or task artifact across turns** — long work has no durable state beyond the transcript. | A small task store: goal, steps, done/not-done, visible on the page. | `tests/loop.e2e.mjs` | open |
| 9 | **No git awareness in context** — the model cannot see the branch or uncommitted changes. | Branch and uncommitted-change summary injected (merges with A5). | request-inspector evidence | open |
| 10 | **No concurrency** — one request at a time; multi-file jobs serialised for no reason. | Independent reads run in parallel. | timing evidence in `tests/loop.e2e.mjs` | open |
| 11 | **Cost per turn, not per task** — a daily cap exists, nothing says "this task may spend $0.05". | Per-task budget with a hard stop and a running total. | `tests/loop.e2e.mjs` — task stops at its budget | open |
| 12 | **The tool contract is thin** — nothing tells the model to prefer diffs or reports which files it touched. | The contract states diff-first and requires a touched-files summary. | contract text + a rendered reply | open |
| 13 | **It cannot scaffold or run a test it just wrote.** | The loop runs commands it chose (merges with B1). | `tests/loop.e2e.mjs` | open |
| 14 | **No three-way merge / fuzzy patch** — an exact-match patch half-conflicts and is refused after any edit. | Fuzzy hunk matching with a threshold and a plain conflict report; never force a hunk. | `node --test tests/diff.unit.mjs` | open |
| 15 | **One verify command only** — "lint and test" becomes two manual rounds. | Verify commands are a list. | `node --test tests/files.e2e.mjs` — two commands run in order | open |
| 16 | **Large-file caps unexplained** (merges with B4). | Signalled caps. | same as B4 | open |
| 17 | **Multi-turn memory is a transcript, not a plan** (merges with B8). | Durable task state. | same as B8 | open |

## Publishing — what is deliberately not here

- **Secrets and keys:** the working tree was scanned for `sk-…`, `ghp_…`, `AIza…`, JWT-shaped strings
  and private-key blocks; the only matches are the scrubber's own patterns and fake fixtures in tests.
  The helper's onboarding token and the page's API key live outside this tree, on the machine, by design.
- **Local-only artifacts, kept out with `.gitignore`:** `shots/` (desktop screenshots),
  `assets/background-source.tiff` (the 21 MB master), and test build outputs
  (`dist/test-page.html`, `dist/debug.html`; the shipped page `dist/deepseek-api-console.html` is here).
- **Personal paths** in user-visible strings were replaced with `~`. What remains, and why: the
  helper's default room paths (`ROOM_BRIDGE`, `ROOM_TOKEN_FILE` override both) and two launchd label
  strings in `src/mcp-engine.js` and the untouched `baseline/` page are machine-specific integration
  details, not credentials.
- **Session data, recipes and the write journal** live under `~/.abyss-console/` and `~/.cache/` —
  never in this tree.

## Proof protocol

The suite that must stay green for any merge (run from the repo root):

    node build.mjs --check                          # every piece parses
    node --test tests/roi.unit.mjs tests/redact.unit.mjs
    node --test tests/helper.e2e.mjs tests/attach.e2e.mjs tests/files.e2e.mjs
    node tests/dc-gate.e2e.mjs                      # 66 assertions
    node tests/roi.e2e.mjs                          # 3 ladder runs (needs a stand-in: build --api-base)
    node tests/features.e2e.mjs                     # 11 checks (needs the test build)
