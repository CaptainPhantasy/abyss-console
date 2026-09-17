/* ============================================================================
   ABYSS console — the page's own code, written out so it can be read and edited.
   The React library that draws the screens is kept in shortened form above this
   file (src/vendor.min.js) and is not edited here.

   Names you will want when changing something:
     API_BASE, PRICES, STORAGE_KEYS, DEFAULT_SETTINGS, CHEATSHEET   — the basics
     storageGet / storageSet   — reading and writing saved data
     todayIndiana              — today's date in your timezone
     priceFor / fmtCost / peakInfo — money and the 2x peak window
     callDeepSeek / recordUsage    — the API call and the cost meter
     MarkdownBlock / InlineText / CodeBlock — the three text renderers
     APP_CSS, STYLES           — the stylesheet and the style objects
     globalThis.AbyRoi         — the daily-idea rules (its own script block)
   ========================================================================== */

const jsxRuntime = d, React = W, ReactDOM = Zc, createRoot = Tc;

/* Every call to the local helper must carry the helper token. When the page is served
   by the helper, window.__ABYSS_TOKEN is already set in it; a file:// copy can paste
   the token into Settings. One wrapper here means no call site can forget the header. */
(() => {
  const origFetch = globalThis.fetch;
  const fromStorage = () => {
    try {
      return (JSON.parse(localStorage.getItem("deepseek_console:settings") || "{}") || {}).helperToken || "";
    } catch {
      return "";
    }
  };
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.startsWith(HELPER_URL)) {
      const headers = new Headers((init && init.headers) || {});
      const token = globalThis.__ABYSS_TOKEN || fromStorage();
      if (token) headers.set("x-abyss-token", token);
      return origFetch(input, { ...init, headers });
    }
    return origFetch(input, init);
  };
})();

/* Closing the tab asks the helper to stop — only when the helper served this page (it put the
   token in). launchd starts it again on the next visit, so nothing is left running for you. */
if (globalThis.addEventListener) {
  globalThis.addEventListener("pagehide", () => {
    if (!globalThis.__ABYSS_TOKEN) return;
    try {
      fetch(HELPER_URL + "/quit", { method: "POST", keepalive: true });
    } catch {}
  });
}

const API_BASE = "https://api.deepseek.com",
  HELPER_URL = "http://127.0.0.1:8787",
  PRICES = {
    "deepseek-flash": { hit: 0.003, miss: 0.15, out: 0.6, hitP: 0.006, missP: 0.3, outP: 1.2 },
    "deepseek-v4-pro": { hit: 0.022, miss: 0.66, out: 1.98, hitP: 0.044, missP: 1.32, outP: 3.96 },
  },
  BASELINE_VERIFIED = "2026-09-11",
  CHEATSHEET = `# DeepSeek API Platform — Cheat Sheet (baseline verified ${BASELINE_VERIFIED})

## 1. Live models (two: multimodal flash + heavyweight pro)
Old names deepseek-chat and deepseek-reasoner were RETIRED 2026-07-24 15:59 UTC. On 2026-09-10 DeepSeek-V4.1-Flash launched and deepseek-v4-flash + deepseek-v4-flash-vision-exp were retired with it.
| Model ID | Role | Size (MoE) | Context | Max output |
|---|---|---|---|---|
| deepseek-flash | V4.1-Flash — fast multimodal DEFAULT: text + native IMAGE input | 552B total / 8B active input, 16B active output (asymmetric) | 1M tokens | 384K |
| deepseek-v4-pro | V4-Pro-0813 — heavyweight for the hardest reasoning/code; TEXT-ONLY | 1.6T total / 49B active | 1M tokens | 384K |
- deepseek-flash = DeepSeek-V4.1-Flash, first of a new Causal Encoder-Decoder architecture family, live 2026-09-10 with NATIVE VISION at LOWER prices than the flash it replaces.
- LEGACY ALIASES: deepseek-v4-flash and deepseek-v4-flash-vision-exp are still accepted but both route to V4.1-Flash and bill at flash prices. The separate vision-exp model is gone — vision is native on deepseek-flash.
- V4-Pro was scheduled to phase out 2026-09-14 (auto-route to flash at 04:00 UTC); DeepSeek REVERSED this after user demand — v4-pro stays available at unchanged billing until further notice.
- DeepSeek's own benchmarks put V4.1-Flash AHEAD of V4-Pro on performance, cost, speed and total runtime; several third-party tests agree.
- MIT open weights + tech report: huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash (V4-Flash-Vision-Exp weights went open 2026-08-31). Still no image generation, no embeddings on the first-party API.

## 2. Endpoints (one sk-... key works everywhere)
| Base URL | Format | Use |
|---|---|---|
| https://api.deepseek.com | OpenAI Chat Completions (POST /chat/completions; /v1 is an alias) + Responses API | everything, including image input on deepseek-flash |
| https://api.deepseek.com/anthropic | Anthropic Messages (/v1/messages, x-api-key + anthropic-version) | Anthropic-native tools; claude-opus* auto-maps to v4-pro, claude-sonnet*/haiku* to deepseek-flash; thinking.budget_tokens ignored. Claude Code works via ANTHROPIC_BASE_URL. |
| https://api.deepseek.com/beta | legacy /completions | FIM fill-in-the-middle autocomplete + chat prefix completion (FIM works in NON-thinking mode only) |
| GET https://api.deepseek.com/models | — | live ground truth for model IDs |
Responses API: native on BOTH deepseek-flash and deepseek-v4-pro.

## 3. Prices — USD per 1M tokens, OFF-PEAK (input split by cache state; peak = exactly 2x)
| Model | Input miss | Input HIT | Output |
|---|---|---|---|
| deepseek-flash (V4.1-Flash) | $0.15 | $0.003 | $0.60 |
| deepseek-v4-pro | $0.66 | $0.022 | $1.98 |
- NEW 2026-09-10 04:00 UTC: flash dropped from $0.22/$0.007/$0.66 to $0.15/$0.003/$0.60 — V4.1-Flash's KV cache needs 1/4 the HBM and 1/8 the SSD, so cache-hit is now 1/50 of miss.
- PEAK HOURS BILL 2x ON EVERY ITEM: peak = 01:00-04:00 & 06:00-10:00 UTC, Mon-Fri.
- Price history: V4-Pro launched at $1.74/$3.48, cut 75% permanently 2026-05-22; old flash was $0.22 miss until 2026-09-10.
- BILLING TRAP, measured 2026-08-04: thinking tokens bill as OUTPUT and are mostly invisible.
  A trivial question at effort "high" returned completion_tokens 35 with reasoning_tokens 27 —
  77% of the output charge was private reasoning absent from the content field. Count completion_tokens,
  never visible answer length. Turn thinking OFF for extraction, formatting and classification.
- Peak windows are Beijing 09:00-12:00 and 14:00-18:00 (UTC+8) = 01:00-04:00 and 06:00-10:00 UTC, Mon-Fri.
  In Indiana (Eastern, DST-aware) that is 21:00-00:00 and 02:00-06:00 in summer (EDT),
  20:00-23:00 and 01:00-05:00 in winter (EST) — i.e. overnight, so a normal working day is entirely off-peak.
- CORS: VERIFIED 2026-08-04 that api.deepseek.com answers a browser preflight with
  access-control-allow-origin echoing the caller and allows POST + the authorization header.
  Browser-direct calls work; the risk is key exposure, not connectivity.
- Error bodies are NOT always JSON: a bad key returns plain text "Authentication Fails (governor)".
  Read the body as text first, then try to parse it.
- 5M free tokens per new account. No batch-discount tier exists — the prefix cache IS the discount.
- Concurrency ~2500 (flash) / ~500 (pro); rate limits are account-level; pass a stable "user" field per end customer.

## 4. Cache-hit farming (automatic, prefix-based, best-effort)
1) Static content FIRST (system prompt, docs, few-shot, tool schemas), variable content LAST. One changed early byte kills the match.
2) Byte-identical prefixes only — never put timestamps/randoms near the top.
3) Multi-turn: resend history verbatim + append; each turn's transcript is the next turn's cached prefix.
4) Measure via usage.prompt_cache_hit_tokens / prompt_cache_miss_tokens on every response; alert on hit-ratio drops.
5) The cache makes "stuff the 1M context" often cheaper than building a RAG pipeline.

## 5. Thinking mode (reasoning)
- ON by default at effort "high". Body fields: {"thinking":{"type":"enabled"|"disabled"}} and "reasoning_effort":"high"|"max" (OpenAI SDK: put thinking inside extra_body).
- Chain-of-thought returns in reasoning_content, separate from content. You PAY for it as output tokens.
- In thinking mode temperature/top_p/presence_penalty/frequency_penalty are SILENTLY IGNORED. Control length with max_tokens.
- "max" effort emits huge traces — budget output generously (self-host: max len >= 393216).
- Plain multi-turn: reasoning_content on input is ignored (no double billing).
- TOOL-CALL ROUND-TRIP RULE: when returning tool results, replay the assistant message WITH content + reasoning_content + tool_calls, and bind each result to its tool_call_id. Dropping reasoning_content breaks V4 agent loops.
- HTTP 200 + empty content => finish_reason "length": budget died mid-reasoning. Raise max_tokens or lower effort.

## 6. Streaming (SSE)
- "stream": true => data: {json} chunks ending data: [DONE]. reasoning_content deltas stream FIRST, then content deltas.
- Add stream_options {"include_usage": true} or every chunk shows usage null. The final usage chunk may have an EMPTY choices array — guard it.
- Long Pro/max generations run minutes; proxies/CDNs kill idle SSE — raise timeouts on every hop. Slow is not dead.

## 7. Other features
- VISION (deepseek-flash only; native since 2026-09-10): OpenAI-style content blocks — image_url with a base64 data: URL, a public http(s) URL (<=8192 chars, <=32 MiB, 60s fetch), or a file block with a Files API file_id (<=64 MiB). JPEG/PNG/GIF/WebP. Images bill as INPUT tokens, max ~1024/image (auto-resized toward ~1300x1300 total pixels; smaller ones upscaled to ~544x544). USER-role messages only — images in system/assistant return 400. Request body <=48 MiB, <=600 images/request, max 8192px/side (4096 when 15+ images). detail: low (512x512) / original / auto. Anthropic-format image blocks also work on /anthropic.
- JSON Output: response_format {"type":"json_object"} AND the word "json" + a schema example in the prompt; validate + bounded retry.
- Tools: standard OpenAI tools/tool_choice on both models. FIM + prefix completion on the beta endpoint (FIM = non-thinking mode only).

## 8. Routing brain (cheapest correct answer wins)
- Default flash + thinking OFF: chat, summarize, classify, extract, high-frequency tool loops.
- flash + thinking high: everyday coding, debugging, agents — the price/quality sweet spot of 2026.
- pro + thinking: DeepSeek's own tests now put V4.1-Flash ahead of V4-Pro on most benches — keep pro for cases where flash demonstrably fails (hardest math/algorithms, second opinions), whole-repo analysis if you prefer it, final review of flash's work. Reserve effort "max" for the truly hardest.
- Escalation ladder: flash -> mechanical validation (JSON parses? tests pass?) -> one flash retry with the error appended -> escalate same conversation to pro. >90% of traffic never touches pro.
- Non-thinking sampling: temperature 1.0 / top_p 1.0 general; ~0.0-0.3 deterministic extraction/code; ~1.3 creative.

## 9. Edge cases
model_not_found => pre-July names retired. deepseek-v4-flash / deepseek-v4-flash-vision-exp still parse but silently serve V4.1-Flash at flash prices — migrate your IDs. Images in system/assistant messages => 400 (user-role only). Empty content => finish_reason length. Dead temperature => thinking mode. Broken agent loop => replay reasoning_content. Zero token counts from a stream => parser read usage only on an empty-choices chunk; V4 puts usage on the final CONTENT chunk (measured 2026-08-04), so read usage before any choices guard. Dead long stream => proxy timeout. Hit-rate collapse => volatile bytes crept into prefix. 402 => balance. 429/503 => backoff + jitter. Cost jump => check if 2x peak pricing went live.`,
  MCP_CONTRACT_TEXT = `You are the assistant inside a DeepSeek API console. You are a DeepSeek platform specialist and builder.
Non-negotiables:
- You are an expert on everything in the DeepSeek cheat sheet above; cite its facts (prices, limits, rules) precisely and never invent numbers.
- When asked to BUILD something (an app, script, page, agent, config, doc), deliver the COMPLETE artifact in fenced code blocks with the correct language tag — full implementation, zero placeholders, zero "..." elisions. Multiple files = multiple fenced blocks, each preceded by its own line \`### file: <path>\`. For changes to a file that already exists, send a unified diff with context lines instead — the page checks and applies it hunk by hunk. When you change files, end your reply with one line: \`touched: <path>, <path>\`.
- Default all designs and generated code to the DeepSeek API (deepseek-flash unless the task genuinely needs v4-pro), applying the cheat sheet: static-prefix prompt ordering for cache hits, correct thinking/streaming/tool-round-trip handling, and cost math per million tokens.
- Speak plainly: explain any technical term in the same sentence you use it. Lead with the outcome, then the detail.
- If a fact could have drifted since the sheet's verification date, say so and recommend the Docs tab's live refresh.`,
  STORAGE_KEYS = {
    key: "deepseek_console:apikey",
    settings: "deepseek_console:settings",
    doc: "deepseek_console:doc",
    ideas: "deepseek_console:ideas",
    totals: "deepseek_console:totals",
  daily: "deepseek_console:daily",
  sessions: "deepseek_console:sessions",
  recipes: "deepseek_console:recipes",
  },
  DEFAULT_SETTINGS = {
    model: "deepseek-flash",
    thinking: !0,
    effort: "high",
    maxTokens: 8e3,
    mcpOn: !1,
    mcpUrl: "http://127.0.0.1:13001",
    mcpGate: "PLAN",
  redact: true,
  budgetUsd: 0.5,
  panelsOpen: false,
  verifyCmds: {},
  projectBudgets: {},
  pinned: [],
    mcpToken: "",
    helperToken: "",
  };
async function storageGet(e) {
  try {
    const t = localStorage.getItem(e);
    return t === null ? null : JSON.parse(t);
  } catch {
    return null;
  }
}
async function storageSet(e, t) {
  try {
    localStorage.setItem(e, JSON.stringify(t));
  } catch (n) {
    console.error("storage set failed", n);
  }
}
const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
const todayIndiana = () => {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Indiana/Indianapolis",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  },
  fmtCost = (e) => (e >= 0.01 ? `$${e.toFixed(4)}` : e > 0 ? `$${e.toFixed(6)}` : "$0"),
  priceFor = (e, t) => {
    const n = PRICES[e] || PRICES["deepseek-flash"],
      p = peakInfo(new Date()).inWindow;
    return (
      ((t.hit || 0) * (p ? n.hitP : n.hit) +
        (t.miss || 0) * (p ? n.missP : n.miss) +
        (t.out || 0) * (p ? n.outP : n.out)) /
      1e6
    );
  },
  LANGUAGE_BY_NAME = {
    javascript: "js",
    jsx: "jsx",
    typescript: "ts",
    tsx: "tsx",
    python: "py",
    html: "html",
    css: "css",
    json: "json",
    bash: "sh",
    shell: "sh",
    sh: "sh",
    yaml: "yaml",
    yml: "yml",
    markdown: "md",
    md: "md",
    sql: "sql",
    go: "go",
    rust: "rs",
    swift: "swift",
    mermaid: "mmd",
    toml: "toml",
    dockerfile: "Dockerfile",
  };
async function describeHttpError(e) {
  var l;
  let t = "";
  try {
    t = (await e.text()).trim();
  } catch {}
  let n = t;
  try {
    const o = JSON.parse(t);
    n =
      ((l = o == null ? void 0 : o.error) == null ? void 0 : l.message) ||
      (o == null ? void 0 : o.message) ||
      t;
  } catch {}
  return `${{ 400: "DeepSeek rejected the request body — usually a bad field name or a max_tokens over the model limit.", 401: "That API key was refused. Check it in Settings; keys look like sk-… and are account-specific.", 402: "Your DeepSeek account is out of balance. Top up at platform.deepseek.com.", 422: "A parameter value was out of range for this model.", 429: "You are being rate-limited. Wait a few seconds and retry — the app's retry button uses backoff.", 500: "DeepSeek had a server error. Not your fault; retry.", 503: "DeepSeek is overloaded right now. Retry in a moment." }[e.status] || "DeepSeek returned an error."} (HTTP ${e.status}${n ? " — " + n.slice(0, 240) : ""})`;
}
function peakInfo(e = new Date()) {
  const t = e.getUTCHours() + e.getUTCMinutes() / 60,
    w = e.getUTCDay() !== 0 && e.getUTCDay() !== 6,
    n = w && ((t >= 1 && t < 4) || (t >= 6 && t < 10));
  let s = null,
    mins = null;
  if (!n) {
    const cur = new Date(e);
    for (let d = 0; d < 8 && !s; d++) {
      const day = new Date(cur);
      day.setUTCDate(cur.getUTCDate() + d);
      if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
        for (const hh of [1, 6]) {
          const c = new Date(day);
          c.setUTCHours(hh, 0, 0, 0);
          if (c.getTime() > e.getTime()) {
            s = c;
            break;
          }
        }
    }
  }
  mins = s ? Math.round((s.getTime() - e.getTime()) / 6e4) : null;
  const il = (z) => {
      try {
        return new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Indiana/Indianapolis",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(z);
      } catch {
        return z.getUTCHours() + ":" + String(z.getUTCMinutes()).padStart(2, "0") + " UTC";
      }
    },
    ws = (z) => {
      const d = new Date(e);
      d.setUTCHours(z, 0, 0, 0);
      return il(d);
    },
    win = ws(1) + "-" + ws(4) + " & " + ws(6) + "-" + ws(10);
  return {
    inWindow: n,
    nextStart: s,
    minsToPeak: mins,
    nextLocal: s ? il(s) : null,
    warn: !n && mins !== null && mins <= 30,
    label: n ? "in peak window — 2x rates live" : "outside peak window",
    note: n
      ? "Peak 2x pricing is LIVE (verified 2026-08-27): every bill item doubles. Windows: " +
        win +
        " Indiana time."
      : "Off-peak now. Next 2x window in " +
        mins +
        " min — peak windows are " +
        win +
        " Indiana (01:00-04:00 & 06:00-10:00 UTC Mon-Fri). 2x surcharge LIVE since 2026-08-27.",
  };
}
async function callDeepSeek({
  apiKey: e,
  model: t,
  messages: n,
  thinking: r,
  effort: l,
  maxTokens: o,
  temperature: w,
  json: i,
  signal: s,
  onDelta: u,
  tools: d,
  scrub: sc,
}) {
  /* The one choke point: whatever the call sites built — history, pinned text, tool
     results, attachments — nothing secret leaves the machine from here. */
  const RG = globalThis.AbyRedact;
  const fix = (q) => (sc === false || !RG ? String(q == null ? "" : q) : RG.redact(String(q)).text);
  const fixContent = (q) =>
    typeof q === "string"
      ? fix(q)
      : Array.isArray(q)
        ? q.map((p2) => (p2 && p2.type === "text" && typeof p2.text === "string" ? { ...p2, text: fix(p2.text) } : p2))
        : q;
  const live = sc === false || !RG ? n : n.map((mm) => ({ ...mm, content: fixContent(mm.content) }));
  const c = {
    model: t,
    messages: live,
    stream: !0,
    stream_options: { include_usage: !0 },
    max_tokens: o,
    thinking: { type: r ? "enabled" : "disabled" },
  };
  (!r && w != null && (c.temperature = w), r && (c.reasoning_effort = l),
    i && (c.response_format = { type: "json_object" }),
    d && d.length && (c.tools = d));
  /* the inspector keeps the last few request bodies exactly as they went out */
  try {
    const ring = (globalThis.__ABYSS_REQS = globalThis.__ABYSS_REQS || []);
    ring.push({ at: new Date().toISOString(), model: t, body: c });
    if (ring.length > 5) ring.shift();
  } catch {}
  const y = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${e}` },
    body: JSON.stringify(c),
    signal: s,
  });
  if (!y.ok) throw new Error(await describeHttpError(y));
  const g = y.body.getReader(),
    m = new TextDecoder();
  let x = "",
    S = "",
    E = "",
    B = null,
    f = null,
    W = [];
  for (;;) {
    const { done: a, value: p } = await g.read();
    if (a) break;
    x += m.decode(p, { stream: !0 });
    const v = x.split(`
`);
    x = v.pop();
    for (const C of v) {
      const T = C.trim();
      if (!T.startsWith("data:")) continue;
      const N = T.slice(5).trim();
      if (N === "[DONE]") continue;
      let P;
      try {
        P = JSON.parse(N);
      } catch {
        continue;
      }
      P.usage && (B = P.usage);
      const M = P.choices && P.choices[0];
      if (!M) continue;
      M.finish_reason && (f = M.finish_reason);
      const L = M.delta || {};
      (L.reasoning_content && (S += L.reasoning_content),
        L.content && (E += L.content),
        L.tool_calls &&
          L.tool_calls.forEach((q) => {
            const it = q.index ?? 0;
            W[it] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
            q.id && (W[it].id = q.id);
            q.function &&
              (q.function.name && (W[it].function.name += q.function.name),
              q.function.arguments && (W[it].function.arguments += q.function.arguments));
          }),
        (L.reasoning_content || L.content) && u({ reasoning: S, content: E }));
    }
  }
  return { reasoning: S, content: E, usage: B, finishReason: f, toolCalls: W.filter(Boolean) };
}
function InlineText({ text: e }) {
  const t = [];
  let n = e,
    r = 0;
  const l = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/;
  for (; n.length;) {
    const o = n.match(l);
    if (!o) {
      t.push(n);
      break;
    }
    o.index > 0 && t.push(n.slice(0, o.index));
    const i = o[0];
    if (i.startsWith("**"))
      t.push(
        jsxRuntime.jsx("strong", { style: { color: "var(--foam)", fontWeight: 600 }, children: i.slice(2, -2) }, r++),
      );
    else if (i.startsWith("`")) t.push(jsxRuntime.jsx("code", { style: STYLES.inlineCode, children: i.slice(1, -1) }, r++));
    else {
      const s = i.match(/\[([^\]]+)\]\(([^)]+)\)/);
      t.push(
        jsxRuntime.jsx(
          "a",
          {
            href: s[2],
            target: "_blank",
            rel: "noreferrer",
            style: { color: "var(--sonar)" },
            children: s[1],
          },
          r++,
        ),
      );
    }
    n = n.slice(o.index + i.length);
  }
  return jsxRuntime.jsx(jsxRuntime.Fragment, { children: t });
}
const LIVE = { key: "", model: "deepseek-flash" };
function CodeBlock({ lang: e, code: t, apiKey: key, model: chosenModel }) {
  key = key || LIVE.key;
  chosenModel = chosenModel || LIVE.model;
  const [finish, setFinish] = React.useState("");
  const [busy, setBusy] = React.useState(!1);
  const [err, setErr] = React.useState("");
  /* Fill-in-the-middle lives on the beta endpoint and works with thinking off. */
  const completeIt = async () => {
    if (!key) {
      setErr("add your key in Settings first");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const off = (() => {
        try {
          return JSON.parse(localStorage.getItem("deepseek_console:settings") || "{}").redact === false;
        } catch {
          return false;
        }
      })();
      const clean = off || !globalThis.AbyRedact ? t : globalThis.AbyRedact.redact(String(t)).text;
      const res = await fetch(API_BASE + "/beta/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({
          model: chosenModel && chosenModel.indexOf("pro") === -1 ? chosenModel : "deepseek-flash",
          prompt: clean,
          suffix: "",
          max_tokens: 220,
          temperature: 0.2,
          stream: false,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setErr((body && body.error && body.error.message) || "HTTP " + res.status);
        return;
      }
      const added = (body.choices && body.choices[0] && body.choices[0].text) || "";
      setFinish(added);
      if (!added) setErr("the model had nothing to add");
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const [n, r] = React.useState(!1),
    l = async () => {
      try {
        await navigator.clipboard.writeText(t);
      } catch {
        const i = document.createElement("textarea");
        ((i.value = t), document.body.appendChild(i), i.select(), document.execCommand("copy"), i.remove());
      }
      (r(!0), setTimeout(() => r(!1), 1400));
    },
    o = () => {
      const i = LANGUAGE_BY_NAME[(e || "").toLowerCase()] || "txt",
        s = i === "Dockerfile" ? "Dockerfile" : `deepseek-output.${i}`,
        u = URL.createObjectURL(new Blob([t], { type: "text/plain" })),
        c = document.createElement("a");
      ((c.href = u), (c.download = s), c.click(), URL.revokeObjectURL(u));
    };
  return jsxRuntime.jsxs("div", {
    style: STYLES.codeWrap,
    children: [
      jsxRuntime.jsxs("div", {
        style: STYLES.codeHead,
        children: [
          jsxRuntime.jsx("span", {
            style: { letterSpacing: "0.12em", textTransform: "uppercase", fontSize: 10 },
            children: e || "code",
          }),
          jsxRuntime.jsxs("span", {
            style: { display: "flex", gap: 8 },
            children: [
              jsxRuntime.jsx("button", { style: STYLES.microBtn, onClick: l, children: n ? "copied ✓" : "copy" }),
              jsxRuntime.jsx("button", { style: STYLES.microBtn, onClick: o, children: "download" }),
          jsxRuntime.jsx("button", {
            style: STYLES.microBtn,
            title: "let the cheap model continue this code (fill-in-the-middle on the beta endpoint)",
            onClick: completeIt,
            children: busy ? "finishing…" : "finish it",
          }),
            ],
          }),
        ],
      }),
      jsxRuntime.jsx("pre", { style: STYLES.pre, children: jsxRuntime.jsx("code", { children: t }) }),
      finish
        ? jsxRuntime.jsxs("div", { style: { borderTop: "1px dashed rgba(120,180,210,0.2)" }, children: [
            jsxRuntime.jsx("div", { style: { fontSize: 10, letterSpacing: "0.16em", color: "var(--kelp)", padding: "6px 2px 0" }, children: "THE MODEL CONTINUED IT WITH" }),
            jsxRuntime.jsx("pre", { style: { ...STYLES.pre, marginTop: 4 }, children: jsxRuntime.jsx("code", { children: finish }) }),
            jsxRuntime.jsx("button", {
              style: { ...STYLES.microBtn, marginTop: 6 },
              onClick: () => {
                navigator.clipboard && navigator.clipboard.writeText(t + finish);
                setFinish("");
              },
              children: "copy the whole thing",
            }),
          ] })
        : null,
      err
        ? jsxRuntime.jsx("div", { style: { fontSize: 11, color: "var(--coral)", paddingTop: 6 }, children: "fill-in-the-middle: " + err })
        : null,
    ],
  });
}
function MarkdownBlock({ text: e }) {
  const t = (e || "").split(`
`),
    n = [];
  let r = 0,
    l = 0;
  for (; r < t.length;) {
    const o = t[r];
    if (o.startsWith("```")) {
      const i = o.slice(3).trim(),
        s = [];
      for (r++; r < t.length && !t[r].startsWith("```");) s.push(t[r++]);
      (r++,
        n.push(
          jsxRuntime.jsx(
            CodeBlock,
            {
              lang: i,
              code: s.join(`
`),
            },
            l++,
          ),
        ));
      continue;
    }
    if (/^\|/.test(o) && /^\|[\s:-|]+\|$/.test((t[r + 1] || "").trim())) {
      const i = o
        .split("|")
        .slice(1, -1)
        .map((u) => u.trim());
      r += 2;
      const s = [];
      for (; r < t.length && /^\|/.test(t[r]);)
        (s.push(
          t[r]
            .split("|")
            .slice(1, -1)
            .map((u) => u.trim()),
        ),
          r++);
      n.push(
        jsxRuntime.jsx(
          "div",
          {
            style: { overflowX: "auto", margin: "10px 0" },
            children: jsxRuntime.jsxs("table", {
              style: STYLES.table,
              children: [
                jsxRuntime.jsx("thead", {
                  children: jsxRuntime.jsx("tr", {
                    children: i.map((u, c) =>
                      jsxRuntime.jsx("th", { style: STYLES.th, children: jsxRuntime.jsx(InlineText, { text: u }) }, c),
                    ),
                  }),
                }),
                jsxRuntime.jsx("tbody", {
                  children: s.map((u, c) =>
                    jsxRuntime.jsx(
                      "tr",
                      {
                        children: u.map((y, g) =>
                          jsxRuntime.jsx("td", { style: STYLES.td, children: jsxRuntime.jsx(InlineText, { text: y }) }, g),
                        ),
                      },
                      c,
                    ),
                  ),
                }),
              ],
            }),
          },
          l++,
        ),
      );
      continue;
    }
    if (/^#{1,4}\s/.test(o)) {
      const i = o.match(/^#+/)[0].length,
        s = { 1: 22, 2: 17, 3: 14.5, 4: 13 };
      (n.push(
        jsxRuntime.jsx(
          "div",
          {
            style: {
              fontFamily: "'Space Grotesk',sans-serif",
              fontSize: s[i],
              fontWeight: 600,
              color: i <= 2 ? "var(--sonar)" : "var(--foam)",
              margin: `${i <= 2 ? 20 : 14}px 0 6px`,
              letterSpacing: "0.01em",
            },
            children: jsxRuntime.jsx(InlineText, { text: o.replace(/^#+\s/, "") }),
          },
          l++,
        ),
      ),
        r++);
      continue;
    }
    if (/^\s*[-*]\s/.test(o)) {
      const i = [];
      for (; r < t.length && /^\s*[-*]\s/.test(t[r]);) i.push(t[r++].replace(/^\s*[-*]\s/, ""));
      n.push(
        jsxRuntime.jsx(
          "ul",
          {
            style: { margin: "6px 0", paddingLeft: 20 },
            children: i.map((s, u) =>
              jsxRuntime.jsx("li", { style: { margin: "3px 0" }, children: jsxRuntime.jsx(InlineText, { text: s }) }, u),
            ),
          },
          l++,
        ),
      );
      continue;
    }
    if (/^\s*\d+[.)]\s/.test(o)) {
      const i = [];
      for (; r < t.length && /^\s*\d+[.)]\s/.test(t[r]);) i.push(t[r++].replace(/^\s*\d+[.)]\s/, ""));
      n.push(
        jsxRuntime.jsx(
          "ol",
          {
            style: { margin: "6px 0", paddingLeft: 22 },
            children: i.map((s, u) =>
              jsxRuntime.jsx("li", { style: { margin: "3px 0" }, children: jsxRuntime.jsx(InlineText, { text: s }) }, u),
            ),
          },
          l++,
        ),
      );
      continue;
    }
    if (/^>\s?/.test(o)) {
      (n.push(jsxRuntime.jsx("div", { style: STYLES.quote, children: jsxRuntime.jsx(InlineText, { text: o.replace(/^>\s?/, "") }) }, l++)),
        r++);
      continue;
    }
    if (o.trim() === "") {
      (n.push(jsxRuntime.jsx("div", { style: { height: 7 } }, l++)), r++);
      continue;
    }
    (n.push(
      jsxRuntime.jsx("p", { style: { margin: "3px 0", lineHeight: 1.62 }, children: jsxRuntime.jsx(InlineText, { text: o }) }, l++),
    ),
      r++);
  }
  return jsxRuntime.jsx("div", { style: { fontSize: 13.5, color: "var(--foam)" }, children: n });
}
/* ---- Line icons, drawn inline so the page stays one file ------------------ */
const ICON_PATHS = {
  mark: ["M20 12.5A8.5 8.5 0 1 1 11.5 4a6.8 6.8 0 0 0 8.5 8.5z"],
  chat: ["M21 11.5a8 8 0 0 1-8 8H8.2L3 22l1.5-4.4A8 8 0 1 1 21 11.5z"],
  chart: ["M5 20V11", "M11 20V4", "M17 20v-6"],
  doc: ["M7 3h7l4 4v14H7z", "M14 3v5h4"],
  gear: [
    "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z",
    "M19.6 14.5a1.6 1.6 0 0 0 .32 1.77l.06.06a1.94 1.94 0 1 1-2.75 2.75l-.06-.06a1.6 1.6 0 0 0-2.72 1.14v.17a1.94 1.94 0 1 1-3.88 0v-.09a1.6 1.6 0 0 0-2.79-1.13l-.06.06a1.94 1.94 0 1 1-2.75-2.75l.06-.06a1.6 1.6 0 0 0-1.14-2.72H4.2a1.94 1.94 0 1 1 0-3.88h.09a1.6 1.6 0 0 0 1.13-2.79l-.06-.06a1.94 1.94 0 1 1 2.75-2.75l.06.06a1.6 1.6 0 0 0 1.77.32h.08a1.6 1.6 0 0 0 .97-1.46V4.2a1.94 1.94 0 1 1 3.88 0v.09a1.6 1.6 0 0 0 2.72 1.14l.06-.06a1.94 1.94 0 1 1 2.75 2.75l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.46.97h.17a1.94 1.94 0 1 1 0 3.88h-.09a1.6 1.6 0 0 0-1.46.97z",
  ],
  code: ["M9 7l-5 5 5 5", "M15 7l5 5-5 5"],
  refresh: ["M20 12a8 8 0 0 1-13.6 5.7L4 16", "M4 20v-4h4", "M4 12a8 8 0 0 1 13.6-5.7L20 8", "M20 4v4h-4"],
  arrow: ["M5 12h13", "M12.5 6l6 6-6 6"],
  wave: ["M4 10v4", "M8 7v10", "M12 4v16", "M16 8v8", "M20 11v2"],
  clip: ["M20.5 11.5l-8 8a4.2 4.2 0 0 1-6-6l8.5-8.5a2.8 2.8 0 0 1 4 4l-8.5 8.5a1.4 1.4 0 0 1-2-2l7.6-7.6"],
  sliders: ["M4 8h9", "M17 8h3", "M4 16h5", "M13 16h7", "M13 8a2 2 0 1 0 4 0 2 2 0 1 0-4 0", "M7 16a2 2 0 1 0 4 0 2 2 0 1 0-4 0"],
};
function Icon({ name, size = 16, color = "var(--sonar)", strokeWidth = 1.6 }) {
  return jsxRuntime.jsx("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    children: (ICON_PATHS[name] || []).map((d, i) => jsxRuntime.jsx("path", { d }, i)),
  });
}

/* Inside App() the short names are the minified ones; here is what they hold:
     e / t         current tab / switch tab        n / r     api key / set api key
     l / o         key field draft / set draft     i / s     settings / set settings
     u / c         cheat sheet doc / set doc       y / g     cost totals / set totals
     m / x         chat messages / set messages    S / E     composer text / set text
     B / f         request in flight / set it      a / p     saved ideas / set ideas
     v / C         idea busy / set it              T / N     docs poll busy / set it
     P / M         key test message / set it       L / Ce    app ready / set ready
     Ve / Qe       scroll ref / abort ref          fileInput  hidden file picker       */
/* ---- Daily-idea card pieces ---------------------------------------------- */
function ideaUnitCost(unit) {
  const f = PRICES["deepseek-flash"];
  const inTok = unit.input_tokens_per_job,
    outTok = unit.output_tokens_per_job,
    hit = unit.cache_hit_ratio;
  return (inTok * (1 - hit) * f.miss + inTok * hit * f.hit + outTok * f.out) / 1e6;
}

/* The numbers the idea claims, recomputed here from the price table, so a wrong
   count is visible at a glance instead of taken on trust. */
function IdeaUnitTable({ unit }) {
  const expected = ideaUnitCost(unit);
  const rows = [
    ["Input tokens per job", Number(unit.input_tokens_per_job).toLocaleString()],
    ["Cache-hit ratio", Math.round(unit.cache_hit_ratio * 100) + "% at $0.003/M"],
    ["Output tokens per job", Number(unit.output_tokens_per_job).toLocaleString() + " at $0.60/M"],
    ["Cost per job, off-peak", "$" + expected.toFixed(8)],
    ["Price to customer", "$" + Number(unit.price_to_customer_usd).toFixed(4)],
    ["Gross margin", String(unit.gross_margin)],
  ];
  return jsxRuntime.jsx("table", {
    style: STYLES.table,
    children: jsxRuntime.jsx("tbody", {
      children: rows.map(([k, v], i) =>
        jsxRuntime.jsxs(
          "tr",
          {
            children: [
              jsxRuntime.jsx("td", { style: STYLES.td, children: k }),
              jsxRuntime.jsx("td", {
                style: { ...STYLES.td, textAlign: "right", fontFamily: "'JetBrains Mono',monospace" },
                children: v,
              }),
            ],
          },
          i,
        ),
      ),
    }),
  });
}

/* A reply that says "### file: <path>" and then a fenced block is proposing a write.
   Everything here is a proposal until the button is pressed. */
function fileBlocks(text) {
  const out = [];
  const re = /(?:^|\n)(?:#{2,4}\s*file:\s*([^\n`]+)|\*\*([^\n`*]+)\*\*)\n+```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const bold = m[2] ? m[2].trim() : "";
    if (bold && !/^[\w./-]+\.\w+$/.test(bold)) continue; /* a bold line only counts when it looks like a filename */
    const path = (m[1] || bold).trim();
    if (path) out.push({ path, code: m[3] });
  }
  return out;
}

/* A reply can also carry a unified diff. Those get their own card, applied hunk by hunk
   after the helper has checked each hunk against the file as it is right now. */
function findPatch(text) {
  const src = String(text || "");
  const fence = src.match(/```(?:diff|patch)?\n([\s\S]*?)```/);
  const body = fence ? fence[1] : src;
  if (!/^---\s+\S+/m.test(body) || !/^\+\+\+\s+\S+/m.test(body) || !/^@@/m.test(body)) return null;
  const files = [];
  let cur = null;
  for (const line of body.split("\n")) {
    const m = line.match(/^\+\+\+\s+(?:b\/)?(.+?)\s*$/);
    if (m) {
      cur = { path: m[1], hunks: 0, added: 0, removed: 0 };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^@@/.test(line)) cur.hunks++;
    else if (/^\+/.test(line) && !/^\+\+\+/.test(line)) cur.added++;
    else if (/^-/.test(line) && !/^---/.test(line)) cur.removed++;
  }
  return files.length ? { patch: body, files } : null;
}

function PatchReview({ found, onNote }) {
  const [report, setReport] = React.useState(null);
  const [busy, setBusy] = React.useState("");
  const [done, setDone] = React.useState(null);

  const send = async (dryRun) => {
    setBusy(dryRun ? "checking" : "applying");
    try {
      const r = await (
        await fetch(HELPER_URL + "/fs/patch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ patch: found.patch, dryRun }),
        })
      ).json();
      if (r.error) {
        onNote("the patch was refused: " + r.error);
        setBusy("");
        return;
      }
      if (dryRun) {
        setReport(r);
        onNote(
          r.conflicts
            ? r.conflicts + " file(s) would conflict — those hunks are shown, nothing was written"
            : "every hunk lines up — press apply when you are happy",
        );
      } else {
        setDone(r);
        onNote("applied to " + r.applied + " file(s)" + (r.conflicts ? ", " + r.conflicts + " left alone (conflicts)" : ""));
      }
    } catch (err) {
      onNote("the helper is not answering");
    }
    setBusy("");
  };

  const undo = async (path) => {
    const r = await (
      await fetch(HELPER_URL + "/fs/undo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      })
    ).json();
    onNote(r.ok ? "put " + path + " back" : "nothing to undo: " + r.error);
  };

  return jsxRuntime.jsxs("div", {
    style: { ...STYLES.card, borderColor: "rgba(255,180,84,0.35)" },
    children: [
      jsxRuntime.jsxs("div", {
        style: { fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, marginBottom: 6 },
        children: [
          "This reply proposes a patch to ",
          found.files.length,
          found.files.length === 1 ? " file" : " files",
          jsxRuntime.jsx("span", { style: { color: "var(--kelp)", fontWeight: 400 }, children: " — checked hunk by hunk before anything is written" }),
        ],
      }),
      found.files.map((f) =>
        jsxRuntime.jsxs(
          "div",
          { style: { fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, padding: "3px 0" }, children: [
            jsxRuntime.jsx("span", { style: { color: "var(--foam)" }, children: f.path }),
            jsxRuntime.jsx("span", { style: { color: "var(--kelp)" }, children: "  " + f.hunks + " hunk" + (f.hunks === 1 ? "" : "s") + " · " }),
            jsxRuntime.jsx("span", { style: { color: "#3FB950" }, children: "+" + f.added }),
            " ",
            jsxRuntime.jsx("span", { style: { color: "var(--coral)" }, children: "−" + f.removed }),
          ] },
          f.path,
        ),
      ),
      jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }, children: [
        jsxRuntime.jsx("button", { style: STYLES.microBtn, disabled: !!busy, onClick: () => send(true), children: busy === "checking" ? "checking…" : "check the hunks" }),
        jsxRuntime.jsx("button", { style: STYLES.microBtn, disabled: !!busy || !report, onClick: () => send(false), children: busy === "applying" ? "applying…" : "apply" }),
        done
          ? jsxRuntime.jsx("button", {
              style: STYLES.microBtn,
              onClick: () => done.files.filter((f) => f.applied).forEach((f) => undo(f.path)),
              children: "undo all of it",
            })
          : null,
      ] }),
      report
        ? jsxRuntime.jsx("div", { style: { marginTop: 8 }, children: report.files.map((f) =>
            jsxRuntime.jsxs("div", { style: { fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: f.clean ? "#3FB950" : "var(--coral)" }, children: [
              f.path + (f.clean ? " — every hunk lines up" : " — conflicts, left untouched"),
              !f.clean
                ? jsxRuntime.jsx("pre", { style: { ...STYLES.pre, marginTop: 4, fontSize: 10.5 }, children: f.report.filter((r2) => r2.conflict).map((r2) => "hunk at line " + r2.from + " expected:\n  " + (r2.expected || []).join("\n  ")).join("\n") })
                : null,
            ] }, f.path)) })
        : null,
      done
        ? jsxRuntime.jsx("div", { style: { marginTop: 8, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--kelp)" }, children: done.files.map((f) => f.path + (f.applied ? " — written (undo above)" : " — not written")).join("\n") })
        : null,
    ],
  });
}

function WriteReview({ blocks, onNote }) {
  const [rows, setRows] = React.useState(blocks.map((b) => ({ ...b, state: "idle", diff: null, wrote: null })));
  const patch = (i, p) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const compare = async (i) => {
    patch(i, { state: "comparing" });
    try {
      const cur = await (await fetch(HELPER_URL + "/fs/read?path=" + encodeURIComponent(rows[i].path))).json();
      const before = typeof cur.text === "string" ? cur.text : "";
      const beforeLines = before.split("\n");
      const afterLines = rows[i].code.split("\n");
      /* a real line diff: trim the common ends, LCS the middle */
      let s = 0;
      while (s < beforeLines.length && s < afterLines.length && beforeLines[s] === afterLines[s]) s++;
      let e1 = beforeLines.length, e2 = afterLines.length;
      while (e1 > s && e2 > s && beforeLines[e1 - 1] === afterLines[e2 - 1]) { e1--; e2--; }
      const a = beforeLines.slice(s, e1), b2 = afterLines.slice(s, e2);
      const out = [];
      for (let k = Math.max(0, s - 2); k < s; k++) out.push({ t: "ctx", text: beforeLines[k] });
      let added = 0, removed = 0;
      if (a.length * b2.length > 600000) {
        a.forEach((L) => { out.push({ t: "del", text: L }); removed++; });
        b2.forEach((L) => { out.push({ t: "add", text: L }); added++; });
      } else {
        const n1 = a.length, n2 = b2.length;
        const dp = Array.from({ length: n1 + 1 }, () => new Uint16Array(n2 + 1));
        for (let x2 = n1 - 1; x2 >= 0; x2--)
          for (let y2 = n2 - 1; y2 >= 0; y2--)
            dp[x2][y2] = a[x2] === b2[y2] ? dp[x2 + 1][y2 + 1] + 1 : Math.max(dp[x2 + 1][y2], dp[x2][y2 + 1]);
        let x2 = 0, y2 = 0;
        while (x2 < n1 && y2 < n2) {
          if (a[x2] === b2[y2]) { out.push({ t: "ctx", text: a[x2] }); x2++; y2++; }
          else if (dp[x2 + 1][y2] >= dp[x2][y2 + 1]) { out.push({ t: "del", text: a[x2] }); removed++; x2++; }
          else { out.push({ t: "add", text: b2[y2] }); added++; y2++; }
        }
        while (x2 < n1) { out.push({ t: "del", text: a[x2] }); removed++; x2++; }
        while (y2 < n2) { out.push({ t: "add", text: b2[y2] }); added++; y2++; }
      }
      for (let k = e1; k < Math.min(beforeLines.length, e1 + 2); k++) out.push({ t: "ctx", text: beforeLines[k] });
      const shown = out.slice(0, 160);
      patch(i, { state: "ready", diff: { added, removed, rows: shown, hidden: Math.max(0, out.length - shown.length), existed: before !== "" } });
    } catch (err) {
      patch(i, { state: "error" });
      onNote("could not read " + rows[i].path + " to compare: " + String(err.message || err));
    }
  };

  const write = async (i) => {
    patch(i, { state: "writing" });
    try {
      const res = await (
        await fetch(HELPER_URL + "/fs/write", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: rows[i].path, text: rows[i].code, why: "from the chat" }),
        })
      ).json();
      if (!res.ok) {
        patch(i, { state: "error" });
        onNote("the write failed: " + res.error);
        return;
      }
      patch(i, { state: "written", wrote: res.bytes });
      onNote("wrote " + res.path + " (" + res.bytes + " bytes)" + (res.existed ? " — the previous version is kept, undo any time" : " — it did not exist before"));
    } catch (err) {
      patch(i, { state: "error" });
      onNote("the helper is not answering — start it with:  node ~/abyss-console/abyss-bridge.mjs");
    }
  };

  const undo = async (i) => {
    try {
      const res = await (
        await fetch(HELPER_URL + "/fs/undo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: rows[i].path }),
        })
      ).json();
      if (!res.ok) {
        onNote("nothing to undo for that file: " + res.error);
        return;
      }
      patch(i, { state: "undone", wrote: null });
      onNote("put " + res.path + " back" + (res.removedFile ? " (it did not exist before, so it is gone again)" : ""));
    } catch (err) {
      onNote("undo failed: " + String(err.message || err));
    }
  };

  return jsxRuntime.jsxs("div", {
    style: { ...STYLES.card, borderColor: "rgba(79,216,235,0.35)" },
    children: [
      jsxRuntime.jsxs("div", {
        style: { fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, marginBottom: 6 },
        children: [
          "This reply proposes writing ",
          rows.length,
          rows.length === 1 ? " file" : " files",
          jsxRuntime.jsx("span", { style: { color: "var(--kelp)", fontWeight: 400 }, children: " — nothing is written until you press it" }),
        ],
      }),
      rows.map((r, i) =>
        jsxRuntime.jsxs(
          "div",
          {
            style: {
              borderTop: i ? "1px solid rgba(120,180,210,0.14)" : "none",
              padding: "8px 0",
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 11.5,
            },
            children: [
              jsxRuntime.jsxs("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }, children: [
                jsxRuntime.jsx("span", { style: { color: "var(--foam)" }, children: r.path }),
                jsxRuntime.jsxs("span", { style: { color: "var(--kelp)" }, children: [r.code.split("\n").length, " lines"] }),
                r.state === "ready" && r.diff
                  ? jsxRuntime.jsxs("span", { children: [
                      jsxRuntime.jsx("span", { style: { color: "#3FB950" }, children: "+" + r.diff.added }),
                      " ",
                      jsxRuntime.jsx("span", { style: { color: "var(--coral)" }, children: "−" + r.diff.removed }),
                    ] })
                  : null,
                jsxRuntime.jsx("span", { style: { marginLeft: "auto", display: "flex", gap: 6 } , children: [
                  jsxRuntime.jsx("button", { style: STYLES.microBtn, disabled: r.state === "comparing", onClick: () => compare(i), children: r.state === "ready" ? "compare again" : "compare" }),
                  jsxRuntime.jsx("button", { style: STYLES.microBtn, disabled: r.state === "writing", onClick: () => write(i), children: r.state === "written" ? "written ✓" : "write" }),
                  r.state === "written" || r.state === "undone"
                    ? jsxRuntime.jsx("button", { style: STYLES.microBtn, onClick: () => undo(i), children: "undo" })
                    : null,
                ] }),
              ] }),
              r.state === "ready" && r.diff
                ? jsxRuntime.jsxs("div", { children: [
                    r.diff.existed && r.diff.removed > 20 && r.diff.removed > r.diff.added
                      ? jsxRuntime.jsx("div", { style: { fontSize: 11, color: "var(--coral)", marginTop: 6 }, children: "this rewrite removes " + r.diff.removed + " lines and adds " + r.diff.added + " — an edit this size is safer as a unified diff; ask the model for one" })
                      : null,
                    r.diff.rows && r.diff.rows.length
                      ? jsxRuntime.jsx("pre", { style: { ...STYLES.pre, marginTop: 6, fontSize: 10.5, maxHeight: 220, lineHeight: 1.5 }, children: r.diff.rows.map((z, zi) => jsxRuntime.jsx("div", { style: { color: z.t === "add" ? "#3FB950" : z.t === "del" ? "var(--coral)" : "var(--kelp)" }, children: (z.t === "add" ? "+ " : z.t === "del" ? "− " : "  ") + z.text }, zi)) })
                      : null,
                    r.diff.hidden
                      ? jsxRuntime.jsx("div", { style: { fontSize: 10.5, color: "var(--kelp)", marginTop: 2 }, children: "… " + r.diff.hidden + " more diff lines not shown" })
                      : null,
                  ] })
                : null,
              r.state === "written"
                ? jsxRuntime.jsx("div", { style: { color: "var(--kelp)", marginTop: 4 }, children: "written — press undo to put the previous version back" })
                : null,
              r.state === "undone"
                ? jsxRuntime.jsx("div", { style: { color: "var(--kelp)", marginTop: 4 }, children: "put back" })
                : null,
            ],
          },
          i,
        ),
      ),
    ],
  });
}

function App() {
  const [e, t] = React.useState("chat"),
    [n, r] = React.useState(""),
    [l, o] = React.useState(""),
    [i, s] = React.useState(DEFAULT_SETTINGS),
    [u, c] = React.useState({ text: CHEATSHEET, bulletins: [], verified: BASELINE_VERIFIED }),
    [y, g] = React.useState({ hit: 0, miss: 0, out: 0, cost: 0, calls: 0 }),
    [m, x] = React.useState([]),
    [S, E] = React.useState(""),
    [B, f] = React.useState(!1),
    [a, p] = React.useState({}),
    [v, C] = React.useState(!1),
    [T, N] = React.useState(!1),
    [P, M] = React.useState(""),
    [L, Ce] = React.useState(!1),
    [liveModels, setLiveModels] = React.useState(["deepseek-flash", "deepseek-v4-pro"]),
    [ideaError, setIdeaError] = React.useState(""),
    [ideaStatus, setIdeaStatus] = React.useState(""),
    [helper, setHelper] = React.useState(null),
    [helperMsg, setHelperMsg] = React.useState(""),
    [roomInfo, setRoomInfo] = React.useState(null),
    [files, setFiles] = React.useState([]),
    [attachOpen, setAttachOpen] = React.useState(!1),
    [attachPath, setAttachPath] = React.useState(""),
    [folderPath, setFolderPath] = React.useState(""),
    [attachMsg, setAttachMsg] = React.useState(""),
    [ocrOn, setOcrOn] = React.useState(!1),
    [project, setProject] = React.useState(null),
    [projectMap, setProjectMap] = React.useState(""),
    [projectMsg, setProjectMsg] = React.useState(""),
    [projPath, setProjPath] = React.useState(""),
    [projQuery, setProjQuery] = React.useState(""),
    [projHits, setProjHits] = React.useState(null),
    [projBusy, setProjBusy] = React.useState(!1),
    [daily, setDaily] = React.useState(null),
    [budgetStop, setBudgetStop] = React.useState(""),
    [pendingReview, setPendingReview] = React.useState(""),
    [journal, setJournal] = React.useState(null),
    [sessionTags, setSessionTags] = React.useState(""),
    [libNote, setLibNote] = React.useState(""),
    [forecast, setForecast] = React.useState(null),
    [compare, setCompare] = React.useState(null),
    [compareBusy, setCompareBusy] = React.useState(false),
    [pinned, setPinned] = React.useState([]),
    [trace, setTrace] = React.useState(""),
    [triage, setTriage] = React.useState(null),
    [traceOpen, setTraceOpen] = React.useState(false),
    [journalMsg, setJournalMsg] = React.useState(""),
    [sent, setSent] = React.useState(null),
    [confirmKill, setConfirmKill] = React.useState(""),
    [confirmUnpin, setConfirmUnpin] = React.useState(""),
    [sessions, setSessions] = React.useState([]),
    [sessionName, setSessionName] = React.useState(""),
    [sessionQuery, setSessionQuery] = React.useState(""),
    [sessionOpen, setSessionOpen] = React.useState(!1),
    [sessionMsg, setSessionMsg] = React.useState(""),
    [recipes, setRecipes] = React.useState([]),
    [recipeName, setRecipeName] = React.useState(""),
    [recipeText, setRecipeText] = React.useState(""),
    [redacted, setRedacted] = React.useState(""),
    [writes, setWrites] = React.useState(null),
    [runCmd, setRunCmd] = React.useState(""),
    [runBusy, setRunBusy] = React.useState(!1),
    [lastRun, setLastRun] = React.useState(null),
    [loopBusy, setLoopBusy] = React.useState(!1),
    Ve = React.useRef(null),
    Qe = React.useRef(null),
    fileInput = React.useRef(null),
    loopCancel = React.useRef(!1),
    cmpAbort = React.useRef(null),
    mRef = React.useRef([]);
  /* the fix loop awaits between rounds, so it reads messages from a ref, never a stale closure */
  mRef.current = m;
  (React.useEffect(() => {
    (async () => {
      const [h, z, A, F, U, day, savedSessions, savedRecipes] = await Promise.all([
        storageGet(STORAGE_KEYS.key),
        storageGet(STORAGE_KEYS.settings),
        storageGet(STORAGE_KEYS.doc),
        storageGet(STORAGE_KEYS.totals),
        storageGet(STORAGE_KEYS.ideas),
        storageGet(STORAGE_KEYS.daily),
        storageGet(STORAGE_KEYS.sessions),
        storageGet(STORAGE_KEYS.recipes),
      ]);
      (h && (r(h), o(h)),
        z &&
          s({
            ...DEFAULT_SETTINGS,
            ...z,
            ...(z.model && ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(z.model)
              ? { model: "deepseek-flash" }
              : {}),
            ...(z.mcpUrl === "http://127.0.0.1:3000" ? { mcpUrl: "http://127.0.0.1:13001" } : {}),
          }),
        A && c(A),
        F && g(F),
        U && p(U),
        day && day.date === todayIndiana() && setDaily(day),
        Array.isArray(savedSessions) && setSessions(savedSessions),
        Array.isArray(savedRecipes) && setRecipes(savedRecipes),
        Ce(!0),
        h || t("settings"),
        setTimeout(() => probeHelper(!0), 300));
    })();
  }, []),
    /* While this page is open it tells the helper it is here. When the page closes the
       messages stop, and the helper lets its heavy parts go (the room bridge child). */
    React.useEffect(() => {
      const ping = () => {
        if (document.visibilityState === "hidden") return;
        fetch(HELPER_URL + "/health", { cache: "no-store" }).catch(() => {});
      };
      ping();
      const timer = setInterval(ping, 20000);
      document.addEventListener("visibilitychange", ping);
      return () => {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", ping);
      };
    }, []),
    React.useEffect(() => {
      if (!pendingReview) return;
      setPendingReview("");
      sendMessage("", pendingReview);
    }, [pendingReview]),
    React.useEffect(() => {
      Ve.current && (Ve.current.scrollTop = Ve.current.scrollHeight);
    }, [m, B]),
    React.useEffect(() => {
      const h = globalThis.DCEngine;
      if (!h) return () => {};
      const z = h.onChange(() => McpBump((A) => A + 1));
      return () => {
        (z(), h.denyAll());
      };
    }, []));
  const jn = React.useCallback(() => {
      const h = u.bulletins || [];
      return h.length
        ? u.text +
            `

## LIVE VERIFICATION BULLETINS (newest first — these OVERRIDE the baseline where they conflict)
` +
            h.map(
              (z) => `
### Bulletin — ${z.date}
${z.text}`,
            ).join(`
`)
        : u.text;
    }, [u]),
    recordUsage = async (h, z) => {
      if (!z) return;
      const A = z.prompt_cache_hit_tokens || 0,
        F = z.prompt_cache_miss_tokens ?? Math.max(0, (z.prompt_tokens || 0) - A),
        U = z.completion_tokens || 0,
        te = priceFor(h, { hit: A, miss: F, out: U });
      return (
        g((ne) => {
          const xr = {
            hit: ne.hit + A,
            miss: ne.miss + F,
            out: ne.out + U,
            cost: ne.cost + te,
            calls: ne.calls + 1,
          };
          storageSet(STORAGE_KEYS.totals, xr);
          const day = todayIndiana();
          setDaily((prev) => {
            const base = prev && prev.date === day ? prev : { date: day, cost: 0, calls: 0, byProject: {} };
            const key = project ? project.root : "~";
            const before = (base.byProject && base.byProject[key]) || { cost: 0, calls: 0 };
            const next = {
              date: day,
              cost: base.cost + te,
              calls: base.calls + 1,
              byProject: {
                ...(base.byProject || {}),
                [key]: { cost: before.cost + te, calls: before.calls + 1 },
              },
            };
            storageSet(STORAGE_KEYS.daily, next);
            return next;
          });
          return xr;
        }),
        { hit: A, miss: F, out: U, cost: te }
      );
    },
    Tn = (h, z) => {
      const pinnedText = (i.pinned || []).map((p2) => "\n\n## PINNED: " + p2.name + "\n" + p2.text).join("");
      const A = [
          {
            role: "system",
            content:
              CHEATSHEET +
              pinnedText +
              `

` +
              MCP_CONTRACT_TEXT +
              (i.mcpOn && globalThis.DCEngine ? globalThis.DCEngine.contract(i.mcpGate) : ""),
          },
        ],
        F = h
          .filter((U) => !U.error && !U.display && !/^\*\*Cost of that turn\*\*/.test(String(U.content || "")))
          .flatMap((U) =>
            U.role === "tool"
              ? [{ role: "tool", tool_call_id: U.toolCallId, content: U.content }]
              : U.toolCalls && U.toolCalls.length
                ? [
                    {
                      role: "assistant",
                      content: U.content || "",
                      reasoning_content: U.reasoning || "",
                      tool_calls: U.toolCalls.map((Ua) => ({
                        id: Ua.id,
                        type: "function",
                        function: { name: Ua.function.name, arguments: Ua.function.arguments },
                      })),
                    },
                  ]
                : [{ role: U.role, content: U.content }],
          );
      return [
        ...A,
        ...F,
        {
          role: "user",
          content:
            z +
            "\n\n" +
            `Live doc bulletins + today: ${todayIndiana()} (Indiana Eastern). Docs last web-verified: ${u.verified}.` +
            ((u.bulletins || []).length
              ? "\nBulletins (override baseline):\n" +
                u.bulletins.map((U) => `[${U.date}] ${U.text}`).join("\n")
              : ""),
        },
      ];
    },
    sendMessage = async (h, reviewOf) => {
      const asked = reviewOf
        ? "Review your previous answer to this and be blunt about what is wrong, what you would change, and what it would cost: " + reviewOf
        : "";
      const draft = (h ?? S).trim() || asked;
      const attached = files;
      const fileText = attached
        .filter((f) => f.kind !== "image" && f.text)
        .map((f) => "\n\n### attached: " + f.name + "\n```\n" + f.text + "\n```")
        .join("");
      const pictureNote = attached
        .filter((f) => f.kind === "image")
        .map((f) => "\n\n(picture attached and sent to the model: " + f.name + (f.ocr ? ", plus its OCR text below" : "") + ")")
        .join("");
      const pictures = attached.filter((f) => f.kind === "image").map((f) => f.dataUrl);
      const scrub = globalThis.AbyRedact || { redact: (t) => ({ text: t, found: [], count: 0 }) };
      const composed = (draft || (attached.length ? "Here are the files." : "")) + fileText + pictureNote;
      const cleaned = i.redact === false ? { text: composed, found: [], count: 0, off: true } : scrub.redact(composed);
      if (cleaned.count) setRedacted(scrub.summary(cleaned.found));
      const z = cleaned.text;
      if (!z.trim() || B) return;
      if (!n) {
        (t("settings"), M("Add your DeepSeek key first — everything runs on it."));
        return;
      }
      const scope = project ? project.root : "~";
      const today = daily && daily.date === todayIndiana() ? daily : { cost: 0, calls: 0, byProject: {} };
      const scoped = (today.byProject && today.byProject[scope]) || { cost: 0, calls: 0 };
      const projectBudget = (i.projectBudgets || {})[scope];
      const spentToday = projectBudget != null ? scoped.cost : today.cost;
      const budget = projectBudget != null ? Number(projectBudget) : Number(i.budgetUsd);
      if (!cleaned.off && budget > 0 && spentToday >= budget) {
        setBudgetStop(
          (projectBudget != null ? "This project's budget" : "Today's budget") +
            " is spent: " +
            fmtCost(spentToday) +
            " of " +
            fmtCost(budget) +
            ". Raise it in Settings, or wait for tomorrow (the counter resets on the date).",
        );
        return;
      }
      setBudgetStop("");
      E("");
      setFiles([]);
      setAttachOpen(!1);
      let tools = null;
      if (i.mcpOn) {
        try {
          const st = globalThis.DCEngine.state();
          if (st.status !== "ready" || st.url !== i.mcpUrl) {
            const snap = await globalThis.DCEngine.connect(i.mcpUrl, i.mcpToken);
            M(
              "Desktop Commander connected · " +
                snap.tools.length +
                " tools (" +
                (snap.transport || "ws") +
                ")",
            );
          }
          tools = globalThis.DCEngine.openAiTools();
        } catch (te) {
          const rr = globalThis.DCEngine.state().lastReason;
          x((F) => [
            ...F,
            { role: "user", content: z },
            {
              role: "assistant",
              error: !0,
              content:
                "Desktop Commander MCP failed" +
                (rr
                  ? " [" + rr.code + "] " + rr.headline + " → " + rr.advice
                  : ": " + String(te.message || te)) +
                " — or switch the MCP toggle off / run diagnose in Settings.",
            },
          ]);
          return;
        }
      }
      const A = m;
      (x((F) => [
        ...F,
        { role: "user", content: z },
        { role: "assistant", content: "", reasoning: "", streaming: !0, model: i.model },
      ]),
        f(!0),
        (Qe.current = new AbortController()));
      if (helper && i.mcpOn) {
        tools = [
          ...(tools || []),
          {
            type: "function",
            function: {
              name: "use_room",
              description:
                "Call a tool on one of the MCP room's servers. Use room_list_servers or room_search_tools first to find the server and tool names. Example: { server: 'your-git-mcp', tool: 'git_status', arguments: { path: '~/some-repo' } }",
              parameters: {
                type: "object",
                properties: {
                  server: { type: "string", description: "the room server name" },
                  tool: { type: "string", description: "the tool on that server" },
                  arguments: { type: "object", description: "the arguments for that tool" },
                },
                required: ["server", "tool"],
              },
            },
          },
        ];
      }
      if (project) {
        tools = [
          ...(tools || []),
          {
            type: "function",
            function: {
              name: "read_project_files",
              description:
                "Read files from the indexed project by path. Ask only for paths you saw on the project map; up to 24 files, 512 kB each.",
              parameters: {
                type: "object",
                properties: {
                  paths: {
                    type: "array",
                    items: { type: "string" },
                    description: "project-relative or absolute paths",
                  },
                },
                required: ["paths"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "search_project",
              description:
                "Plain-text search across the indexed project; returns file:line hits. Use it to find where something lives or how it is spelled before asking for files.",
              parameters: {
                type: "object",
                properties: { pattern: { type: "string", description: "the text to look for" } },
                required: ["pattern"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "find_references",
              description:
                "Find the places a name is used across the indexed project (text-level; the matching lines come back). Use it before renaming or moving anything.",
              parameters: {
                type: "object",
                properties: { name: { type: "string", description: "the exact name to find" } },
                required: ["name"],
              },
            },
          },
        ];
      }
      const forecastNow = estimateSend();
      setForecast({ ...forecastNow, at: new Date().toISOString(), spent: 0 });
      let turnCost = 0;
      const H = Tn(A, z);
      if (pictures.length) {
        /* pictures go in as picture blocks, and only on this turn's first call */
        const last = H[H.length - 1];
        if (last && last.role === "user") {
          const text = typeof last.content === "string" ? last.content : "";
          last.content = [
            { type: "text", text },
            ...pictures.map((url) => ({ type: "image_url", image_url: { url } })),
          ];
        }
      }
      try {
        for (let step = 0; step < 8; step++) {
          const F = await callDeepSeek({
              apiKey: n,
              scrub: i.redact !== false,
              model: i.model,
              messages: H,
              thinking: i.thinking,
              effort: i.effort,
              maxTokens: i.maxTokens,
              signal: Qe.current.signal,
              tools,
              onDelta: ({ reasoning: te, content: ne }) =>
                x((xr) => {
                  const Pn = [...xr];
                  return ((Pn[Pn.length - 1] = { ...Pn[Pn.length - 1], reasoning: te, content: ne }), Pn);
                }),
            }),
            U = F.usage ? await recordUsage(i.model, F.usage) : void 0;
          turnCost += (U && U.cost) || 0;
          x((te) => {
            const ne = [...te];
            return (
              (ne[ne.length - 1] = {
                role: "assistant",
                content: F.content,
                reasoning: F.reasoning,
                usage: U,
                model: i.model,
                streaming: !1,
                finish: F.finishReason,
                toolCalls: F.toolCalls && F.toolCalls.length ? F.toolCalls : void 0,
              }),
              ne
            );
          });
          if (!(F.toolCalls && F.toolCalls.length && tools)) {
            F.finishReason === "length" &&
              x((te) => [
                ...te,
                {
                  role: "assistant",
                  error: !0,
                  content:
                    'Heads-up: the reply hit the max_tokens ceiling (finish_reason "length"). Raise Max output in Settings or lower reasoning effort, then ask me to continue.',
                },
              ]);
            break;
          }
          H.push({
            role: "assistant",
            content: F.content || "",
            reasoning_content: F.reasoning || "",
            tool_calls: F.toolCalls.map((te) => ({
              id: te.id,
              type: "function",
              function: { name: te.function.name, arguments: te.function.arguments },
            })),
          });
          for (const te of F.toolCalls) {
            let ne = {};
            try {
              ne = JSON.parse(te.function.arguments || "{}");
            } catch {}
            x((Fr) => [
              ...Fr,
              {
                role: "tool",
                toolCallId: te.id,
                name: te.function.name,
                args: ne,
                status: "running",
                content: "",
              },
            ]);
            const readOnlyRoomTools = ["room_status", "room_list_servers", "room_search_tools", "room_describe_tool", "room_list_resources", "room_read_resource"];
            let Fe;
            if (te.function.name === "read_project_files") {
              Fe = { status: "executed", result: await readProjectFiles(ne.paths) };
            } else if (te.function.name === "search_project") {
              Fe = { status: "executed", result: await searchProjectText(String(ne.pattern || ""), false) };
            } else if (te.function.name === "find_references") {
              Fe = { status: "executed", result: await searchProjectText(String(ne.name || ""), true) };
            } else if (te.function.name === "use_room") {
              const blockedByPlan = i.mcpGate === "PLAN";
              const needsPermission = i.mcpGate === "ASK ALWAYS" || (i.mcpGate === "ASK WHEN NEEDED" && readOnlyRoomTools.indexOf(ne.tool) === -1);
              if (blockedByPlan) {
                Fe = { status: "blocked", reason: "PLAN mode: nothing runs, not even a room call" };
              } else if (needsPermission) {
                Fe = {
                  status: "needs-approval",
                  reason:
                    '"' + ne.server + "." + ne.tool + '" can change things. Switch the MCP gate to YOLO to let the model run it, or call it yourself from Settings.',
                };
              } else {
                try {
                  const roomRes = await (
                    await fetch(HELPER_URL + "/room/call", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ server: ne.server, tool: ne.tool, arguments: ne.arguments || {} }),
                    })
                  ).json();
                  Fe = { status: "executed", result: String(roomRes.text || "").slice(0, 12000) };
                } catch (err) {
                  Fe = { status: "error", error: "the helper could not reach the room: " + String(err.message || err) };
                }
              }
            } else {
              Fe = await globalThis.DCEngine.runGuarded(i.mcpGate, te.function.name, ne, { signal: Qe.current.signal });
            }
            const Ue =
              Fe.status === "executed"
                  ? Fe.result || "(empty result)"
                  : "[" +
                    (Fe.status || "error").toUpperCase() +
                    "] " +
                    (Fe.error || Fe.reason || "not executed");
            const ueFull = String(Ue);
            H.push({
              role: "tool",
              tool_call_id: te.id,
              content:
                ueFull.length > 12e3
                  ? ueFull.slice(0, 12e3) + "\n…[cut at 12,000 characters — ask for a smaller piece, a narrower search, or another file]"
                  : ueFull,
            });
            x((Fr) => {
              const Rn = [...Fr];
              return (
                (Rn[Rn.length - 1] = {
                  ...Rn[Rn.length - 1],
                  status: Fe.status,
                  ok: Fe.status === "executed",
                  content: String(Ue).slice(0, 2e3),
                }),
                Rn
              );
            });
          }
          if (step === 7) {
            x((te) => [...te, { role: "assistant", error: !0, content: "the tool loop hit its 8-step cap for this turn — everything above is kept; send 'continue' and it picks up from the results it already has." }]);
            break;
          }
          x((F) => [...F, { role: "assistant", content: "", reasoning: "", streaming: !0, model: i.model }]);
        }
      } catch (F) {
        globalThis.DCEngine && globalThis.DCEngine.denyAll();

        const U = String(F.message || F);
        x((te) => {
          const ne = [...te];
          return (
            (ne[ne.length - 1] = {
              role: "assistant",
              error: !0,
              streaming: !1,
              lastUser: z,
              content: U.includes("Failed to fetch")
                ? "Couldn't reach api.deepseek.com from this browser. It is not a CORS problem — DeepSeek explicitly allows browser calls (verified 2026-08-04). So this is almost certainly your own network: a VPN, firewall, DNS filter, or an offline moment. Options: retry the request, or check your connection."
                : "DeepSeek returned an error: " +
                  U +
                  (U.includes("402")
                    ? " — that's an empty balance; top up at platform.deepseek.com."
                    : U.includes("401")
                      ? " — that's a bad/revoked key; re-paste it in Settings."
                      : ""),
            }),
            ne
          );
        });
      }
          setForecast((prev) => {
            if (!prev) return prev;
            const diff = prev.usd > 0 ? ((turnCost - prev.usd) / prev.usd) * 100 : 0;
            x((F2) => [
              ...F2,
              {
                role: "assistant",
                display: !0,
                content:
                "**Cost of that turn** — forecast " + fmtCost(prev.usd) + " (" + prev.total.toLocaleString() + " tokens in, assuming " +
                Math.round((prev.hitRatio || 0) * 100) + "% cache hits" + (prev.cold ? " (cold session — worst case; it improves as the cache warms)" : " (your session's own rate)") + ", and " + Math.min(Number(i.maxTokens) || 4000, 4000).toLocaleString() + " tokens out), actual " + fmtCost(turnCost) + " — " +
                (diff >= 0 ? "+" : "") + diff.toFixed(0) + "% against the forecast. Model " + i.model + (i.thinking ? " · thinking " + i.effort : " · thinking off") + (prev.peak ? " · peak pricing" : "") + ".",
              },
            ]);
            return { ...prev, spent: turnCost };
          });
      f(!1);
    },
    /* ---- attachments: browser picks, machine paths, whole folders ---------- */
    addFiles = (list) => {
      const incoming = Array.from(list || []);
      if (!incoming.length) return;
      setAttachMsg("reading " + incoming.length + " file" + (incoming.length === 1 ? "" : "s") + "…");
      Promise.all(
        incoming.map(
          (f) =>
            new Promise((done) => {
              const isImage = /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);
              const reader = new FileReader();
              reader.onload = () =>
                done(
                  isImage
                    ? { name: f.name, kind: "image", bytes: f.size, tokens: 1024, dataUrl: String(reader.result) }
                    : { name: f.name, kind: "text", bytes: f.size, tokens: Math.ceil(String(reader.result).length / 4), text: String(reader.result) },
                );
              reader.onerror = () => done({ name: f.name, kind: "error", bytes: f.size, tokens: 0, error: "could not read it" });
              isImage ? reader.readAsDataURL(f) : reader.readAsText(f);
            }),
        ),
      ).then((items) => {
        setFiles((prev) => [...prev, ...items]);
        const skipped = items.filter((x) => x.kind === "error").length;
        setAttachMsg(items.length - skipped + " attached" + (skipped ? " · " + skipped + " could not be read" : ""));
      });
    },
    addFromPath = async (path, ocr) => {
      if (!path.trim()) return;
      setAttachMsg("asking the helper for " + path + "…");
      try {
        const r = await fetch(HELPER_URL + "/attach?path=" + encodeURIComponent(path.trim()) + (ocr ? "&ocr=1" : ""));
        const d = await r.json();
        if (!d.ok) {
          setAttachMsg("nothing attached: " + (d.error || "the helper said no"));
          return;
        }
        const item = { name: d.name, path: d.path, kind: d.kind, bytes: d.bytes, tokens: d.tokens, text: d.text, dataUrl: d.dataUrl, ocr: d.ocr, how: d.how };
        setFiles((prev) => [...prev, item]);
        setAttachMsg(
          d.name +
            " attached · " +
            d.tokens.toLocaleString() +
            " tokens" +
            (d.how ? " · " + d.how : "") +
            (d.note ? " · " + d.note : ""),
        );
      } catch (err) {
        setAttachMsg("the helper is not answering — start it with:  node ~/abyss-console/abyss-bridge.mjs");
      }
    },
    addFolder = async (path) => {
      if (!path.trim()) return;
      setAttachMsg("walking " + path + "…");
      try {
        const r = await fetch(HELPER_URL + "/attach/folder?path=" + encodeURIComponent(path.trim()));
        const d = await r.json();
        if (!d.files) {
          setAttachMsg("nothing attached: " + (d.error || "the helper said no"));
          return;
        }
        const index =
          "Folder: " +
          d.root +
          "\n" +
          d.index.files +
          " files, " +
          d.index.textFiles +
          " plain-text, " +
          d.index.documents +
          " documents, " +
          d.index.images +
          " pictures, " +
          (d.index.bytes / 1048576).toFixed(1) +
          " MB in total.\nSent in full below: " +
          d.attached +
          " files" +
          (d.skipped ? " (" + d.skipped + " left out — " + (d.skippedWhy[0] ? d.skippedWhy[0].why : "") + ")" : "") +
          ".";
        const text =
          index +
          d.files.map((f) => "\n\n### " + f.path + "\n```\n" + f.text + "\n```").join("");
        setFiles((prev) => [
          ...prev,
          { name: d.root.split("/").filter(Boolean).pop() + "/ (folder, " + d.attached + " files)", kind: "folder", bytes: d.index.bytes, tokens: d.tokens, text },
        ]);
        setAttachMsg(
          d.attached +
            " files from " +
            d.root +
            " · " +
            d.tokens.toLocaleString() +
            " tokens · " +
            d.skipped +
            " left out",
        );
      } catch (err) {
        setAttachMsg("the helper is not answering — start it with:  node ~/abyss-console/abyss-bridge.mjs");
      }
    },
    /* ---- a project: a map, a budget, a search, and file lookups ------------ */
    indexProject = async (path) => {
      const root = (path || projPath).trim();
      if (!root) return;
      setProjBusy(!0);
      setProjectMsg("walking " + root + "…");
      try {
        const tree = await (await fetch(HELPER_URL + "/fs/tree?limit=6000&path=" + encodeURIComponent(root))).json();
        if (!tree.files) {
          setProjectMsg("could not index that: " + (tree.error || "the helper said no"));
          return;
        }
        const byDir = new Map();
        const sendable = tree.files.filter((f) => f.kind === "text" || f.kind === "document");
        for (const f of tree.files) {
          const rel = f.path.slice(tree.root.length + 1) || f.path;
          const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";
          if (!byDir.has(dir)) byDir.set(dir, []);
          byDir.get(dir).push({ rel, size: f.size, kind: f.kind });
        }
        const dirs = [...byDir.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const shown = [];
        for (const [dir, list] of dirs) {
          if (shown.length > 700) break;
          shown.push(dir + "/  (" + list.length + ")");
          for (const f of list.sort((a, b) => b.size - a.size).slice(0, 12)) {
            shown.push("   " + f.rel.split("/").pop() + "  " + (f.size / 1024).toFixed(1) + " kB  " + f.kind);
          }
        }
        const bytes = sendable.reduce((a, f) => a + f.size, 0);
        const tokens = Math.ceil(bytes / 4);
        const map =
          "Project map: " +
          tree.root +
          "\n" +
          tree.count +
          " files, " +
          (tree.bytes / 1048576).toFixed(1) +
          " MB — " +
          tree.textFiles +
          " plain-text and " +
          sendable.length +
          " documents. If you send every one of them that is about " +
          tokens.toLocaleString() +
          " tokens." +
          (tree.truncated ? "\nNote: the listing is cut — " + tree.shownCount + " of " + tree.count + " files shown, and the walk stops at its own cap; there may be more on disk." : "") +
          "\n\n" +
          shown.join("\n");
        setProject({ root: tree.root, count: tree.count, bytes: tree.bytes, sendable: sendable.length, tokens, files: tree.files });
        if (i.verifyCmds && i.verifyCmds[tree.root]) setRunCmd(i.verifyCmds[tree.root]);
        setProjectMap(map);
        setProjectMsg(
          tree.count +
            " files · " +
            (tree.bytes / 1048576).toFixed(1) +
            " MB · the whole text would be ~" +
            tokens.toLocaleString() +
            " tokens (≈ " +
            fmtCost((tokens / 1e6) * 0.15) +
            " off-peak on flash input)",
        );
        setProjPath(tree.root);
      } catch (err) {
        setProjectMsg("the helper is not answering — start it with:  node ~/abyss-console/abyss-bridge.mjs");
      } finally {
        setProjBusy(!1);
      }
    },
    searchProject = async () => {
      if (!project || !projQuery.trim()) return;
      setProjBusy(!0);
      setProjectMsg("searching " + project.root + " for " + projQuery + "…");
      try {
        const r = await (await fetch(HELPER_URL + "/fs/search?path=" + encodeURIComponent(project.root) + "&q=" + encodeURIComponent(projQuery))).json();
        setProjHits(r.hits || []);
        setProjectMsg((r.count || 0) + " hits for " + projQuery);
      } catch (err) {
        setProjectMsg("search failed: " + String(err.message || err));
      } finally {
        setProjBusy(!1);
      }
    },
    /* the model's own tool: it asks for paths, this reads them */
    readProjectFiles = async (paths) => {
      const want = (paths || []).filter(Boolean);
      if (!want.length) return "no paths given — ask for the paths shown on the project map";
      const r = await (
        await fetch(HELPER_URL + "/fs/many?root=" + encodeURIComponent(project.root) + "&paths=" + encodeURIComponent(want.join(",")))
      ).json();
      if (!r.files) return "the helper could not read those files: " + String(r.error || "");
      return r.files
        .map((f) =>
          f.text
            ? "### " + f.path + "\n```\n" + f.text + "\n```"
            : "### " + f.path + "\n(not read: " + f.error + ")",
        )
        .join("\n\n");
    },
    searchProjectText = async (needle, asReferences) => {
      const q = String(needle || "").trim().slice(0, 200);
      if (!q) return asReferences ? "no name given" : "no search text given";
      const r = await (
        await fetch(HELPER_URL + "/fs/search?path=" + encodeURIComponent(project.root) + "&q=" + encodeURIComponent(q))
      ).json();
      if (!r.hits) return "the helper could not search: " + String(r.error || "");
      if (!r.count) return (asReferences ? 'no references to "' + q + '"' : 'no matches for "' + q + '"') + " in this project";
      const lines = r.hits
        .slice(0, 60)
        .map((h) => h.path + ":" + h.line + ": " + h.text)
        .join("\n");
      return (
        (asReferences ? 'references to "' + q + '": ' : 'hits for "' + q + '": ') +
        r.count +
        (r.count > 60 ? " (showing the first 60)" : "") +
        (r.count >= 200 ? " (capped at 200 — narrow the search)" : "") +
        "\n" + lines
      );
    },
    /* ---- the verify loop: run the project's own command, feed it back ------ */
    runVerify = async (cmd) => {
      const command = (cmd || runCmd || "").trim();
      if (!command) return;
      const scopeKey = project ? project.root : "~";
      if (!i.verifyCmds || i.verifyCmds[scopeKey] !== command) {
        K({ verifyCmds: { ...(i.verifyCmds || {}), [scopeKey]: command } });
      }
      setRunBusy(!0);
      setLastRun(null);
      setProjectMsg("running: " + command + "…");
      try {
        const r = await (
          await fetch(HELPER_URL + "/run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cmd: command, cwd: project ? project.root : undefined, confirm: true, timeoutMs: 300000 }),
          })
        ).json();
        setLastRun({ ...r, command });
        const tail = ((r.stdout || "") + (r.stderr || "")).slice(-4000);
        x((prev) => [
          ...prev,
          {
            role: "user",
            content:
              "I ran this myself: `" +
              command +
              "` in " +
              (project ? project.root : "the home folder") +
              "\n\nexit code " +
              r.code +
              " after " +
              (r.ms / 1000).toFixed(1) +
              "s\n\n```\n" +
              tail +
              "\n```",
          },
          {
            role: "assistant",
            content:
              r.ok
                ? "That command passed (exit 0 in " + (r.ms / 1000).toFixed(1) + "s). Output is above if you want me to read anything into it."
                : "That command failed (exit " + r.code + " after " + (r.ms / 1000).toFixed(1) + "s). Ask me to fix it and I will work from the output above.",
          },
        ]);
        setProjectMsg(
          r.ok
            ? "verified: exit 0 in " + (r.ms / 1000).toFixed(1) + "s"
            : "the command failed (exit " + r.code + ") — the output is in the chat now",
        );
      } catch (err) {
        setProjectMsg("could not run it: the helper may not be running");
      } finally {
        setRunBusy(!1);
      }
    },
    /* ---- one click sets the model, the thinking switch and the effort ----- */
    applyPreset = (preset) => {
      K({ model: preset.model, thinking: preset.thinking, effort: preset.effort || i.effort });
      M(preset.label + " — " + preset.model + (preset.thinking ? " with thinking on" : " with thinking off"));
    },
    /* the other half of the pair: hand the same question to the big model */
    reviewWithPro = async () => {
      const lastUser = [...m].reverse().find((x) => x.role === "user" && x.content);
      if (!lastUser) {
        M("nothing to review yet — ask something first");
        return;
      }
      const previous = i.model;
      await K({ model: liveModels.indexOf("deepseek-v4-pro") !== -1 ? "deepseek-v4-pro" : previous, thinking: true, effort: "high" });
      setPendingReview(lastUser.content);
    },
    /* ---- the session library: name it, keep it, find it, export it --------- */
    /* the disk copy is the durable one; the browser copy is the fallback */
    pushSessionToDisk = async (entry) => {
      try {
        await fetch(HELPER_URL + "/lib/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(entry),
        });
        setLibNote("saved to " + "~/.abyss-console/sessions.json");
      } catch {
        setLibNote("kept in the browser only — the helper is not answering");
      }
    },
    loadLibraryFromDisk = async () => {
      try {
        const lib = await (await fetch(HELPER_URL + "/lib", { cache: "no-store" })).json();
        if (Array.isArray(lib.sessions) && lib.sessions.length) {
          setSessions((prev) => {
            const byId = new Map();
            for (const x2 of [...lib.sessions, ...prev]) byId.set(x2.id, { ...byId.get(x2.id), ...x2 });
            return [...byId.values()].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
          });
          setLibNote(lib.sessions.length + " sessions read from disk · " + lib.dir);
        }
        if (Array.isArray(lib.recipes) && lib.recipes.length) {
          setRecipes((prev) => {
            const byId = new Map();
            for (const x2 of [...lib.recipes, ...prev]) byId.set(x2.id, { ...byId.get(x2.id), ...x2 });
            return [...byId.values()];
          });
        }
      } catch {
        setLibNote("helper not running — using the browser copy");
      }
    },
    /* search inside the words, and show the line that matched */
    sessionMatches = () => {
      const q = sessionQuery.trim().toLowerCase();
      if (!q) return sessions.map((s2) => ({ session: s2, why: "" }));
      return sessions
        .map((s2) => {
          if ((s2.name || "").toLowerCase().includes(q)) return { session: s2, why: "name" };
          if ((s2.tags || []).some((t2) => String(t2).toLowerCase().includes(q))) return { session: s2, why: "tag" };
          if ((s2.project || "").toLowerCase().includes(q)) return { session: s2, why: "project" };
          for (const mm of s2.messages || []) {
            const line = String(mm.content || "").split("\n").find((l2) => l2.toLowerCase().includes(q));
            if (line) return { session: s2, why: mm.role + ": " + line.trim().slice(0, 90) };
          }
          return null;
        })
        .filter(Boolean);
    },
    saveSession = async (name) => {
      const label = (name || sessionName || "").trim() || "session " + new Date().toLocaleString();
      const cost = daily && daily.date === todayIndiana() ? daily.cost : 0;
      const entry = {
        id: "s" + Date.now(),
        name: label,
        at: new Date().toISOString(),
        project: project ? project.root : null,
        messages: m.filter((x) => !x.streaming).map((x) => ({ role: x.role, content: x.content, model: x.model, error: x.error })),
        cost,
        calls: daily ? daily.calls : 0,
      };
      entry.tags = sessionTags.split(",").map((t2) => t2.trim()).filter(Boolean);
      const next = [entry, ...sessions].slice(0, 100);
      setSessions(next);
      await storageSet(STORAGE_KEYS.sessions, next);
      pushSessionToDisk(entry);
      setSessionName("");
      setSessionTags("");
      setSessionMsg("saved \"" + label + "\" (" + entry.messages.length + " messages" + (entry.tags.length ? ", tags: " + entry.tags.join(", ") : "") + ")");
    },
    openSession = (entry) => {
      x(entry.messages.map((mm) => ({ role: mm.role, content: mm.content, model: mm.model, error: mm.error })));
      if (entry.project) indexProject(entry.project);
      setSessionOpen(!1);
      setSessionMsg("opened \"" + entry.name + "\" — the chat now continues from there");
    },
    deleteSession = async (id) => {
      const next = sessions.filter((x2) => x2.id !== id);
      setSessions(next);
      await storageSet(STORAGE_KEYS.sessions, next);
      try {
        await fetch(HELPER_URL + "/lib/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ remove: id }),
        });
      } catch {}
      setSessionMsg("deleted, on disk as well");
    },
    exportSession = () => {
      const name = sessionName.trim() || "abyss-session";
      const rows = m.filter((x2) => !x2.streaming);
      const body =
        "# " + name + "\n\n" +
        (project ? "Project: " + project.root + "\n" : "") +
        "Exported: " + new Date().toISOString() + "\n" +
        "Spent today: " + fmtCost(daily && daily.date === todayIndiana() ? daily.cost : 0) + " over " + (daily ? daily.calls : 0) + " calls\n\n" +
        "| # | who | model | characters |\n| --- | --- | --- | --- |\n" +
        rows.map((x2, i2) => "| " + (i2 + 1) + " | " + x2.role + " | " + (x2.model || "") + " | " + String(x2.content || "").length + " |").join("\n") +
        "\n\n---\n\n" +
        rows.map((x2) => "## " + x2.role + (x2.model ? " (" + x2.model + ")" : "") + "\n\n" + (x2.content || "")).join("\n\n");
      const url = URL.createObjectURL(new Blob([body], { type: "text/markdown" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() + ".md";
      a.click();
      URL.revokeObjectURL(url);
      setSessionMsg("exported as markdown");
    },
    sessionHits = () => {
      const q = sessionQuery.trim().toLowerCase();
      if (!q) return sessions;
      return sessions.filter(
        (x2) =>
          x2.name.toLowerCase().includes(q) ||
          (x2.project || "").toLowerCase().includes(q) ||
          (x2.messages || []).some((mm) => String(mm.content || "").toLowerCase().includes(q)),
      );
    },
    /* ---- the recipe library: instructions you reuse ------------------------ */
    addRecipe = async () => {
      const name = recipeName.trim();
      const text = recipeText.trim();
      if (!name || !text) {
        setSessionMsg("a recipe needs a name and its text");
        return;
      }
      const next = [{ id: "r" + Date.now(), name, text }, ...recipes].slice(0, 200);
      setRecipes(next);
      await storageSet(STORAGE_KEYS.recipes, next);
      setRecipeName("");
      setRecipeText("");
      setSessionMsg("recipe \"" + name + "\" kept (" + text.length + " characters)");
    },
    useRecipe = (recipe) => {
      E(S ? S + "\n\n" + recipe.text : recipe.text);
      setSessionMsg("\"" + recipe.name + "\" is in the composer — edit it or press send");
    },
    deleteRecipe = async (id) => {
      const next = recipes.filter((r2) => r2.id !== id);
      setRecipes(next);
      await storageSet(STORAGE_KEYS.recipes, next);
      setSessionMsg("recipe deleted");
    },
    /* ---- every change this app has made, and putting any of them back ----- */
    loadJournal = async () => {
      try {
        const r = await (await fetch(HELPER_URL + "/fs/journal", { cache: "no-store" })).json();
        setJournal(r.entries || []);
        setJournalMsg((r.entries || []).length + " changes on record");
      } catch {
        setJournalMsg("the helper is not answering");
      }
    },
    restoreFromJournal = async (entry) => {
      const r = await (
        await fetch(HELPER_URL + "/fs/undo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: entry.path }),
        })
      ).json();
      setJournalMsg(r.ok ? "put " + entry.path.split("/").pop() + " back" + (r.removedFile ? " (it is gone again — it did not exist before)" : "") : "could not: " + r.error);
      loadJournal();
    },
    /* ---- the bounded fix loop: run, hand the failure over, run again ------ */
    applyFixLoop = async () => {
      if (loopBusy) return;
      const max = 3;
      const key = project ? project.root : "~";
      const cmd = (i.verifyCmds && i.verifyCmds[key]) || runCmd;
      if (!cmd) {
        setProjectMsg("no command to run — type one in the verify box first");
        return;
      }
      setLoopBusy(!0);
      loopCancel.current = !1;
      const logLine = (text) => x((prev) => [...prev, { role: "user", content: text }]);
      const lastReply = () =>
        [...mRef.current].reverse().find((x2) => x2.role === "assistant" && !x2.error && x2.content && !x2.display && !/^\*\*Cost of that turn\*\*/.test(String(x2.content)));
      let round = 0;
      let done = false;
      try {
        while (round < max && !loopCancel.current && !done) {
          round++;
          /* 1) apply whatever the newest reply proposed */
          const last = lastReply();
          const blocks = last ? fileBlocks(last.content) : [];
          const patch = last ? findPatch(last.content) : null;
          if (patch) {
            const pr = await (
              await fetch(HELPER_URL + "/fs/patch", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ patch: patch.patch, dryRun: false }),
              })
            ).json();
            logLine("fix round " + round + ": applied the diff — " + ((pr && pr.applied) || 0) + " file(s) written" + (pr && pr.conflicts ? ", " + pr.conflicts + " left alone (conflicts)" : ""));
          } else if (blocks.length) {
            let wrote = 0;
            for (const b2 of blocks) {
              const wr = await (
                await fetch(HELPER_URL + "/fs/write", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ path: b2.path, text: b2.code, why: "apply & fix loop" }),
                })
              ).json();
              if (wr && wr.ok) wrote++;
            }
            logLine("fix round " + round + ": wrote " + wrote + " file(s) from the reply");
          } else {
            logLine("fix round " + round + ": nothing new to apply — running the command as it is");
          }
          if (loopCancel.current) break;
          /* 2) run the project's commands, one line at a time; stop at the first failure */
          setRunBusy(!0);
          const cmds = String(cmd || "").split("\n").map((s2) => s2.trim()).filter(Boolean);
          let r = { ok: true, code: 0, ms: 0, stdout: "", stderr: "" };
          let failedAt = "";
          for (const one of cmds) {
            r = await (
              await fetch(HELPER_URL + "/run", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ cmd: one, cwd: project ? project.root : undefined, confirm: true, timeoutMs: 300000 }),
              })
            ).json();
            setLastRun({ ...r, command: one });
            logLine("fix round " + round + ": `" + one + "` → exit " + r.code + " in " + (r.ms / 1000).toFixed(1) + "s");
            if (!r.ok) {
              failedAt = one;
              break;
            }
          }
          setRunBusy(!1);
          if (r.ok) {
            logLine("fix round " + round + ": all " + cmds.length + " command(s) green — stopping after " + round + " round(s)");
            done = true;
            break;
          }
          const tail = ((r.stdout || "") + (r.stderr || "")).slice(-6000);
          if (round >= max) {
            logLine("fix round " + round + ": round cap reached (" + max + "); stopping with the failure below");
            break;
          }
          logLine("fix round " + round + ": handing the `" + failedAt + "` failure to the model");
          /* 3) feed the failure back; the reply becomes the next round's proposal */
          await sendMessage(
            "This command failed in " +
              (project ? project.root : "my home folder") +
              " (exit " +
              r.code +
              "): `" + failedAt + "`. Fix it — a unified diff for files that already exist, or a `### file: <path>` block for new ones.\n\n```\n$ " +
              failedAt +
              "\n" +
              tail +
              "\n```",
          );
          /* let React flush: the next round reads the newest reply from the ref, not a stale closure */
          const had = mRef.current.length;
          for (let w8 = 0; w8 < 60 && mRef.current.length <= had; w8++) await new Promise((ok) => setTimeout(ok, 100));
        }
      } finally {
        setRunBusy(!1);
        setLoopBusy(!1);
        setProjectMsg(loopCancel.current ? "stopped by you" : done ? "green — the loop is done" : "loop finished (round cap)");
      }
    },
    stopFixLoop = () => {
      loopCancel.current = !0;
      try {
        Qe.current && Qe.current.abort();
      } catch {}
      setProjectMsg("stopping the loop…");
    },
    /* ---- what this send will cost, before it goes ------------------------- */
    estimateSend = () => {
      const est = (chars) => Math.ceil(chars / 4);
      const system = est((CHEATSHEET || "").length + (MCP_CONTRACT_TEXT || "").length + 800);
      const history = m.filter((x2) => !x2.error && typeof x2.content === "string").reduce((a, x2) => a + est(x2.content.length), 0);
      const draft = est((S || "").length);
      const attached = files.reduce((a, f) => a + (f.tokens || 0), 0);
      const pictures = files.filter((f) => f.kind === "image").length * 1024;
      const total = system + history + draft + attached + pictures;
      const price = PRICES[i.model] || PRICES["deepseek-flash"];
      const peak = peakInfo(new Date()).inWindow;
      const cold = (y.hit || 0) + (y.miss || 0) === 0;
      const hitRatio = cold ? 0 : (y.hit || 0) / ((y.hit || 0) + (y.miss || 0));
      const usd = ((total * (1 - hitRatio) * price.miss + total * hitRatio * price.hit) / 1e6) * (peak ? 2 : 1);
      return { system, history, draft, attached: attached + pictures, total, usd, peak, hitRatio, cold };
    },
    /* ---- fork: keep where you are, then carry on differently ---------------- */
    forkFrom = async (index) => {
      const kept = m.slice(0, index + 1).filter((x2) => !x2.streaming);
      if (!kept.length) return;
      const label = (sessionName.trim() || "session") + " · fork at " + (index + 1);
      const cost = daily && daily.date === todayIndiana() ? daily.cost : 0;
      const entry = {
        id: "s" + Date.now(),
        name: label,
        at: new Date().toISOString(),
        project: project ? project.root : null,
        messages: kept.map((x2) => ({ role: x2.role, content: x2.content, model: x2.model, error: x2.error })),
        cost,
        calls: daily ? daily.calls : 0,
      };
      const next = [entry, ...sessions].slice(0, 100);
      setSessions(next);
      await storageSet(STORAGE_KEYS.sessions, next);
      /* the chat keeps exactly what the fork holds, so a different path can follow */
      x(kept);
      setSessionMsg('saved as "' + label + '" and the chat now ends there — carry on differently, nothing was lost');
    },
    compareModels = async () => {
      const ask = (S || "").trim() || (([...m].reverse().find((x2) => x2.role === "user" && x2.content) || {}).content || "");
      if (!ask) { setProjectMsg("type a question first — I will send it to both models and show both answers"); return; }
      if (!n) { setProjectMsg("add your DeepSeek key in Settings first"); return; }
      setCompareBusy(true);
      setCompare({ ask, flash: null, pro: null, busy: true });
      cmpAbort.current = new AbortController();
      const run = async (model) => {
        try {
          const r = await callDeepSeek({
            apiKey: n, scrub: i.redact !== false, model, messages: [{ role: "system", content: CHEATSHEET }, { role: "user", content: ask }],
            thinking: false, temperature: 1.0, maxTokens: Math.min(Number(i.maxTokens) || 4000, 4000), onDelta: () => {},
            signal: cmpAbort.current.signal,
          });
          const cost = r.usage ? await recordUsage(model, r.usage) : null;
          return { text: r.content || "(empty)", cost: cost ? cost.cost : 0, usage: r.usage || {}, finish: r.finishReason };
        } catch (err) {
          const aborted = err && (err.name === "AbortError" || /abort/i.test(String(err.message || "")));
          return { text: aborted ? "cancelled" : "failed: " + String(err.message || err), cost: 0, usage: {}, error: true };
        }
      };
      const [flash, pro] = await Promise.all([run("deepseek-flash"), run("deepseek-v4-pro")]);
      setCompare({ ask, flash, pro, busy: false });
      setCompareBusy(false);
    },
    cancelCompare = () => {
      try {
        cmpAbort.current && cmpAbort.current.abort();
      } catch {}
      setProjectMsg("cancelling the compare…");
    },
    useComparison = (which) => {
      const picked = compare && compare[which];
      if (!picked || picked.error) return;
      x((prev) => [
        ...prev,
        { role: "user", content: compare.ask },
        { role: "assistant", content: picked.text + "\n\n_(kept from " + which + "; the other answer was dropped)_", model: which === "pro" ? "deepseek-v4-pro" : "deepseek-flash" },
      ]);
      setCompare(null);
      setProjectMsg("kept the " + which + " answer in the conversation");
    },
    pinFromPath = async (path) => {
      try {
        const r = await (await fetch(HELPER_URL + "/attach?path=" + encodeURIComponent(path))).json();
        if (!r.ok) { setProjectMsg("could not pin that: " + r.error); return; }
        if (r.kind === "image") { setProjectMsg("pinning is for text — attach pictures one at a time instead"); return; }
        K({ pinned: [...(i.pinned || []), { id: "p" + Date.now(), name: r.name, text: r.text, tokens: r.tokens }].slice(0, 12) });
        setProjectMsg("pinned " + r.name + " (" + r.tokens.toLocaleString() + " tokens — cached after the first send)");
      } catch { setProjectMsg("the helper is not answering"); }
    },
    unpin = (id) => {
      K({ pinned: (i.pinned || []).filter((p2) => p2.id !== id) });
      setProjectMsg("unpinned");
    },
    triageTrace = () => {
      const text = trace || "";
      const candidates = new Set();
      for (const re of [
        /(?:^|[\s("'\[])(\/?(?:[\w.@+-]+\/)+[\w.@+-]+\.[A-Za-z]{1,6})(?::\d+){0,2}/g,
        /File "([^"]+)", line \d+/g,
        /at [\w.$<>]+ \(([^:()]+):\d+/g,
      ]) {
        let mm;
        while ((mm = re.exec(text))) candidates.add(mm[1].trim());
      }
      const files = project ? project.files : [];
      const matched = [];
      for (const c of candidates) {
        const hit = files.find((f2) => f2.path === c || f2.path.endsWith("/" + c.replace(/^\.\//, "")) || f2.path.endsWith(c));
        if (hit && !matched.some((mm) => mm.path === hit.path)) matched.push({ path: hit.path, size: hit.size, kind: hit.kind });
      }
      setTriage({ candidates: candidates.size, files: matched.slice(0, 8), sample: [...candidates].slice(0, 2).join(", ") });
      setProjectMsg(matched.length ? "the trace names " + matched.length + " file(s) in this project" : candidates.size + " path(s) in the trace, none in the indexed project");
    },
    attachTriageFiles = async () => {
      for (const f2 of (triage ? triage.files : [])) await addFromPath(f2.path, false);
      setTriage(null);
    },
    askToFixTrace = () => {
      const list = (triage ? triage.files : []).map((f2) => "- " + f2.path).join("\n");
      sendMessage("This failed. Here is the output, and these are the files it names in my project:\n\n```\n" + trace.slice(0, 6000) + "\n```\n" + (list ? list + "\n" : "") + "\nFind the cause and answer with a unified diff I can apply.");
      setTriage(null);
      setTrace("");
    },
    probeHelper = async (alsoRoom) => {
      setHelperMsg("looking for the helper on " + HELPER_URL + "…");
      try {
        const info = await (await fetch(HELPER_URL + "/health", { cache: "no-store" })).json();
        setHelper(info);
        if (!alsoRoom) {
          setHelperMsg(
            "helper running" + (info.roomTools ? " · " + info.roomTools.length + " room tools available" : ""),
          );
          return;
        }
        setHelperMsg("asking the room…");
        const status = await (await fetch(HELPER_URL + "/room/status", { cache: "no-store" })).json();
        const catalog = await (await fetch(HELPER_URL + "/room/servers", { cache: "no-store" })).json();
        setRoomInfo({ ...status, count: catalog.count, categories: catalog.categories });
        loadLibraryFromDisk();
        setHelperMsg(
          status.connected
            ? "room OK — this app is onboarded as \"" + status.harness + "\""
            : "the room did not answer: " + String(status.detail || "").slice(0, 160),
        );
      } catch (err) {
        setHelper(null);
        setRoomInfo(null);
        setHelperMsg(
          "the helper is not running. Start it with:  node ~/abyss-console/abyss-bridge.mjs",
        );
      }
    },
    R = async () => {
      if (!n) {
        t("settings");
        return;
      }
      if (!globalThis.AbyRoi) {
        setIdeaError("the daily-idea rules did not load — the abyss-roi-engine block is missing from the page");
        return;
      }
      C(!0);
      setIdeaError("");
      try {
        const engine = globalThis.AbyRoi.createRoiEngine({
          callApi: (opts) => callDeepSeek({ apiKey: n, ...opts }),
          recordUsage,
          cheatsheet: CHEATSHEET,
          today: todayIndiana,
          locale: (() => {
            try {
              return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
            } catch {
              return "local";
            }
          })(),
          prices: PRICES,
          modelIds: liveModels,
          excludeLines: () =>
            Object.keys(a)
              .sort()
              .map((d) => [d, a[d].novelty_key || slug(a[d].title), a[d].title].join(" | ")),
          usedKeys: () => Object.values(a).map((idea) => idea.novelty_key).filter(Boolean),
          onStatus: (msg) => setIdeaStatus(msg),
        });
        const res = await engine.generate();
        if (!res.ok) {
          setIdeaError(res.error + "\n\n" + String(res.raw || "").slice(0, 1500));
          return;
        }
        const date = todayIndiana();
        const next = {
          ...a,
          [date]: { ...res.idea, date, attempts: (res.attempts || []).length, cost_usd: res.cost },
        };
        p(next);
        await storageSet(STORAGE_KEYS.ideas, next);
      } catch (err) {
        setIdeaError(String((err && err.message) || err));
      } finally {
        setIdeaStatus("");
        C(!1);
      }
    },
    D = async () => {
      if (!l.trim()) {
        alert(
          "Add your DeepSeek API key in Settings first — the live check is a direct GET /models call on your key.",
        );
        return;
      }
      N(!0);
      try {
        const h = await fetch(API_BASE + "/models", { headers: { Authorization: "Bearer " + l.trim() } });
        if (!h.ok) throw new Error(await describeHttpError(h));
        const z = (await h.json()).data || [],
          A = z.map((q) => q.id).join(", ") || "(none listed)",
          F = z
            .filter(
              (q) =>
                [
                  "deepseek-flash",
                  "deepseek-v4-pro",
                  "deepseek-v4-flash",
                  "deepseek-v4-flash-vision-exp",
                ].indexOf(q.id) < 0,
            )
            .map((q) => q.id)
            .join(", "),
          U =
            "Polled GET /models directly against api.deepseek.com on your own key — no other AI service involved. Live model IDs: " +
            A +
            ". Baseline expects deepseek-flash + deepseek-v4-pro (legacy aliases deepseek-v4-flash / deepseek-v4-flash-vision-exp also route to V4.1-Flash at flash prices). " +
            (F
              ? "UNSEEN IDs — baseline may be stale; re-check the Models & Pricing and News pages: " + F
              : "No unseen IDs — the model lineup matches the baseline.") +
            " Reminder: /models cannot see prices or deprecations; re-check the pricing page when money is on the line.",
          te = todayIndiana(),
          ne = {
            ...u,
            verified: te,
            bulletins: [{ date: te, text: U }, ...(u.bulletins || [])].slice(0, 10),
          };
        setLiveModels(z.map((q) => q.id));
        (c(ne), await storageSet(STORAGE_KEYS.doc, ne));
      } catch (h) {
        alert(
          "Live check failed: " +
            h.message +
            " — if it couldn't connect at all, check your own network (VPN/firewall), since DeepSeek does allow browser calls.",
        );
      }
      N(!1);
    },
    G = () => {
      const h = URL.createObjectURL(new Blob([jn()], { type: "text/markdown" })),
        z = document.createElement("a");
      ((z.href = h), (z.download = "DEEPSEEK-CHEATSHEET.md"), z.click(), URL.revokeObjectURL(h));
    },
    K = async (h) => {
      const z = { ...i, ...h };
      (s(z), await storageSet(STORAGE_KEYS.settings, z));
    },
    Gt = async () => {
      const h = l.trim();
      (r(h),
        await storageSet(STORAGE_KEYS.key, h),
        M(
          h
            ? "Key saved to this browser on this machine. Personal use only — never host this publicly with a key in it."
            : "Key cleared.",
        ));
    },
    Rc = async () => {
      M("Pinging GET /models …");
      try {
        const h = await fetch(`${API_BASE}/models`, { headers: { Authorization: `Bearer ${l.trim()}` } });
        if (!h.ok) throw new Error(await describeHttpError(h));
        const A = ((await h.json()).data || []).map((F) => F.id).join(", ");
        M(`Live. Models on your account: ${A || "(none listed)"}`);
      } catch (h) {
        M(
          "Test failed: " +
            h.message +
            " — if it says the key was refused, retype it; if it couldn't connect at all, check your own network (VPN/firewall), since DeepSeek does allow browser calls.",
        );
      }
    },
    todayIdea = a[todayIndiana()],
    $l = y.hit + y.miss > 0 ? Math.round((100 * y.hit) / (y.hit + y.miss)) : 0,
    [Dc, Oc] = React.useState(() => Date.now()),
    [McpTick, McpBump] = React.useState(0),
    [DcRep, setDcRep] = React.useState(null);
  React.useEffect(() => {
    const h = setInterval(() => Oc(Date.now()), 6e4);
    return () => clearInterval(h);
  }, []);
  const Ul = peakInfo(new Date(Dc));
  LIVE.key = n;
  LIVE.model = i.model;
  return L
    ? jsxRuntime.jsxs("div", {
        style: STYLES.app,
        children: [
          jsxRuntime.jsx("style", { children: APP_CSS }),
          jsxRuntime.jsxs("nav", {
            style: STYLES.rail,
            children: [
              jsxRuntime.jsxs("div", {
                style: STYLES.brand,
                children: [
                  jsxRuntime.jsx(Icon, { name: "mark", size: 30, strokeWidth: 1.4 }),
                  jsxRuntime.jsxs("div", {
                    children: [
                      jsxRuntime.jsx("div", { style: STYLES.wordmark, children: "ABYSS" }),
                      jsxRuntime.jsx("div", { style: STYLES.wordmarkSub, children: "LOCAL AI CONSOLE" }),
                    ],
                  }),
                ],
              }),
              jsxRuntime.jsx("div", { style: STYLES.railRule }),
              jsxRuntime.jsxs("div", {
                style: STYLES.powered,
                children: [
                  "powered by ",
                  jsxRuntime.jsx("span", { style: STYLES.poweredName, children: "DeepSeek" }),
                ],
              }),
              jsxRuntime.jsx("div", { style: { height: 14 } }),
              [
                ["chat", "Chat · Build", "chat"],
                ["idea", "Daily ROI", "chart"],
                ["docs", "Cheat sheet", "doc"],
                ["settings", "Settings", "gear"],
              ].map(([id, label, icon]) =>
                jsxRuntime.jsxs(
                  "button",
                  {
                    onClick: () => t(id),
                    style: { ...STYLES.navBtn, ...(e === id ? STYLES.navBtnOn : {}) },
                    children: [
                      jsxRuntime.jsx(Icon, { name: icon, size: 18, color: e === id ? "var(--sonar)" : "var(--sonar-dim)" }),
                      jsxRuntime.jsx("span", { children: label }),
                      id === "idea" && !todayIdea && jsxRuntime.jsx("span", { style: STYLES.dot }),
                    ],
                  },
                  id,
                ),
              ),
              jsxRuntime.jsx("div", { style: { flex: 1 } }),
              jsxRuntime.jsxs("div", {
                style: STYLES.railFoot,
                children: [
                  jsxRuntime.jsx("div", { style: STYLES.tagline, children: "DIVE DEEPER" }),
                  jsxRuntime.jsx("div", { style: STYLES.tagline, children: "BUILD FASTER" }),
                  jsxRuntime.jsx("div", { style: STYLES.tagline, children: "A BRIGHTER TOMORROW" }),
                  jsxRuntime.jsx("div", { style: STYLES.railRuleThin }),
                  jsxRuntime.jsx("div", { style: STYLES.version, children: "v0.1.0" }),
                  jsxRuntime.jsxs("div", {
                    style: STYLES.localStatus,
                    children: [jsxRuntime.jsx("span", { style: STYLES.statusDot }), "Local · Offline · Yours"],
                  }),
                ],
              }),
            ],
          }),
          jsxRuntime.jsxs("main", {
            style: STYLES.main,
            children: [
              Ul.warn &&
                !Ul.inWindow &&
                jsxRuntime.jsx("div", {
                  style: {
                    position: "sticky",
                    top: 0,
                    zIndex: 5,
                    background: "var(--coral)",
                    color: "#06121a",
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  },
                  children: [
                    jsxRuntime.jsx("span", {
                      children:
                        "⚠ PEAK 2x PRICING IN " +
                        Ul.minsToPeak +
                        " MIN — next window starts " +
                        Ul.nextLocal +
                        " Indiana",
                    }),
                    jsxRuntime.jsx("span", {
                      style: { fontFamily: "'JetBrains Mono',monospace", fontSize: 11 },
                      children: [i.model, " ", `$${PRICES[i.model].miss}`, "→", `$${PRICES[i.model].missP}`, "/1M"],
                    }),
                  ],
                }),
              e === "chat" &&
                (() => {
                  const last = [...m].reverse().find((x) => x.role === "assistant" && !x.error && x.content && !x.display && !/^\*\*Cost of that turn\*\*/.test(String(x.content)));
                  const blocks = last ? fileBlocks(last.content) : [];
                  const patch = last ? findPatch(last.content) : null;
                  if (patch) {
                    return jsxRuntime.jsx("div", {
                      style: { padding: "0 26px 8px" },
                      children: jsxRuntime.jsx(PatchReview, { found: patch, onNote: (msg) => M(msg), key: m.length }),
                    });
                  }
                  return blocks.length
                    ? jsxRuntime.jsx("div", {
                        style: { padding: "0 26px 8px" },
                        children: jsxRuntime.jsx(WriteReview, { blocks, onNote: (msg) => M(msg), key: m.length }),
                      })
                    : null;
                })(),
              e === "chat" &&
                jsxRuntime.jsxs(jsxRuntime.Fragment, {
                  children: [
                    jsxRuntime.jsxs("div", {
                      ref: Ve,
                      style: STYLES.chatScroll,
                      children: [
                        m.length === 0 &&
                          jsxRuntime.jsxs("div", {
                            style: STYLES.hero,
                            children: [
                              jsxRuntime.jsx("div", {
                                style: STYLES.heroKicker,
                                children: "THE MODEL IS CHEAP · THE CACHE IS NEARLY FREE",
                              }),
                              jsxRuntime.jsxs("h1", {
                                style: STYLES.heroH1,
                                children: [
                                  "Ask anything.",
                                  jsxRuntime.jsx("br", {}),
                                  jsxRuntime.jsx("span", { style: { color: "var(--sonar)" }, children: "Build in the Abyss." }),
                                ],
                              }),
                              jsxRuntime.jsx("p", {
                                style: STYLES.heroBody,
                                children:
                                  "Full apps, scripts, agents, configs, docs — complete code, no placeholders, priced live in the cost meter below. Your key, your files and your saved ideas stay on this machine; only the request goes to DeepSeek.",
                              }),
                              jsxRuntime.jsx("div", {
                                style: STYLES.chipRow,
                                children: [
                                  ["code", "Build me a Node CLI that pipes a whole repo into a V4-Pro for review"],
                                  ["doc", "Write a cost model: my chatbot, 50K users/day, cache-optimized"],
                                  ["refresh", "Show the exact tool-call round-trip code for a V4 agent loop"],
                                ].map(([icon, text]) =>
                                  jsxRuntime.jsxs(
                                    "button",
                                    {
                                      style: STYLES.chip,
                                      onClick: () => sendMessage(text),
                                      children: [
                                        jsxRuntime.jsx(Icon, { name: icon, size: 16 }),
                                        jsxRuntime.jsx("span", { style: STYLES.chipText, children: text }),
                                        jsxRuntime.jsx(Icon, { name: "arrow", size: 16 }),
                                      ],
                                    },
                                    text,
                                  ),
                                ),
                              }),
                            ],
                          }),
                        m.map((h, z) =>
                          jsxRuntime.jsx(
                            "div",
                            {
                              style: {
                                display: "flex",
                                flexDirection: "column",
                                alignItems: h.role === "user" ? "flex-end" : "flex-start",
                                padding: "6px 0",
                              },
                              children: [
                                jsxRuntime.jsxs("div", {
                                style:
                                  h.role === "user"
                                    ? STYLES.userMsg
                                    : { ...STYLES.botMsg, ...(h.error ? STYLES.errMsg : {}) },
                                children: [
                                  h.role === "tool"
                                    ? jsxRuntime.jsxs("div", {
                                        style: {
                                          fontFamily: "'JetBrains Mono',monospace",
                                          fontSize: 11.5,
                                          borderLeft: "3px solid " + (h.ok ? "var(--sonar)" : "var(--amber)"),
                                          paddingLeft: 8,
                                          marginTop: 4,
                                          color: "var(--foam)",
                                          maxWidth: 640,
                                        },
                                        children: [
                                          jsxRuntime.jsxs("div", {
                                            children: [
                                              jsxRuntime.jsx("b", {
                                                style: { color: h.ok ? "var(--sonar)" : "var(--amber)" },
                                                children: h.name,
                                              }),
                                              String(JSON.stringify(h.args || {})).slice(0, 160),
                                              h.status && h.status !== "executed" ? " — " + h.status : "",
                                            ],
                                          }),
                                          jsxRuntime.jsxs("details", {
                                            children: [
                                              jsxRuntime.jsx("summary", {
                                                style: { color: "var(--kelp)", cursor: "pointer" },
                                                children: "result",
                                              }),
                                              jsxRuntime.jsx("div", {
                                                style: {
                                                  whiteSpace: "pre-wrap",
                                                  fontSize: 11,
                                                  maxHeight: 220,
                                                  overflowY: "auto",
                                                },
                                                children: h.content || "",
                                              }),
                                            ],
                                          }),
                                        ],
                                      })
                                    : null,
                                  h.role === "assistant" && h.reasoning
                                    ? jsxRuntime.jsxs("details", {
                                        style: STYLES.reasonBox,
                                        children: [
                                          jsxRuntime.jsxs("summary", {
                                            style: STYLES.reasonSum,
                                            children: [
                                              "thinking trace (",
                                              h.reasoning.length.toLocaleString(),
                                              " chars — billed as output)",
                                            ],
                                          }),
                                          jsxRuntime.jsx("div", {
                                            style: {
                                              whiteSpace: "pre-wrap",
                                              fontSize: 12,
                                              color: "var(--kelp)",
                                              padding: "8px 2px 2px",
                                              maxHeight: 220,
                                              overflowY: "auto",
                                            },
                                            children: h.reasoning,
                                          }),
                                        ],
                                      })
                                    : null,
                                  h.role === "user"
                                    ? jsxRuntime.jsx("div", { style: { whiteSpace: "pre-wrap" }, children: h.content })
                                    : h.role === "tool"
                                      ? null
                                      : jsxRuntime.jsx(MarkdownBlock, { text: h.content || (h.streaming ? "…" : "") }),
                                  h.role === "assistant" &&
                                    !h.streaming &&
                                    (h.usage || h.model) &&
                                    jsxRuntime.jsxs("div", {
                                      style: STYLES.msgMeta,
                                      children: [
                                        h.model,
                                        h.usage &&
                                          jsxRuntime.jsxs(jsxRuntime.Fragment, {
                                            children: [
                                              " · hit ",
                                              h.usage.hit.toLocaleString(),
                                              " / miss ",
                                              h.usage.miss.toLocaleString(),
                                              " / out ",
                                              h.usage.out.toLocaleString(),
                                              " · ",
                                              jsxRuntime.jsx("span", {
                                                style: { color: "var(--amber)" },
                                                children: fmtCost(h.usage.cost),
                                              }),
                                            ],
                                          }),
                                      ],
                                    }),
                                  h.error &&
                                    h.lastUser &&
                                    jsxRuntime.jsxs("div", {
                                      style: { marginTop: 8, display: "flex", gap: 8 },
                                      children: [
                                        jsxRuntime.jsx("button", {
                                          style: STYLES.microBtn,
                                          onClick: () => sendMessage(h.lastUser),
                                          children: "retry on DeepSeek",
                                        }),
                                      ],
                                    }),
                                ],
                              }),
                                z < m.length - 1
                                  ? jsxRuntime.jsx("button", {
                                      style: { ...STYLES.microBtn, marginTop: 4, opacity: 0.7 },
                                      title: "keep the conversation up to here as its own session, then carry on a different way",
                                      onClick: () => forkFrom(z),
                                      children: "fork here",
                                    })
                                  : null,
                              ],
                            },
                            z,
                          ),
                        ),
                      ],
                    }),
                    (globalThis.DCEngine ? globalThis.DCEngine.pendingList() : []).map((pa) =>
                      jsxRuntime.jsxs(
                        "div",
                        {
                          style: { ...STYLES.card, borderColor: "var(--amber)", marginBottom: 8 },
                          children: [
                            jsxRuntime.jsxs("div", {
                              style: {
                                fontFamily: "'JetBrains Mono',monospace",
                                fontSize: 10,
                                color: "var(--amber)",
                                letterSpacing: "0.15em",
                              },
                              children: [
                                "GATE ",
                                pa.mode,
                                " · ",
                                String(pa.risk).toUpperCase(),
                                " · APPROVAL REQUIRED",
                              ],
                            }),
                            jsxRuntime.jsxs("div", {
                              style: {
                                fontSize: 13,
                                marginTop: 6,
                                fontFamily: "'JetBrains Mono',monospace",
                                wordBreak: "break-all",
                              },
                              children: [
                                jsxRuntime.jsx("b", { children: pa.name }),
                                " ",
                                String(JSON.stringify(pa.args)).slice(0, 400),
                              ],
                            }),
                            jsxRuntime.jsx("div", {
                              style: { fontSize: 11, color: "var(--kelp)", marginTop: 4 },
                              children: pa.reason,
                            }),
                            jsxRuntime.jsxs("div", {
                              style: { display: "flex", gap: 8, marginTop: 8 },
                              children: [
                                jsxRuntime.jsx(
                                  "button",
                                  {
                                    style: STYLES.primaryBtn,
                                    onClick: () => globalThis.DCEngine.resolveApproval(pa.id, !0),
                                    children: "approve",
                                  },
                                  pa.id + "ok",
                                ),
                                jsxRuntime.jsx(
                                  "button",
                                  {
                                    style: { ...STYLES.primaryBtn, background: "var(--coral)" },
                                    onClick: () => globalThis.DCEngine.resolveApproval(pa.id, !1),
                                    children: "deny",
                                  },
                                  pa.id + "no",
                                ),
                              ],
                            }),
                          ],
                        },
                        pa.id,
                      ),
                    ),
                    jsxRuntime.jsxs("div", {
                      style: { ...STYLES.projectBar, marginTop: 8, borderColor: "rgba(79,216,235,0.14)" },
                      children: [
                        jsxRuntime.jsx("button", {
                          style: STYLES.ghostBtn,
                          title: i.panelsOpen ? "hide the panel rows" : "show sessions, routing, project and verify",
                          onClick: () => K({ panelsOpen: !i.panelsOpen }),
                          children: i.panelsOpen ? "panels ▴" : "panels ▾",
                        }),
                        jsxRuntime.jsx("span", {
                          style: { color: "var(--foam)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" },
                          children: project ? project.root.split("/").filter(Boolean).pop() + " · " + project.count + " files" : "no project indexed",
                        }),
                        jsxRuntime.jsxs("span", {
                          style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" },
                          children: [sessions.length, " saved", sessionName ? " · naming: " + sessionName : ""],
                        }),
                        jsxRuntime.jsx("span", { style: { marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }, children: [
                          jsxRuntime.jsxs("span", {
                            style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" },
                            children: [i.model, i.thinking ? " · thinking " + i.effort : " · thinking off"],
                          }),
                          jsxRuntime.jsx("button", {
                            style: STYLES.ghostBtn,
                            title: "what this send will cost — click for the token breakdown",
                            onClick: () => {
                              const e2 = estimateSend();
                              setProjectMsg(
                                "this send: ~" + e2.total.toLocaleString() + " tokens ≈ " + fmtCost(e2.usd) +
                                  (e2.peak ? " at peak" : " off-peak") +
                                  " — system " + e2.system.toLocaleString() +
                                  ", history " + e2.history.toLocaleString() +
                                  ", attachments " + e2.attached.toLocaleString(),
                              );
                              K({ panelsOpen: true });
                            },
                            children: "cost ▾",
                          }),
                          jsxRuntime.jsx("button", {
                            style: STYLES.ghostBtn,
                            title: "the exact request bodies that went out, in order, copyable",
                            onClick: () => {
                              setSent(sent ? null : [...(globalThis.__ABYSS_REQS || [])]);
                            },
                            children: "sent ▾",
                          }),
                          jsxRuntime.jsx("button", {
                            style: STYLES.ghostBtn,
                            title: "every change made through this page, with a button to put any of them back",
                            onClick: () => {
                              setJournal(journal ? null : []);
                              loadJournal();
                            },
                            children: "changes",
                          }),
                          jsxRuntime.jsxs("span", {
                            style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" },
                            children: [
                              (i.projectBudgets || {})[project ? project.root : "~"] != null ? "project " : "today ",
                              fmtCost(
                                (i.projectBudgets || {})[project ? project.root : "~"] != null
                                  ? ((daily && daily.byProject && daily.byProject[project ? project.root : "~"]) || { cost: 0 }).cost
                                  : daily && daily.date === todayIndiana()
                                    ? daily.cost
                                    : 0,
                              ),
                              " of ",
                              fmtCost(
                                (i.projectBudgets || {})[project ? project.root : "~"] != null
                                  ? Number((i.projectBudgets || {})[project ? project.root : "~"])
                                  : Number(i.budgetUsd) > 0
                                    ? Number(i.budgetUsd)
                                    : 0,
                              ),
                            ],
                          }),
                        ] }),
                      ],
                    }),
                    i.panelsOpen &&
                      jsxRuntime.jsxs(jsxRuntime.Fragment, {
                        children: [
                        jsxRuntime.jsxs("div", {
                          style: { ...STYLES.projectBar, marginTop: 8 },
                          children: [
                            jsxRuntime.jsx("span", {
                              style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" },
                              children: "session",
                            }),
                            jsxRuntime.jsx("input", {
                              style: { ...STYLES.input, width: 180 },
                              placeholder: "name this session…",
                              value: sessionName,
                              onChange: (h) => setSessionName(h.target.value),
                              onKeyDown: (h) => h.key === "Enter" && saveSession(sessionName),
                            }),
                              jsxRuntime.jsx("input", {
                                style: { ...STYLES.input, width: 150 },
                                placeholder: "tags, comma, separated",
                                list: "tag-hints",
                                value: sessionTags,
                                onChange: (h) => setSessionTags(h.target.value),
                              }),
                              jsxRuntime.jsx("datalist", {
                                id: "tag-hints",
                                children: [...new Set(sessions.flatMap((s2) => s2.tags || []))].map((tg) => jsxRuntime.jsx("option", { value: tg }, tg)),
                              }),
                            jsxRuntime.jsx("button", { style: STYLES.ghostBtn, onClick: () => saveSession(sessionName), children: "save" }),
                            jsxRuntime.jsx("button", {
                              style: STYLES.ghostBtn,
                              onClick: () => {
                                x([]);
                                setSessionMsg("the chat is clear — this does not touch what you saved");
                              },
                              children: "new",
                            }),
                            jsxRuntime.jsxs("button", {
                              style: STYLES.ghostBtn,
                              onClick: () => setSessionOpen(!sessionOpen),
                              children: ["open (", sessions.length, ")"],
                            }),
                            jsxRuntime.jsx("button", { style: STYLES.ghostBtn, onClick: exportSession, children: "export" }),
                            sessionMsg || libNote
                              ? jsxRuntime.jsx("span", {
                                  style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" },
                                  children: [sessionMsg, libNote ? (sessionMsg ? " · " : "") + libNote : ""].join(""),
                                })
                              : null,
                          ],
                        }),
                        journal &&
                          jsxRuntime.jsxs("div", {
                            style: STYLES.projectHits,
                            children: [
                              jsxRuntime.jsx("div", {
                                style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 },
                                children: journalMsg || "loading…",
                              }),
                              journal.length === 0
                                ? jsxRuntime.jsx("div", { style: { color: "var(--kelp)", fontSize: 11.5 }, children: "nothing has been written yet" })
                                : journal.slice(0, 40).map((e2, i2) =>
                                    jsxRuntime.jsxs(
                                      "div",
                                      {
                                        style: { display: "flex", gap: 8, alignItems: "center", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 },
                                        children: [
                                          jsxRuntime.jsxs("span", { style: { flex: 1, color: e2.undoneAt ? "var(--kelp)" : "var(--foam)" }, children: [
                                            e2.path,
                                            jsxRuntime.jsx("span", { style: { color: "var(--kelp)" }, children:
                                              "  " + String(e2.at || "").slice(5, 16).replace("T", " ") +
                                              " · " + (e2.bytesAfter || 0) + " bytes" +
                                              (e2.existed ? "" : " · was new") +
                                              (e2.why ? " · " + String(e2.why).slice(0, 40) : "") +
                                              (e2.undoneAt ? " · put back" : "") }),
                                          ] }),
                                          e2.undoneAt
                                            ? null
                                            : jsxRuntime.jsx("button", {
                                                style: STYLES.microBtn,
                                                onClick: () => restoreFromJournal(e2),
                                                children: "restore",
                                              }),
                                        ],
                                      },
                                      i2,
                                    ),
                                  ),
                              jsxRuntime.jsx("button", { style: { ...STYLES.microBtn, alignSelf: "flex-start", marginTop: 4 }, onClick: () => setJournal(null), children: "close" }),
                            ],
                          }),
                        sent &&
                          jsxRuntime.jsxs("div", {
                            style: STYLES.projectHits,
                            children: [
                              jsxRuntime.jsx("div", {
                                style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 },
                                children: "the last " + sent.length + " request(s), newest last — exactly what left the machine, after scrubbing",
                              }),
                              sent.length === 0
                                ? jsxRuntime.jsx("div", { style: { color: "var(--kelp)", fontSize: 11.5 }, children: "nothing sent yet this visit" })
                                : sent.map((q, i2) =>
                                    jsxRuntime.jsxs(
                                      "div",
                                      { style: { display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid rgba(120,180,210,0.14)", paddingTop: 6 }, children: [
                                        jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--foam)" }, children: [
                                          jsxRuntime.jsx("span", { children: "#" + (i2 + 1) + " " + String(q.at || "").slice(11, 19) + " · " + q.model + " · " + ((q.body.messages || []).length) + " messages · " + (q.body.tools ? q.body.tools.length + " tools" : "no tools") }),
                                          jsxRuntime.jsx("button", {
                                            style: { ...STYLES.microBtn, marginLeft: "auto" },
                                            onClick: () => {
                                              try {
                                                navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(q.body, null, 1));
                                              } catch {}
                                              M("the request json is on the clipboard");
                                            },
                                            children: "copy",
                                          }),
                                        ] }),
                                        jsxRuntime.jsx("pre", { style: { ...STYLES.pre, maxHeight: 180, fontSize: 10.5 }, children: JSON.stringify(q.body, null, 1).slice(0, 4000) }),
                                      ] },
                                      i2,
                                    ),
                                  ),
                              jsxRuntime.jsx("button", { style: { ...STYLES.microBtn, alignSelf: "flex-start", marginTop: 4 }, onClick: () => setSent(null), children: "close" }),
                            ],
                          }),
                        sessionOpen &&
                          jsxRuntime.jsxs("div", {
                            style: STYLES.projectHits,
                            children: [
                              jsxRuntime.jsx("input", {
                                style: { ...STYLES.input, marginBottom: 6 },
                                placeholder: "search saved sessions — by name, project, or anything said in them",
                                value: sessionQuery,
                                onChange: (h) => setSessionQuery(h.target.value),
                              }),
                              sessionMatches().length === 0
                                ? jsxRuntime.jsx("div", { style: { color: "var(--kelp)", fontSize: 11.5 }, children: sessions.length ? "nothing matches that" : "nothing saved yet — name one above and press save" })
                                : sessionMatches()
                                    .slice(0, 30)
                                    .map(({ session: sn, why }) =>
                                      jsxRuntime.jsxs(
                                        "div",
                                        {
                                          style: { display: "flex", gap: 8, alignItems: "center", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 },
                                          children: [
                                            jsxRuntime.jsx("button", {
                                              style: { ...STYLES.hitRow, flex: 1 },
                                              onClick: () => openSession(sn),
                                              title: "open this session",
                                              children: [
                                                jsxRuntime.jsx("span", { style: { color: "var(--foam)" }, children: sn.name }),
                                                jsxRuntime.jsx("span", {
                                                  style: { color: "var(--kelp)", marginLeft: 8 },
                                                  children:
                                                    (sn.at || "").slice(0, 16).replace("T", " ") +
                                                    " · " +
                                                    (sn.messages || []).length +
                                                    " messages" +
                                                    (sn.project ? " · " + sn.project : "") +
                                                    (sn.cost ? " · " + fmtCost(sn.cost) : "") +
                                                  ((sn.tags || []).length ? " · #" + sn.tags.join(" #") : "") +
                                                  (why ? " · " + why : ""),
                                                }),
                                              ],
                                            }),
                                            jsxRuntime.jsx("button", {
                                              style: STYLES.trayX,
                                              title: confirmKill === sn.id ? "click again to delete for good" : "delete (asks once first — the copy on disk goes too)",
                                              onClick: () => {
                                                if (confirmKill === sn.id) {
                                                  setConfirmKill("");
                                                  deleteSession(sn.id);
                                                } else {
                                                  setConfirmKill(sn.id);
                                                  setTimeout(() => setConfirmKill((c2) => (c2 === sn.id ? "" : c2)), 4000);
                                                }
                                              },
                                              children: confirmKill === sn.id ? "sure?" : "×",
                                            }),
                                          ],
                                        },
                                        sn.id,
                                      ),
                                    ),
                            ],
                          }),
                        jsxRuntime.jsxs("div", {
                          style: { ...STYLES.projectBar, gap: 6 },
                          children: [
                            jsxRuntime.jsx("span", {
                              style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" },
                              children: "routing",
                            }),
                            [
                              { id: "cheap", label: "cheap & cheerful", model: "deepseek-flash", thinking: false },
                              { id: "everyday", label: "everyday coding", model: "deepseek-flash", thinking: true, effort: "high" },
                              { id: "hard", label: "hard reasoning", model: "deepseek-v4-pro", thinking: true, effort: "high" },
                            ].map((pr) =>
                              jsxRuntime.jsx(
                                "button",
                                {
                                  style: {
                                    ...STYLES.chip,
                                    width: "auto",
                                    padding: "4px 11px",
                                    fontSize: 11.5,
                                    ...(i.model === pr.model && i.thinking === pr.thinking && (!pr.effort || i.effort === pr.effort)
                                      ? STYLES.chipOn
                                      : {}),
                                  },
                                  title: pr.model + (pr.thinking ? " · thinking " + (pr.effort || i.effort) : " · thinking off"),
                                  onClick: () => applyPreset(pr),
                                  children: pr.label,
                                },
                                pr.id,
                              ),
                            ),
                        jsxRuntime.jsx("button", {
                          style: STYLES.ghostBtn,
                          title: "send the same question to flash and to pro side by side, each with its own bill — use it when you have not asked yet; while it runs, the same button cancels it",
                          onClick: () => (compareBusy ? cancelCompare() : compareModels()),
                          children: compareBusy ? "cancel compare" : "compare flash vs pro",
                        }),
                            jsxRuntime.jsx("span", { style: { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }, children: [
                              jsxRuntime.jsxs("span", {
                                style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" },
                                children: [
                                  "today ",
                                  fmtCost(daily && daily.date === todayIndiana() ? daily.cost : 0),
                                  " of ",
                                  fmtCost(Number(i.budgetUsd) > 0 ? Number(i.budgetUsd) : 0),
                                  Number(i.budgetUsd) > 0 && (daily && daily.date === todayIndiana() ? daily.cost : 0) / Number(i.budgetUsd) > 0.8
                                    ? " · nearly spent"
                                    : "",
                                ],
                              }),
                              jsxRuntime.jsx("button", {
                                style: STYLES.ghostBtn,
                                title: "hand the last exchange to the pro model and ask it to be blunt about what is wrong — use it when you already have an answer",
                                onClick: reviewWithPro,
                                children: "second opinion from pro",
                              }),
                            ] }),
                          ],
                        }),
                        (i.pinned || []).length
                          ? jsxRuntime.jsxs("div", {
                              style: { ...STYLES.projectBar, marginTop: 8 },
                              children: [
                                jsxRuntime.jsx("span", { style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }, children: "pinned" }),
                                (i.pinned || []).map((p2) =>
                                  jsxRuntime.jsxs("span", { style: { display: "flex", gap: 6, alignItems: "center", ...STYLES.chip, width: "auto", padding: "3px 10px", fontSize: 11 }, children: [
                                    p2.name + " · " + (p2.tokens || 0).toLocaleString() + " tok",
                                    jsxRuntime.jsx("button", {
                                      style: STYLES.trayX,
                                      title: confirmUnpin === p2.id ? "click again to unpin" : "unpin (asks once first)",
                                      onClick: () => {
                                        if (confirmUnpin === p2.id) {
                                          setConfirmUnpin("");
                                          unpin(p2.id);
                                        } else {
                                          setConfirmUnpin(p2.id);
                                          setTimeout(() => setConfirmUnpin((c2) => (c2 === p2.id ? "" : c2)), 4000);
                                        }
                                      },
                                      children: confirmUnpin === p2.id ? "sure?" : "×",
                                    }),
                                  ] }, p2.id),
                                ),
                                jsxRuntime.jsxs("span", { style: { marginLeft: "auto", color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }, children: ["cached after the first send · session hit-rate ", $l + "%"] }),
                              ],
                            })
                          : null,
                        triage
                          ? jsxRuntime.jsxs("div", { style: { ...STYLES.projectHits, gap: 6 }, children: [
                              jsxRuntime.jsx("div", { style: { color: "var(--foam)", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }, children: triage.files.length ? "the trace names these files in your project:" : "the trace names " + (triage.candidates || 0) + " path(s), none of them in the indexed project" + (triage.sample ? " — for example " + triage.sample : (project ? "" : " (index a folder first)")) }),
                              triage.files.map((f2) =>
                                jsxRuntime.jsx("div", { style: { fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--kelp)" }, children: f2.path + "  (" + Math.round((f2.size || 0) / 1024) + " kB, " + (f2.kind || "text") + ")" }, f2.path),
                              ),
                              jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, marginTop: 4 }, children: [
                                triage.files.length ? jsxRuntime.jsx("button", { style: STYLES.microBtn, onClick: attachTriageFiles, children: "attach these " + triage.files.length + " files" }) : null,
                                jsxRuntime.jsx("button", { style: STYLES.microBtn, onClick: askToFixTrace, children: "hand the whole thing to the model" }),
                                jsxRuntime.jsx("button", { style: STYLES.microBtn, onClick: () => setTriage(null), children: "dismiss" }),
                              ] }),
                            ] })
                          : null,
                        compare && !compare.busy
                          ? jsxRuntime.jsxs("div", { style: { ...STYLES.card, borderColor: "rgba(79,216,235,0.3)" }, children: [
                              jsxRuntime.jsx("div", { style: { fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, marginBottom: 8 }, children: "The same question, both models, thinking off" }),
                              jsxRuntime.jsx("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }, children: [
                                ["deepseek-flash", "flash", compare.flash],
                                ["deepseek-v4-pro", "pro", compare.pro],
                              ].map(([label, key, side]) =>
                                jsxRuntime.jsxs("div", { children: [
                                  jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "baseline", marginBottom: 6 }, children: [
                                    jsxRuntime.jsx("span", { style: { color: "var(--sonar)", fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5 }, children: label }),
                                    jsxRuntime.jsxs("span", { style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }, children: [
                                      fmtCost(side ? side.cost : 0),
                                      side && side.usage ? " · " + ((side.usage.prompt_tokens || 0) + (side.usage.completion_tokens || 0)).toLocaleString() + " tok" : "",
                                    ] }),
                                    jsxRuntime.jsx("button", { style: { ...STYLES.microBtn, marginLeft: "auto" }, disabled: !side || side.error, onClick: () => useComparison(key), children: "keep this" }),
                                  ] }),
                                  jsxRuntime.jsx("div", { style: { fontSize: 12.5, lineHeight: 1.6, maxHeight: 260, overflowY: "auto", whiteSpace: "pre-wrap", color: "var(--foam)" }, children: side ? side.text.slice(0, 4000) : "" }),
                                ] }, key),
                              ) }),
                            ] })
                          : null,
                        budgetStop
                          ? jsxRuntime.jsx("div", {
                              style: {
                                margin: "10px 22px 0",
                                padding: "8px 12px",
                                background: "rgba(248,81,73,0.12)",
                                border: "1px solid rgba(248,81,73,0.45)",
                                borderRadius: 10,
                                fontSize: 12,
                                color: "#FF9AA4",
                              },
                              children: budgetStop,
                            })
                          : null,
                        redacted &&
                          jsxRuntime.jsx("div", {
                            style: {
                              margin: "10px 22px 0",
                              padding: "6px 12px",
                              background: "rgba(255,180,84,0.12)",
                              border: "1px solid rgba(255,180,84,0.4)",
                              borderRadius: 10,
                              fontSize: 11.5,
                              color: "var(--amber)",
                            },
                            children: "⚠ " + redacted + " — turn this off in Settings if you meant to send it",
                          }),
                        jsxRuntime.jsxs("div", {
                          style: STYLES.projectBar,
                          children: [
                            jsxRuntime.jsx(Icon, { name: "doc", size: 15, color: project ? "var(--sonar)" : "var(--kelp)" }),
                            project
                              ? jsxRuntime.jsxs("span", {
                                  style: { fontFamily: "'JetBrains Mono',monospace", color: "var(--foam)" },
                                  children: [
                                    project.root,
                                    " · ",
                                    String(project.count),
                                    " files · ",
                                    (project.bytes / 1048576).toFixed(1),
                                    " MB · ~",
                                    project.tokens.toLocaleString(),
                                    " tokens if sent whole (≈ ",
                                    fmtCost((project.tokens / 1e6) * 0.15),
                                    " off-peak)",
                                  ],
                                })
                              : jsxRuntime.jsx("input", {
                                  style: { ...STYLES.input, flex: 1, minWidth: 200 },
                                  placeholder: "index a folder as the project — ~/some-project",
                                  value: projPath,
                                  onChange: (h) => setProjPath(h.target.value),
                                  onKeyDown: (h) => h.key === "Enter" && indexProject(projPath),
                                }),
                            project
                              ? jsxRuntime.jsxs(jsxRuntime.Fragment, {
                                  children: [
                                    jsxRuntime.jsx("button", {
                                      style: STYLES.ghostBtn,
                                      title: "put the map in the next message so the model can ask for files by path",
                                      onClick: () => {
                                        setFiles((prev) => [
                                          ...prev,
                                          {
                                            name: "project map",
                                            kind: "text",
                                            bytes: projectMap.length,
                                            tokens: Math.ceil(projectMap.length / 4),
                                            text: projectMap,
                                          },
                                        ]);
                                        setAttachMsg("project map attached — the model can now ask for files by path");
                                      },
                                      children: "attach map",
                                    }),
                                    jsxRuntime.jsx("input", {
                                      style: { ...STYLES.input, width: 180 },
                                      placeholder: "search the project…",
                                      value: projQuery,
                                      onChange: (h) => setProjQuery(h.target.value),
                                      onKeyDown: (h) => h.key === "Enter" && searchProject(),
                                    }),
                                    jsxRuntime.jsx("button", {
                                      style: STYLES.ghostBtn,
                                      disabled: projBusy,
                                      onClick: searchProject,
                                      children: "search",
                                    }),
                                    jsxRuntime.jsx("button", {
                                      style: STYLES.trayX,
                                      title: "forget this project",
                                      onClick: () => {
                                        setProject(null);
                                        setProjectMap("");
                                        setProjHits(null);
                                        setProjectMsg("");
                                      },
                                      children: "×",
                                    }),
                                  ],
                                })
                              : jsxRuntime.jsx("button", {
                                  style: STYLES.ghostBtn,
                                  disabled: projBusy,
                                  onClick: () => indexProject(projPath),
                                  children: projBusy ? "indexing…" : "index",
                                }),
                            projectMsg
                              ? jsxRuntime.jsx("span", {
                                  style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace" },
                                  children: projectMsg,
                                })
                              : null,
                          ],
                        }),
                        helper &&
                          jsxRuntime.jsxs("div", {
                            style: { ...STYLES.projectBar, marginTop: 8 },
                            children: [
                              jsxRuntime.jsx("span", {
                                style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" },
                                children: "verify",
                              }),
                              jsxRuntime.jsx("input", {
                                style: { ...STYLES.input, flex: 1, minWidth: 200 },
                                placeholder: project ? "npm test" : "a command to run, e.g. node --test",
                                value: runCmd,
                                onChange: (h) => setRunCmd(h.target.value),
                                onKeyDown: (h) => h.key === "Enter" && runVerify(),
                              }),
                              jsxRuntime.jsx("button", {
                                style: STYLES.ghostBtn,
                                disabled: runBusy,
                                onClick: () => runVerify(),
                                children: runBusy ? "running…" : "run",
                              }),
                              jsxRuntime.jsx("button", {
                                style: STYLES.ghostBtn,
                                disabled: runBusy || loopBusy,
                                title: "apply what the last reply proposed, run the command, hand failures back to the model — up to 3 rounds, with a log and a stop",
                                onClick: () => applyFixLoop(),
                                children: loopBusy ? "loop running…" : "apply & fix (3)",
                              }),
                              loopBusy
                                ? jsxRuntime.jsx("button", {
                                    style: STYLES.ghostBtn,
                                    onClick: () => stopFixLoop(),
                                    children: "stop",
                                  })
                                : null,
                              jsxRuntime.jsx("button", {
                                style: STYLES.ghostBtn,
                                title: "paste a stack trace or failing output — the files it names in your project come out",
                                onClick: () => {
                                  setTraceOpen(!traceOpen);
                                },
                                children: "trace…",
                              }),
                              traceOpen
                                ? jsxRuntime.jsxs("div", {
                                    style: { ...STYLES.projectBar, marginTop: 8, alignItems: "flex-start" },
                                    children: [
                                      jsxRuntime.jsx("textarea", {
                                        style: { flex: 1, minWidth: 260, minHeight: 78, background: "rgba(4,9,16,0.6)", border: "1px solid rgba(120,180,210,0.22)", borderRadius: 10, color: "#E6F1F7", padding: "8px 10px", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", resize: "vertical" },
                                        placeholder: "paste the stack trace or the failing output here",
                                        value: trace,
                                        onChange: (h) => setTrace(h.target.value),
                                      }),
                                      jsxRuntime.jsxs("span", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
                                        jsxRuntime.jsx("button", { style: STYLES.primaryBtn, onClick: () => triageTrace(trace), children: "find the files" }),
                                        jsxRuntime.jsx("button", { style: STYLES.ghostBtn, onClick: () => setTraceOpen(false), children: "close" }),
                                      ] }),
                                    ],
                                  })
                                : null,
                              lastRun
                                ? jsxRuntime.jsxs("span", {
                                    style: {
                                      fontFamily: "'JetBrains Mono',monospace",
                                      color: lastRun.ok ? "#3FB950" : "var(--coral)",
                                      whiteSpace: "nowrap",
                                    },
                                    children: [
                                      "exit ",
                                      lastRun.code,
                                      " · ",
                                      (lastRun.ms / 1000).toFixed(1),
                                      "s",
                                      lastRun.ok ? "" : " · output sent to the chat",
                                    ],
                                  })
                                : null,
                            ],
                          }),
                        projHits &&
                          jsxRuntime.jsxs("div", {
                            style: STYLES.projectHits,
                            children: [
                              projHits.slice(0, 40).map((hh, i) =>
                                jsxRuntime.jsxs(
                                  "button",
                                  {
                                    style: STYLES.hitRow,
                                    title: "attach this file",
                                    onClick: () => addFromPath(hh.path, !1),
                                    children: [
                                      jsxRuntime.jsxs("span", {
                                        style: { color: "var(--sonar)", whiteSpace: "nowrap" },
                                        children: [hh.path.split("/").pop(), ":", hh.line],
                                      }),
                                      jsxRuntime.jsx("span", {
                                        style: { color: "var(--kelp)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                                        children: String(hh.text || "").slice(0, 130),
                                      }),
                                    ],
                                  },
                                  i,
                                ),
                              ),
                              jsxRuntime.jsxs("button", {
                                style: { ...STYLES.microBtn, alignSelf: "flex-start", marginTop: 4 },
                                onClick: () => setProjHits(null),
                                children: ["close ", projHits.length, " hits"],
                              }),
                            ],
                          }),
                        ],
                      }),
                    files.length > 0 &&
                      jsxRuntime.jsxs("div", {
                        style: STYLES.tray,
                        children: [
                          files.map((f, i) =>
                            jsxRuntime.jsxs(
                              "span",
                              {
                                style: STYLES.trayChip,
                                children: [
                                  (f.kind === "image" ? "picture · " : f.kind === "folder" ? "folder · " : "file · ") + f.name,
                                  jsxRuntime.jsx("span", {
                                    style: { color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5 },
                                    children: f.tokens.toLocaleString() + " tok",
                                  }),
                                  jsxRuntime.jsx("button", {
                                    style: STYLES.trayX,
                                    title: "remove",
                                    onClick: () => setFiles(files.filter((_, j) => j !== i)),
                                    children: "×",
                                  }),
                                ],
                              },
                              i,
                            ),
                          ),
                          jsxRuntime.jsxs("span", {
                            style: {
                              marginLeft: "auto",
                              fontFamily: "'JetBrains Mono',monospace",
                              fontSize: 10.5,
                              color: "var(--kelp)",
                            },
                            children: [
                              files.length + (files.length === 1 ? " file · ~" : " files · ~") +
                                files.reduce((a, f) => a + f.tokens, 0).toLocaleString() +
                                " tokens · ≈ " +
                                fmtCost((files.reduce((a, f) => a + f.tokens, 0) / 1e6) * 0.15) +
                                " off-peak on flash input",
                            ],
                          }),
                        ],
                      }),
                    attachOpen &&
                      jsxRuntime.jsxs("div", {
                        style: STYLES.attachPanel,
                        children: [
                          jsxRuntime.jsxs("div", {
                            style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
                            children: [
                              jsxRuntime.jsx("button", {
                                style: STYLES.ghostBtn,
                                onClick: () => fileInput.current && fileInput.current.click(),
                                children: "choose files",
                              }),
                              jsxRuntime.jsx("input", {
                                style: { ...STYLES.input, flex: 1, minWidth: 220 },
                                placeholder: "or a path on this machine — ~/Downloads/report.pdf",
                                value: attachPath,
                                onChange: (h) => setAttachPath(h.target.value),
                                onKeyDown: (h) => h.key === "Enter" && addFromPath(attachPath, ocrOn),
                              }),
                              jsxRuntime.jsx("button", {
                                style: STYLES.primaryBtn,
                                onClick: () => addFromPath(attachPath, ocrOn),
                                children: "attach",
                              }),
                              jsxRuntime.jsxs("label", {
                                style: { display: "flex", gap: 6, alignItems: "center", fontSize: 11.5, color: "var(--kelp)" },
                                children: [
                                  jsxRuntime.jsx("input", {
                                    type: "checkbox",
                                    checked: ocrOn,
                                    onChange: (h) => setOcrOn(h.target.checked),
                                  }),
                                  "read pictures with OCR",
                                ],
                              }),
                            ],
                          }),
                          jsxRuntime.jsxs("div", {
                            style: { display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" },
                            children: [
                              jsxRuntime.jsx("input", {
                                style: { ...STYLES.input, flex: 1, minWidth: 220 },
                                placeholder: "or a whole folder — ~/some-project",
                                value: folderPath,
                                onChange: (h) => setFolderPath(h.target.value),
                                onKeyDown: (h) => h.key === "Enter" && addFolder(folderPath),
                              }),
                              jsxRuntime.jsx("button", {
                                style: STYLES.primaryBtn,
                                onClick: () => addFolder(folderPath),
                                children: "attach folder",
                              }),
                            ],
                          }),
                          jsxRuntime.jsx("div", {
                            style: { fontSize: 11.5, color: "var(--kelp)", marginTop: 8, lineHeight: 1.6 },
                            children:
                              attachMsg ||
                              (helper
                                ? "Chosen files go into the next message. Paths and folders are read by the helper, which converts pdf, word, excel and rtf, and reads scans and screenshots with OCR."
                                : "Choosing files works right now. A path or a folder needs the helper:  node ~/abyss-console/abyss-bridge.mjs"),
                          }),
                          jsxRuntime.jsx("input", {
                            ref: fileInput,
                            type: "file",
                            multiple: true,
                            style: { display: "none" },
                            onChange: (ev) => {
                              addFiles(ev.target.files);
                              ev.target.value = "";
                            },
                          }),
                        ],
                      }),
                    jsxRuntime.jsxs("div", {
                      style: STYLES.inputRow,
                      children: [
                        jsxRuntime.jsxs("div", {
                          style: STYLES.inputShell,
                          children: [
                            jsxRuntime.jsx(Icon, { name: "wave", size: 22, strokeWidth: 1.8 }),
                            jsxRuntime.jsx("div", { style: STYLES.inputDivider }),
                            jsxRuntime.jsx("textarea", {
                              style: STYLES.textarea,
                              rows: 1,
                              placeholder: n
                                ? "Talk to Abyss — thinking deep — Enter to send, Shift+Enter for newline"
                                : "Add your DeepSeek API key in Settings to begin",
                              value: S,
                              onChange: (h) => E(h.target.value),
                              onKeyDown: (h) => {
                                h.key === "Enter" && !h.shiftKey && (h.preventDefault(), sendMessage());
                              },
                            }),
                            jsxRuntime.jsx("button", {
                              style: { ...STYLES.iconBtn, opacity: files.length ? 1 : 0.75 },
                              title: files.length ? files.length + " attached" : "attach files, a path, or a whole folder",
                              onClick: () => setAttachOpen(!attachOpen),
                              children: jsxRuntime.jsx(Icon, { name: "clip", size: 18, color: attachOpen || files.length ? "var(--sonar)" : "var(--kelp)" }),
                            }),
                            jsxRuntime.jsx("button", {
                              style: STYLES.iconBtn,
                              title: "settings",
                              onClick: () => t("settings"),
                              children: jsxRuntime.jsx(Icon, { name: "sliders", size: 18, color: "var(--kelp)" }),
                            }),
                          ],
                        }),
                        B
                          ? jsxRuntime.jsx("button", {
                              style: { ...STYLES.sendBtn, background: "var(--coral)" },
                              onClick: () => Qe.current && Qe.current.abort(),
                              children: "stop",
                            })
                          : jsxRuntime.jsx("button", { style: STYLES.sendBtn, onClick: () => sendMessage(), children: "Send ↵" }),
                      ],
                    }),
                  ],
                }),
              e === "idea" &&
                jsxRuntime.jsxs("div", {
                  style: STYLES.page,
                  children: [
                    jsxRuntime.jsxs("div", {
                      style: STYLES.pageHead,
                      children: [
                        jsxRuntime.jsxs("div", {
                          children: [
                            jsxRuntime.jsx("h2", { style: STYLES.h2, children: "Daily ROI sounding" }),
                            jsxRuntime.jsxs("p", {
                              style: STYLES.sub,
                              children: [
                                "One novel, buildable project per day that exploits DeepSeek's price physics. Never repeats. At most three tries: flash, flash again with the exact problems quoted back, then ",
                                liveModels.indexOf("deepseek-v4-pro") !== -1 ? "deepseek-v4-pro" : "flash with thinking on",
                                ". The arithmetic is checked before anything is saved.",
                              ],
                            }),
                          ],
                        }),
                        jsxRuntime.jsx("button", {
                          style: STYLES.primaryBtn,
                          disabled: v,
                          onClick: R,
                          children: v ? "sounding the depths…" : todayIdea ? "regenerate today's" : "surface today's idea",
                        }),
                      ],
                    }),
                    v &&
                      ideaStatus &&
                      jsxRuntime.jsx("div", { style: STYLES.empty, children: ideaStatus }),
                    !todayIdea &&
                      !v &&
                      !ideaError &&
                      jsxRuntime.jsxs("div", {
                        style: STYLES.empty,
                        children: [
                          "Nothing surfaced yet today (",
                          todayIndiana(),
                          "). Hit the button — costs well under a cent.",
                        ],
                      }),
                    ideaError &&
                      jsxRuntime.jsxs("div", {
                        style: { ...STYLES.card, borderColor: "var(--coral)" },
                        children: [
                          jsxRuntime.jsx("div", {
                            style: {
                              fontFamily: "'Space Grotesk',sans-serif",
                              fontSize: 15,
                              fontWeight: 600,
                              color: "var(--coral)",
                              marginBottom: 8,
                            },
                            children: "Nothing was saved — here is exactly what came back",
                          }),
                          jsxRuntime.jsx("pre", { style: STYLES.pre, children: ideaError }),
                          jsxRuntime.jsx("div", {
                            style: { fontSize: 11.5, color: "var(--kelp)", marginTop: 8 },
                            children:
                              "A failed attempt is never stored as an idea, so tomorrow still starts clean. Press the button to try again.",
                          }),
                        ],
                      }),
                    Object.values(a)
                      .sort((h, z) => (h.date < z.date ? 1 : -1))
                      .map((h) =>
                        jsxRuntime.jsxs(
                          "div",
                          {
                            style: {
                              ...STYLES.card,
                              borderColor: h.date === todayIndiana() ? "var(--sonar)" : "var(--hull)",
                            },
                            children: [
                              jsxRuntime.jsxs("div", {
                                style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
                                children: [
                                  jsxRuntime.jsx("div", {
                                    style: {
                                      fontFamily: "'Space Grotesk',sans-serif",
                                      fontSize: 17,
                                      fontWeight: 600,
                                      color: h.failed ? "var(--coral)" : "var(--foam)",
                                    },
                                    children: h.title,
                                  }),
                                  jsxRuntime.jsx("div", {
                                    style: { fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "var(--kelp)" },
                                    children: h.date,
                                  }),
                                ],
                              }),
                              h.lever || h.novelty_key
                                ? jsxRuntime.jsxs("div", {
                                    style: { display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" },
                                    children: [
                                      h.lever
                                        ? jsxRuntime.jsx("span", { style: { ...STYLES.chip, padding: "3px 10px", fontSize: 11 }, children: h.lever })
                                        : null,
                                      h.novelty_key
                                        ? jsxRuntime.jsxs("span", {
                                            style: { fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: "var(--kelp)" },
                                            children: ["novelty_key ", h.novelty_key],
                                          })
                                        : null,
                                    ],
                                  })
                                : null,
                              jsxRuntime.jsx("p", {
                                style: { margin: "8px 0", lineHeight: 1.65, fontSize: 13.5 },
                                children: h.pitch,
                              }),
                              h.unit && !h.failed
                                ? jsxRuntime.jsxs("div", {
                                    style: STYLES.ideaField,
                                    children: [
                                      jsxRuntime.jsx("b", { style: STYLES.ideaLabel, children: "Unit economics, recomputed here" }),
                                      jsxRuntime.jsx(IdeaUnitTable, { unit: h.unit }),
                                    ],
                                  })
                                : null,
                              h.roi_math &&
                                jsxRuntime.jsxs("div", {
                                  style: STYLES.ideaField,
                                  children: [jsxRuntime.jsx("b", { style: STYLES.ideaLabel, children: "ROI math" }), h.roi_math],
                                }),
                              h.model_plan &&
                                jsxRuntime.jsxs("div", {
                                  style: STYLES.ideaField,
                                  children: [jsxRuntime.jsx("b", { style: STYLES.ideaLabel, children: "Model plan" }), h.model_plan],
                                }),
                              h.cache_trick &&
                                jsxRuntime.jsxs("div", {
                                  style: STYLES.ideaField,
                                  children: [jsxRuntime.jsx("b", { style: STYLES.ideaLabel, children: "Cache trick" }), h.cache_trick],
                                }),
                              h.build_steps && h.build_steps.length > 0
                                ? jsxRuntime.jsx("ol", {
                                    style: { margin: "8px 0 4px", paddingLeft: 20, fontSize: 13 },
                                    children: h.build_steps.map((z, A) => jsxRuntime.jsx("li", { style: { margin: "3px 0" }, children: z }, A)),
                                  })
                                : null,
                              h.attempts || h.cost_usd
                                ? jsxRuntime.jsxs("div", {
                                    style: { fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "var(--kelp)", marginTop: 10 },
                                    children: [
                                      h.attempts ? h.attempts + (h.attempts === 1 ? " attempt" : " attempts") : "",
                                      h.cost_usd ? " · cost of this run " + fmtCost(h.cost_usd) : "",
                                    ],
                                  })
                                : null,
                              !h.failed &&
                                jsxRuntime.jsx("button", {
                                  style: { ...STYLES.microBtn, marginTop: 10 },
                                  onClick: () => {
                                    (t("chat"),
                                      sendMessage(
                                        `Build the full implementation of this project now, complete code, no placeholders: ${h.title} — ${h.pitch} Steps: ${(h.build_steps || []).join(" | ")}`,
                                      ));
                                  },
                                  children: "build this now →",
                                }),
                            ],
                          },
                          h.date,
                        ),
                      ),
                  ],
                }),
              e === "docs" &&
                jsxRuntime.jsxs("div", {
                  style: STYLES.page,
                  children: [
                    jsxRuntime.jsxs("div", {
                      style: STYLES.pageHead,
                      children: [
                        jsxRuntime.jsxs("div", {
                          children: [
                            jsxRuntime.jsx("h2", { style: STYLES.h2, children: "The cheat sheet" }),
                            jsxRuntime.jsxs("p", {
                              style: STYLES.sub,
                              children: [
                                "Baseline verified ",
                                BASELINE_VERIFIED,
                                " · last live /models poll ",
                                jsxRuntime.jsx("b", { style: { color: "var(--sonar)" }, children: u.verified }),
                                ". Refresh runs GET /models directly against api.deepseek.com on your key — no other AI service involved — and every answer I give obeys the newest bulletin.",
                              ],
                            }),
                          ],
                        }),
                        jsxRuntime.jsxs("div", {
                          style: { display: "flex", gap: 8 },
                          children: [
                            jsxRuntime.jsx("button", {
                              style: STYLES.primaryBtn,
                              disabled: T,
                              onClick: D,
                              children: T ? "polling GET /models…" : "poll live /models",
                            }),
                            jsxRuntime.jsx("button", { style: STYLES.ghostBtn, onClick: G, children: "download .md" }),
                          ],
                        }),
                      ],
                    }),
                    (u.bulletins || []).map((h, z) =>
                      jsxRuntime.jsxs(
                        "div",
                        {
                          style: { ...STYLES.card, borderColor: z === 0 ? "var(--amber)" : "var(--hull)" },
                          children: [
                            jsxRuntime.jsxs("div", {
                              style: {
                                fontFamily: "'JetBrains Mono',monospace",
                                fontSize: 10,
                                color: "var(--amber)",
                                letterSpacing: "0.15em",
                                marginBottom: 6,
                              },
                              children: ["LIVE BULLETIN · ", h.date, z === 0 ? " · OVERRIDES BASELINE" : ""],
                            }),
                            jsxRuntime.jsx(MarkdownBlock, { text: h.text }),
                          ],
                        },
                        z,
                      ),
                    ),
                    jsxRuntime.jsx("div", { style: STYLES.card, children: jsxRuntime.jsx(MarkdownBlock, { text: u.text }) }),
                  ],
                }),
              e === "settings" &&
                jsxRuntime.jsxs("div", {
                  style: STYLES.page,
                  children: [
                    jsxRuntime.jsx("h2", { style: STYLES.h2, children: "Settings" }),
                    jsxRuntime.jsxs("div", {
                      style: STYLES.card,
                      children: [
                        jsxRuntime.jsxs("label", {
                          style: STYLES.label,
                          children: [
                            "DeepSeek API key ",
                            jsxRuntime.jsx("span", {
                              style: { color: "var(--kelp)", fontWeight: 400 },
                              children: "(create at platform.deepseek.com — new accounts get 5M free tokens)",
                            }),
                          ],
                        }),
                        jsxRuntime.jsx("form", {
                          style: { display: "flex", gap: 8, marginTop: 6 },
                          onSubmit: (h) => {
                            (h.preventDefault(), Gt());
                          },
                          children: [
                            jsxRuntime.jsx("input", {
                              type: "password",
                              name: "deepseek-api-key",
                              autocomplete: "off",
                              style: STYLES.input,
                              placeholder: "sk-…",
                              value: l,
                              onChange: (h) => o(h.target.value),
                            }),
                            jsxRuntime.jsx("button", { type: "submit", style: STYLES.primaryBtn, children: "save" }),
                            jsxRuntime.jsx("button", {
                              type: "button",
                              style: STYLES.ghostBtn,
                              onClick: Rc,
                              children: "test",
                            }),
                          ],
                        }),
                        P &&
                          jsxRuntime.jsx("div", {
                            style: {
                              fontSize: 12,
                              color: "var(--sonar)",
                              marginTop: 8,
                              fontFamily: "'JetBrains Mono',monospace",
                            },
                            children: P,
                          }),
                        jsxRuntime.jsx("div", {
                          style: { fontSize: 11.5, color: "var(--kelp)", marginTop: 10, lineHeight: 1.6 },
                          children:
                            "Straight talk on risk: this app calls api.deepseek.com directly from your browser, and the key is saved in this browser's own local storage on this machine. Nothing is uploaded to any server of mine. That is fine for personal use on your own computer; if you ever host this publicly, move the key behind a small server-side proxy instead. Everything in this app — chat, building, cost tracking, the daily idea and the live model check — runs on DeepSeek alone; no other AI service is involved.",
                        }),
                      ],
                    }),
                    jsxRuntime.jsxs("div", {
                      style: STYLES.card,
                      children: [
                        jsxRuntime.jsx("label", { style: STYLES.label, children: "Secrets before sending" }),
                        jsxRuntime.jsxs("div", {
                          style: { display: "flex", gap: 8, marginTop: 6 },
                          children: [
                            jsxRuntime.jsx("button", {
                              style: { ...STYLES.chip, width: "auto", ...(i.redact !== false ? STYLES.chipOn : {}) },
                              onClick: () => K({ redact: true }),
                              children: "scrub keys and tokens",
                            }),
                            jsxRuntime.jsx("button", {
                              style: { ...STYLES.chip, width: "auto", ...(i.redact === false ? STYLES.chipOn : {}) },
                              onClick: () => K({ redact: false }),
                              children: "send everything as it is",
                            }),
                          ],
                        }),
                        jsxRuntime.jsx("label", { style: { ...STYLES.label, marginTop: 18 }, children: "Recipes — instructions you reuse" }),
                        jsxRuntime.jsxs("div", {
                          style: { display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" },
                          children: [
                            jsxRuntime.jsx("input", {
                              style: { ...STYLES.input, width: 200 },
                              placeholder: "name it, e.g. house style",
                              value: recipeName,
                              onChange: (h) => setRecipeName(h.target.value),
                            }),
                            jsxRuntime.jsx("input", {
                              style: { ...STYLES.input, flex: 1, minWidth: 220 },
                              placeholder: "the instruction text that gets pasted into the composer",
                              value: recipeText,
                              onChange: (h) => setRecipeText(h.target.value),
                              onKeyDown: (h) => h.key === "Enter" && addRecipe(),
                            }),
                            jsxRuntime.jsx("button", { style: STYLES.primaryBtn, onClick: addRecipe, children: "keep" }),
                          ],
                        }),
                        recipes.length
                          ? jsxRuntime.jsx("div", { style: { marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }, children: recipes.map((r2) =>
                              jsxRuntime.jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }, children: [
                                jsxRuntime.jsx("button", { style: { ...STYLES.hitRow, flex: 1 }, title: "put it in the composer", onClick: () => useRecipe(r2), children: [
                                  jsxRuntime.jsx("span", { style: { color: "var(--foam)" }, children: r2.name }),
                                  jsxRuntime.jsx("span", { style: { color: "var(--kelp)", marginLeft: 8 }, children: String(r2.text).slice(0, 70) + (r2.text.length > 70 ? "…" : "") }),
                                ] }),
                                jsxRuntime.jsx("button", { style: STYLES.trayX, title: "delete", onClick: () => deleteRecipe(r2.id), children: "×" }),
                              ] }, r2.id)) })
                          : null,
                        jsxRuntime.jsxs("div", {
                          style: { display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" },
                          children: [
                            jsxRuntime.jsx("span", { style: { fontSize: 12, color: "var(--kelp)" }, children: "Daily budget (USD)" }),
                            jsxRuntime.jsx("input", {
                              style: { ...STYLES.input, width: 110 },
                              value: String(i.budgetUsd ?? ""),
                              onChange: (h) => K({ budgetUsd: Number(h.target.value) || 0 }),
                            }),
                            project
                              ? jsxRuntime.jsxs(jsxRuntime.Fragment, {
                                  children: [
                                    jsxRuntime.jsx("span", { style: { fontSize: 12, color: "var(--kelp)" }, children: "This project (USD)" }),
                                    jsxRuntime.jsx("input", {
                                      style: { ...STYLES.input, width: 110 },
                                      placeholder: "falls back to the daily one",
                                      value: String((i.projectBudgets || {})[project.root] ?? ""),
                                      onChange: (h) =>
                                        K({
                                          projectBudgets: { ...(i.projectBudgets || {}), [project.root]: Number(h.target.value) || 0 },
                                        }),
                                    }),
                                  ],
                                })
                              : null,
                            jsxRuntime.jsxs("span", {
                              style: { fontSize: 11.5, color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace" },
                              children: [
                                "spent today ",
                                fmtCost(daily && daily.date === todayIndiana() ? daily.cost : 0),
                                " · ",
                                String(daily && daily.date === todayIndiana() ? daily.calls : 0),
                                " calls · set it to 0 for no limit",
                              ],
                            }),
                          ],
                        }),
                        jsxRuntime.jsx("div", {
                          style: { fontSize: 11.5, color: "var(--kelp)", marginTop: 8, lineHeight: 1.6 },
                          children:
                            "Every message passes through the scrubber first: sk- keys, AWS and GitHub tokens, private key blocks, passwords in connection strings, and anything written as api_key=… or token: …. The count of what was caught is shown above the composer, and you can turn it off here.",
                        }),
                      ],
                    }),
                    jsxRuntime.jsxs("div", {
                      style: STYLES.card,
                      children: [
                        jsxRuntime.jsxs("label", {
                          style: STYLES.label,
                          children: [
                            "Local helper — your MCP room ",
                            jsxRuntime.jsx("span", {
                              style: { color: "var(--kelp)", fontWeight: 400 },
                              children:
                                "— a small program on this machine, started for you by macOS at login and kept alive by it. Your room refuses calls that come from a web page, so the helper makes them on the page's behalf; it also reads files, runs commands and keeps the session library. The room link is dropped after about 75 seconds of quiet and reconnects on your next call — that pause is the reconnect, not a hang. Closing this tab asks the helper to stop; macOS starts it again on your next visit.",
                            }),
                          ],
                        }),
                        jsxRuntime.jsxs("div", {
                          style: { display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" },
                          children: [
                            jsxRuntime.jsx("span", {
                              style: {
                                ...STYLES.chip,
                                padding: "4px 10px",
                                fontSize: 11,
                                borderColor: helper ? "var(--sonar)" : "var(--hull)",
                                color: helper ? "var(--sonar)" : "var(--kelp)",
                              },
                              children: helper ? "running · " + HELPER_URL : "starting… (macOS starts it on demand)",
                            }),
                            jsxRuntime.jsx("button", {
                              style: STYLES.ghostBtn,
                              onClick: () => probeHelper(!1),
                              children: "detect",
                            }),
                            jsxRuntime.jsx("button", {
                              style: STYLES.ghostBtn,
                              disabled: !helper,
                              onClick: () => probeHelper(!0),
                              children: "room status",
                            }),
                            jsxRuntime.jsx("button", {
                              style: STYLES.ghostBtn,
                              disabled: !helper,
                              onClick: () => {
                                K({ mcpOn: !0, mcpUrl: HELPER_URL, mcpToken: "" });
                                M("MCP endpoint set to the helper — press connect below, then the tools are gated as usual.");
                              },
                              children: "use as the MCP endpoint",
                            }),
                          ],
                        }),
                        jsxRuntime.jsx("input", {
                          style: { ...STYLES.input, marginTop: 8 },
                          placeholder: "helper token — cat ~/.abyss-console/token (needed only for a file:// copy of this page)",
                          value: i.helperToken || "",
                          onChange: (h) => K({ helperToken: h.target.value }),
                        }),
                        helperMsg
                          ? jsxRuntime.jsx("div", {
                              style: { fontSize: 11.5, color: "var(--kelp)", marginTop: 8, lineHeight: 1.6 },
                              children: helperMsg,
                            })
                          : null,
                        roomInfo && roomInfo.connected
                          ? jsxRuntime.jsxs("div", {
                              style: {
                                fontSize: 11.5,
                                color: "var(--foam)",
                                marginTop: 6,
                                fontFamily: "'JetBrains Mono',monospace",
                                lineHeight: 1.7,
                              },
                              children: [
                                "onboarded as ",
                                jsxRuntime.jsx("b", { children: roomInfo.harness }),
                                " · servers ",
                                String(roomInfo.count == null ? "?" : roomInfo.count),
                                " · tool lists ",
                                jsxRuntime.jsx("button", {
                                  style: { ...STYLES.microBtn, marginLeft: 8 },
                                  onClick: () => {
                                    fetch(HELPER_URL + "/room/servers")
                                      .then((r) => r.json())
                                      .then((d) =>
                                        M(
                                          "room servers: " +
                                            (d.servers || [])
                                              .slice(0, 12)
                                              .map((x) => x.name + "(" + x.toolCount + ")")
                                              .join(", ") +
                                            (d.count > 12 ? " … " + d.count + " in total" : ""),
                                          ),
                                      )
                                      .catch((e) => M("could not list the room: " + e.message));
                                  },
                                  children: "list",
                                }),
                              ],
                            })
                          : null,
                        helper
                          ? jsxRuntime.jsx("div", {
                              style: { fontSize: 11.5, color: "var(--kelp)", marginTop: 8, lineHeight: 1.6 },
                              children:
                                "It starts itself at login (a launchd job called com.abyss.bridge) and restarts if it ever stops, so there is no command to run. While this page is open it keeps the room link warm; about a minute after you close it, the helper releases the room bridge and its connections, and picks them up again next time you open the page.",
                            })
                          : jsxRuntime.jsx("pre", {
                              style: { ...STYLES.pre, marginTop: 8, fontSize: 11 },
                              children:
                                "# normally nothing to do — macOS starts it at login.\n# to start it right now:\nlaunchctl kickstart -k gui/$(id -u)/com.abyss.bridge\n# to stop it for good:\nlaunchctl bootout gui/$(id -u)/com.abyss.bridge",
                            }),
                      ],
                    }),
                    jsxRuntime.jsxs("div", {
                      style: STYLES.card,
                      children: [
                        jsxRuntime.jsxs("label", {
                          style: STYLES.label,
                          children: [
                            "Desktop Commander MCP ",
                            jsxRuntime.jsx("span", {
                              style: { color: "var(--kelp)", fontWeight: 400 },
                              children:
                                "— local code read/write & commands via the GEMINI bridge on 127.0.0.1:13001 (WebSocket + session token)",
                            }),
                          ],
                        }),
                        jsxRuntime.jsxs("div", {
                          style: { display: "flex", gap: 8, marginTop: 6 },
                          children: [
                            jsxRuntime.jsx("input", {
                              style: STYLES.input,
                              placeholder: "http://127.0.0.1:13001",
                              value: i.mcpUrl,
                              onChange: (h) => K({ mcpUrl: h.target.value }),
                            }),
                            jsxRuntime.jsx("input", {
                              style: STYLES.input,
                              placeholder: "session token — cat ~/.gemini-for-macos/session-token",
                              value: i.mcpToken || "",
                              onChange: (h) => K({ mcpToken: h.target.value }),
                            }),
                            jsxRuntime.jsx("button", {
                              style: STYLES.primaryBtn,
                              onClick: async () => {
                                McpBump((te) => te + 1);
                                try {
                                  M("Connecting to Desktop Commander…");
                                  const te = await DCEngine.connect(i.mcpUrl, i.mcpToken);
                                  M(
                                    "Desktop Commander: " +
                                      te.tools.length +
                                      " tools ready (" +
                                      te.transport +
                                      ")",
                                  );
                                } catch (te) {
                                  const rr = DCEngine.state().lastReason;
                                  M(
                                    "MCP connect failed" +
                                      (rr
                                        ? " [" + rr.code + "] " + rr.headline + " → " + rr.advice
                                        : ": " + String(te.message || te)),
                                  );
                                }
                                McpBump((te) => te + 1);
                              },
                              children: "connect",
                            }),
                            jsxRuntime.jsx("button", {
                              onClick: async () => {
                                McpBump((te) => te + 1);
                                M("Running MCP diagnostics…");
                                try {
                                  const rp = await DCEngine.probe(i.mcpUrl, i.mcpToken);
                                  setDcRep(rp);
                                  M("Diagnose: [" + rp.code + "] " + rp.headline);
                                } catch (te) {
                                  M("Diagnose crashed: " + String(te.message || te));
                                }
                                McpBump((te) => te + 1);
                              },
                              children: "diagnose",
                            }),
                          ],
                        }),
                        jsxRuntime.jsxs("div", {
                          style: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" },
                          children: [
                            jsxRuntime.jsx(
                              "button",
                              {
                                onClick: () => {
                                  const v = !i.mcpOn;
                                  K({ mcpOn: v });
                                  if (v) {
                                    McpBump((te) => te + 1);
                                    M("Connecting to Desktop Commander…");
                                    DCEngine.connect(i.mcpUrl, i.mcpToken)
                                      .then((s) => {
                                        M(
                                          "Desktop Commander: " +
                                            s.tools.length +
                                            " tools ready (" +
                                            s.transport +
                                            ")",
                                        );
                                        McpBump((te) => te + 1);
                                      })
                                      .catch((e) => {
                                        const rr = DCEngine.state().lastReason;
                                        M(
                                          "MCP connect failed" +
                                            (rr
                                              ? " [" + rr.code + "] " + rr.headline + " → " + rr.advice
                                              : ": " + String(e.message || e)),
                                        );
                                        McpBump((te) => te + 1);
                                      });
                                  }
                                },
                                style: { ...STYLES.chip, ...(i.mcpOn ? STYLES.chipOn : {}) },
                                children: i.mcpOn ? "MCP ON" : "MCP OFF",
                              },
                              "mcpton",
                            ),
                            DCEngine.GATES.map((h) =>
                              jsxRuntime.jsx(
                                "button",
                                {
                                  onClick: () => K({ mcpGate: h }),
                                  style: { ...STYLES.chip, ...(i.mcpGate === h ? STYLES.chipOn : {}) },
                                  children: h,
                                },
                                h,
                              ),
                            ),
                          ],
                        }),
                        jsxRuntime.jsx("div", {
                          style: { fontSize: 11.5, color: "var(--kelp)", marginTop: 8, lineHeight: 1.6 },
                          children:
                            "Gates — PLAN: tools are listed for the model but NEVER executed (planning only). ASK ALWAYS: every call needs your approval. ASK WHEN NEEDED: read-only calls run automatically; writes/edits/deletes/commands ask first. YOLO: everything executes, no questions ever. Unknown tools always count as risky; approvals auto-deny after 10 minutes.",
                        }),
                        (() => {
                          const h = DCEngine.state();
                          return jsxRuntime.jsx("div", {
                            style: {
                              fontFamily: "'JetBrains Mono',monospace",
                              fontSize: 11,
                              marginTop: 8,
                              color: h.status === "ready" ? "var(--sonar)" : "var(--coral)",
                            },
                            children:
                              "status: " +
                              h.status +
                              (h.status === "ready"
                                ? " · " +
                                  h.tools.length +
                                  " tools (" +
                                  h.tools.filter((z) => z.risk === "safe").length +
                                  " read-only) · " +
                                  h.transport
                                : h.lastError
                                  ? " — " + h.lastError + (h.lastReason ? " [" + h.lastReason.code + "]" : "")
                                  : ""),
                          });
                        })(),
                        DcRep
                          ? jsxRuntime.jsx("div", {
                              style: {
                                fontFamily: "'JetBrains Mono',monospace",
                                fontSize: 10.5,
                                marginTop: 6,
                                color: DcRep.ok ? "var(--sonar)" : "var(--coral)",
                                whiteSpace: "pre-wrap",
                                lineHeight: 1.6,
                                borderTop: "1px solid var(--kelp)",
                                paddingTop: 6,
                              },
                              children:
                                "DIAGNOSE " +
                                (DcRep.ok ? "OK" : "FAIL") +
                                " [" +
                                DcRep.code +
                                "] " +
                                DcRep.headline +
                                "\nfix: " +
                                DcRep.advice +
                                (DcRep.detail ? "\nraw: " + DcRep.detail : "") +
                                "\nphases:\n  " +
                                DcRep.phases.join("\n  "),
                            })
                          : null,
                      ],
                    }),
                    jsxRuntime.jsxs("div", {
                      style: STYLES.card,
                      children: [
                        jsxRuntime.jsx("label", { style: STYLES.label, children: "Default model" }),
                        jsxRuntime.jsx("div", {
                          style: { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" },
                          children: Object.keys(PRICES).map((h) =>
                            jsxRuntime.jsxs(
                              "button",
                              {
                                onClick: () => K({ model: h }),
                                style: { ...STYLES.chip, ...(i.model === h ? STYLES.chipOn : {}) },
                                children: [
                                  h,
                                  " ",
                                  jsxRuntime.jsxs("span", {
                                    style: { color: "var(--kelp)" },
                                    children: [
                                      Ul.inWindow ? "· peak in " : "· off-peak in ",
                                      `$${Ul.inWindow ? PRICES[h].missP : PRICES[h].miss}`,
                                      "/hit ",
                                      `$${Ul.inWindow ? PRICES[h].hitP : PRICES[h].hit}`,
                                      "/out ",
                                      `$${Ul.inWindow ? PRICES[h].outP : PRICES[h].out}`,
                                      " per M",
                                    ],
                                  }),
                                ],
                              },
                              h,
                            ),
                          ),
                        }),
                        jsxRuntime.jsxs("div", {
                          style: { display: "flex", gap: 24, marginTop: 18, flexWrap: "wrap" },
                          children: [
                            jsxRuntime.jsxs("div", {
                              children: [
                                jsxRuntime.jsx("label", { style: STYLES.label, children: "Thinking mode" }),
                                jsxRuntime.jsxs("div", {
                                  style: { display: "flex", gap: 8, marginTop: 8 },
                                  children: [
                                    jsxRuntime.jsx("button", {
                                      style: { ...STYLES.chip, ...(i.thinking ? STYLES.chipOn : {}) },
                                      onClick: () => K({ thinking: !0 }),
                                      children: "enabled",
                                    }),
                                    jsxRuntime.jsx("button", {
                                      style: { ...STYLES.chip, ...(i.thinking ? {} : STYLES.chipOn) },
                                      onClick: () => K({ thinking: !1 }),
                                      children: "disabled",
                                    }),
                                  ],
                                }),
                              ],
                            }),
                            i.thinking &&
                              jsxRuntime.jsxs("div", {
                                children: [
                                  jsxRuntime.jsx("label", { style: STYLES.label, children: "Reasoning effort" }),
                                  jsxRuntime.jsx("div", {
                                    style: { display: "flex", gap: 8, marginTop: 8 },
                                    children: ["high", "max"].map((h) =>
                                      jsxRuntime.jsx(
                                        "button",
                                        {
                                          style: { ...STYLES.chip, ...(i.effort === h ? STYLES.chipOn : {}) },
                                          onClick: () => K({ effort: h }),
                                          children: h,
                                        },
                                        h,
                                      ),
                                    ),
                                  }),
                                ],
                              }),
                            jsxRuntime.jsxs("div", {
                              children: [
                                jsxRuntime.jsx("label", { style: STYLES.label, children: "Max output tokens" }),
                                jsxRuntime.jsx("input", {
                                  type: "number",
                                  style: { ...STYLES.input, width: 120, marginTop: 8 },
                                  value: i.maxTokens,
                                  min: 256,
                                  max: 384e3,
                                  onChange: (h) =>
                                    K({
                                      maxTokens: Math.min(
                                        384e3,
                                        Math.max(256, Number(h.target.value) || 8e3),
                                      ),
                                    }),
                                }),
                              ],
                            }),
                          ],
                        }),
                        jsxRuntime.jsx("div", {
                          style: { fontSize: 11.5, color: "var(--kelp)", marginTop: 14, lineHeight: 1.6 },
                          children:
                            'Rules the sheet enforces for you: with thinking on, temperature-style knobs are silently ignored by DeepSeek (so none are sent); the thinking trace bills as output; "max" effort needs a big output budget or answers die mid-reasoning with finish_reason "length".',
                        }),
                      ],
                    }),
                    jsxRuntime.jsxs("div", {
                      style: STYLES.card,
                      children: [
                        jsxRuntime.jsx("label", { style: STYLES.label, children: "Session data" }),
                        jsxRuntime.jsxs("div", {
                          style: { display: "flex", gap: 8, marginTop: 10 },
                          children: [
                            jsxRuntime.jsx("button", {
                              style: STYLES.ghostBtn,
                              onClick: () => x([]),
                              children: "clear chat",
                            }),
                            jsxRuntime.jsx("button", {
                              style: STYLES.ghostBtn,
                              onClick: async () => {
                                const h = { hit: 0, miss: 0, out: 0, cost: 0, calls: 0 };
                                (g(h), await storageSet(STORAGE_KEYS.totals, h));
                              },
                              children: "reset cost meter",
                            }),
                            jsxRuntime.jsx("button", {
                              style: STYLES.ghostBtn,
                              onClick: async () => {
                                const h = { text: CHEATSHEET, bulletins: [], verified: BASELINE_VERIFIED };
                                (c(h), await storageSet(STORAGE_KEYS.doc, h));
                              },
                              children: "restore baseline docs",
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
            ],
          }),
          jsxRuntime.jsxs("footer", {
            style: STYLES.sonar,
            children: [
              jsxRuntime.jsxs("div", { style: STYLES.sonarLabel, children: [
                jsxRuntime.jsx("div", { style: STYLES.sonarPing }),
                jsxRuntime.jsx("span", { style: STYLES.sonarLabelText, children: "LIVE COST METER" }),
              ] }),
              jsxRuntime.jsx("div", {
                style: STYLES.sonarBarWrap,
                title: `cache hit ratio ${$l}% — ${Ul.inWindow ? "PEAK 2x" : "off-peak"} — hits bill at $${Ul.inWindow ? PRICES[i.model].hitP : PRICES[i.model].hit}/M vs $${Ul.inWindow ? PRICES[i.model].missP : PRICES[i.model].miss}/M`,
                children: jsxRuntime.jsx("div", { style: { ...STYLES.sonarBarHit, width: `${$l}%` } }),
              }),
              jsxRuntime.jsxs("div", {
                style: STYLES.sonarNums,
                children: [
                  jsxRuntime.jsxs("span", { children: ["hit ", jsxRuntime.jsx("b", { style: { color: "var(--foam)" }, children: y.hit.toLocaleString() })] }),
                  jsxRuntime.jsxs("span", { children: ["miss ", jsxRuntime.jsx("b", { style: { color: "var(--foam)" }, children: y.miss.toLocaleString() })] }),
                  jsxRuntime.jsxs("span", { children: ["out ", jsxRuntime.jsx("b", { style: { color: "var(--foam)" }, children: y.out.toLocaleString() })] }),
                  jsxRuntime.jsxs("span", { children: ["calls ", jsxRuntime.jsx("b", { style: { color: "var(--foam)" }, children: y.calls })] }),
                  jsxRuntime.jsxs("span", { children: ["hit-rate ", jsxRuntime.jsxs("b", { style: { color: "var(--foam)" }, children: [$l, "%"] })] }),
                  jsxRuntime.jsx("span", {
                    title: Ul.note,
                    style: {
                      color: Ul.inWindow ? "var(--amber)" : "var(--kelp)",
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      cursor: "help",
                      fontWeight: Ul.warn ? 700 : 400,
                    },
                    children: Ul.inWindow ? "◐ peak 2x live" : Ul.warn ? "⚠ 2x in " + Ul.minsToPeak + " min" : "◑ off-peak",
                  }),
                ],
              }),
              jsxRuntime.jsxs("div", { style: STYLES.sonarFoot, children: [
                jsxRuntime.jsx(Icon, { name: "wave", size: 14, strokeWidth: 1.4, color: "var(--kelp)" }),
                "BUILT WITH DEEPSEEK · RUNS ON YOUR MACHINE",
              ] }),
            ],
          }),
        ],
      })
    : jsxRuntime.jsx("div", {
        style: { ...STYLES.app, alignItems: "center", justifyContent: "center", display: "flex" },
        children: jsxRuntime.jsx("div", {
          style: { color: "#4FD8EB", fontFamily: "monospace" },
          children: "loading…",
        }),
      });
}
const APP_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
:root{--bg0:#060B14;--trench:rgba(9,17,29,0.62);--hull:rgba(120,180,210,0.16);--sonar:#4FD8EB;--sonar-dim:#5EC8DE;--whale:#2E6BFF;--foam:#E4EEF5;--kelp:#8FA3B4;--amber:#FFB454;--coral:#FF6B7A;--glass:rgba(8,16,28,0.62);}
*{box-sizing:border-box}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:rgba(120,180,210,0.25);border-radius:6px}
::-webkit-scrollbar-track{background:transparent}
textarea:focus,input:focus{outline:1px solid var(--sonar)}
button{cursor:pointer;transition:filter .15s, background .15s}
button:hover{filter:brightness(1.18)}
button:focus-visible{outline:2px solid var(--sonar);outline-offset:2px}
details>summary{cursor:pointer;list-style:none}
details>summary::-webkit-details-marker{display:none}
@keyframes ping{0%{box-shadow:0 0 0 0 rgba(79,216,235,.55)}70%{box-shadow:0 0 0 9px rgba(79,216,235,0)}100%{box-shadow:0 0 0 0 rgba(79,216,235,0)}}
@keyframes drift{0%{opacity:.55}50%{opacity:1}100%{opacity:.55}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
`,
  STYLES = {
    app: {
      display: "grid",
      gridTemplateColumns: "162px 1fr",
      gridTemplateRows: "1fr 46px",
      gridTemplateAreas: '"rail main" "sonar sonar"',
      height: "100vh",
      background: "transparent",
      color: "var(--foam)",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      fontSize: 14,
    },
    brand: { display: "flex", gap: 9, alignItems: "center", padding: "4px 6px 2px" },
    wordmark: {
      fontFamily: "'Space Grotesk',sans-serif",
      fontWeight: 700,
      fontSize: 21,
      letterSpacing: "0.32em",
      color: "var(--foam)",
      lineHeight: 1.1,
    },
    wordmarkSub: { fontSize: 8, letterSpacing: "0.2em", color: "var(--kelp)", marginTop: 2, whiteSpace: "nowrap" },
    railRule: {
      height: 1,
      margin: "12px 8px",
      background: "linear-gradient(90deg, rgba(79,216,235,0.45), rgba(79,216,235,0))",
    },
    railRuleThin: { width: 46, height: 1, background: "var(--sonar)", opacity: 0.45, margin: "14px 8px 12px" },
    powered: { fontSize: 10.5, color: "var(--kelp)", padding: "0 8px", whiteSpace: "nowrap" },
    poweredName: { fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, color: "#D3E9F4", letterSpacing: "0.04em" },
    rail: {
      gridArea: "rail",
      display: "flex",
      flexDirection: "column",
      gap: 6,
      padding: "18px 10px 16px",
      background: "linear-gradient(180deg, rgba(5,11,20,0.62) 0%, rgba(5,11,20,0.38) 55%, rgba(5,11,20,0.55) 100%)",
      backdropFilter: "blur(11px)",
      borderRight: "1px solid rgba(79,216,235,0.14)",
    },
    logo: { display: "flex", gap: 10, alignItems: "center", padding: "2px 8px 20px" },
    logoPulse: {
      width: 12,
      height: 12,
      borderRadius: "50%",
      background: "var(--sonar)",
      animation: "ping 2.6s infinite",
    },
    navBtn: {
      textAlign: "left",
      background: "transparent",
      border: "1px solid transparent",
      color: "#C4D4E0",
      padding: "10px 12px",
      borderRadius: 10,
      fontSize: 13.5,
      fontFamily: "'Space Grotesk',sans-serif",
      fontWeight: 500,
      position: "relative",
      letterSpacing: "0.01em",
      display: "flex",
      alignItems: "center",
      gap: 10,
      cursor: "pointer",
    },
    navBtnOn: {
      background: "linear-gradient(90deg, rgba(79,216,235,0.17), rgba(79,216,235,0.05))",
      border: "1px solid rgba(79,216,235,0.55)",
      color: "var(--sonar)",
      backdropFilter: "blur(8px)",
      boxShadow: "0 0 22px rgba(79,216,235,0.14)",
    },
    railFoot: { display: "flex", flexDirection: "column", gap: 5, padding: "0 8px" },
    tagline: { fontSize: 9, letterSpacing: "0.2em", color: "var(--sonar-dim)", whiteSpace: "nowrap" },
    version: { fontSize: 10, letterSpacing: "0.14em", color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace" },
    localStatus: { display: "flex", alignItems: "center", gap: 7, fontSize: 9.5, letterSpacing: "0.08em", color: "#A9BDCB", whiteSpace: "nowrap" },
    statusDot: { width: 7, height: 7, borderRadius: "50%", background: "#3FB950", boxShadow: "0 0 9px rgba(63,185,80,0.85)" },
    dot: {
      position: "absolute",
      right: 12,
      top: 16,
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: "var(--amber)",
      animation: "drift 1.8s infinite",
    },
    main: { gridArea: "main", display: "flex", flexDirection: "column", overflow: "hidden" },
    chatScroll: { flex: 1, overflowY: "auto", padding: "22px 26px" },
    hero: { paddingTop: "9vh", maxWidth: 720 },
    heroKicker: {
      fontFamily: "'JetBrains Mono',monospace",
      fontSize: 10.5,
      color: "#BCD3E2",
      letterSpacing: "0.3em",
      textTransform: "uppercase",
      marginBottom: 16,
    },
    heroH1: {
      fontFamily: "'Space Grotesk',sans-serif",
      fontSize: 46,
      fontWeight: 700,
      lineHeight: 1.08,
      margin: "0 0 18px",
      letterSpacing: "-0.02em",
      color: "#FFFFFF",
    },
    heroBody: { color: "#C2D3DE", maxWidth: 560, lineHeight: 1.65, fontSize: 14, margin: 0 },
    chipRow: { display: "flex", flexDirection: "column", gap: 8, marginTop: 24, maxWidth: 620 },
    chip: {
      background: "rgba(9,17,29,0.58)",
      border: "1px solid rgba(120,180,210,0.18)",
      color: "#DBE7EF",
      borderRadius: 12,
      padding: "13px 16px",
      fontSize: 13,
      display: "flex",
      alignItems: "center",
      gap: 12,
      width: "100%",
      backdropFilter: "blur(7px)",
      fontFamily: "inherit",
      textAlign: "left",
      cursor: "pointer",
    },
    chipText: { flex: 1, textAlign: "left" },
    chipOn: { borderColor: "var(--sonar)", color: "var(--sonar)", background: "rgba(79,216,235,0.08)" },
    userMsg: {
      maxWidth: "72%",
      background: "linear-gradient(180deg, rgba(46,107,255,0.88), rgba(46,107,255,0.72))",
      color: "#fff",
      padding: "10px 14px",
      borderRadius: "14px 14px 3px 14px",
      fontSize: 13.5,
      lineHeight: 1.6,
      whiteSpace: "pre-wrap",
    },
    botMsg: {
      maxWidth: "88%",
      background: "var(--glass)",
      backdropFilter: "blur(10px)",
      border: "1px solid rgba(120,180,210,0.16)",
      padding: "12px 16px",
      borderRadius: "14px 14px 14px 3px",
    },
    errMsg: { borderColor: "var(--coral)", background: "rgba(255,107,122,0.07)" },
    msgMeta: { marginTop: 8, fontSize: 10.5, color: "var(--kelp)", fontFamily: "'JetBrains Mono',monospace" },
    reasonBox: {
      marginBottom: 8,
      background: "rgba(6,11,20,0.6)",
      border: "1px dashed var(--hull)",
      borderRadius: 8,
      padding: "6px 10px",
    },
    reasonSum: {
      fontSize: 10.5,
      color: "var(--kelp)",
      fontFamily: "'JetBrains Mono',monospace",
      letterSpacing: "0.06em",
    },
    inputRow: { display: "flex", gap: 10, padding: "10px 22px 14px", alignItems: "stretch" },
    tray: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      flexWrap: "wrap",
      padding: "8px 22px 0",
    },
    trayChip: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      background: "var(--glass)",
      backdropFilter: "blur(8px)",
      border: "1px solid rgba(120,180,210,0.2)",
      borderRadius: 999,
      padding: "4px 6px 4px 12px",
      fontSize: 11.5,
      color: "var(--foam)",
      maxWidth: 460,
    },
    trayX: {
      background: "transparent",
      border: "none",
      color: "var(--kelp)",
      fontSize: 14,
      lineHeight: 1,
      cursor: "pointer",
      padding: "0 4px",
    },
    projectBar: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      flexWrap: "wrap",
      margin: "10px 22px 0",
      padding: "8px 12px",
      background: "var(--glass)",
      backdropFilter: "blur(10px)",
      border: "1px solid rgba(79,216,235,0.18)",
      borderRadius: 12,
      fontSize: 11.5,
    },
    projectHits: {
      margin: "8px 22px 0",
      padding: "8px 12px",
      background: "var(--glass)",
      backdropFilter: "blur(10px)",
      border: "1px solid rgba(120,180,210,0.16)",
      borderRadius: 12,
      maxHeight: 190,
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: 3,
    },
    hitRow: {
      display: "flex",
      gap: 8,
      alignItems: "baseline",
      background: "transparent",
      border: "none",
      padding: "2px 0",
      textAlign: "left",
      fontFamily: "'JetBrains Mono',monospace",
      fontSize: 11,
      color: "var(--foam)",
      cursor: "pointer",
    },
    attachPanel: {
      margin: "10px 22px 0",
      padding: "12px 14px",
      background: "var(--glass)",
      backdropFilter: "blur(11px)",
      border: "1px solid rgba(79,216,235,0.28)",
      borderRadius: 14,
    },
    inputShell: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      gap: 12,
      background: "var(--glass)",
      border: "1px solid rgba(79,216,235,0.45)",
      borderRadius: 14,
      padding: "10px 14px",
      backdropFilter: "blur(11px)",
      boxShadow: "0 0 26px rgba(79,216,235,0.13)",
      minHeight: 54,
    },
    inputDivider: { width: 1, alignSelf: "stretch", background: "rgba(120,180,210,0.22)" },
    iconBtn: { background: "transparent", border: "none", padding: 4, display: "flex", alignItems: "center", cursor: "pointer" },
    textarea: {
      flex: 1,
      background: "transparent",
      border: "none",
      outline: "none",
      color: "#E6F1F7",
      padding: "4px 2px",
      fontSize: 13.5,
      resize: "none",
      fontFamily: "inherit",
      lineHeight: 1.5,
      maxHeight: 120,
    },
    sendBtn: {
      background: "var(--sonar)",
      color: "#04121A",
      border: "none",
      borderRadius: 14,
      padding: "0 26px",
      fontFamily: "'Space Grotesk',sans-serif",
      fontWeight: 700,
      fontSize: 14,
      cursor: "pointer",
    },
    page: { flex: 1, overflowY: "auto", padding: "26px 30px" },
    pageHead: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 16,
      marginBottom: 18,
      flexWrap: "wrap",
    },
    h2: {
      fontFamily: "'Space Grotesk',sans-serif",
      fontSize: 23,
      fontWeight: 700,
      margin: 0,
      letterSpacing: "-0.01em",
    },
    sub: { color: "var(--kelp)", fontSize: 12.5, margin: "6px 0 0", maxWidth: 560, lineHeight: 1.6 },
    card: {
      background: "var(--glass)",
      backdropFilter: "blur(10px)",
      border: "1px solid rgba(120,180,210,0.16)",
      borderRadius: 14,
      padding: "18px 20px",
      marginBottom: 14,
    },
    empty: { color: "var(--kelp)", fontSize: 13, padding: "30px 0", textAlign: "center" },
    ideaField: { fontSize: 12.5, margin: "7px 0", lineHeight: 1.6, color: "var(--foam)" },
    ideaLabel: {
      display: "block",
      fontFamily: "'JetBrains Mono',monospace",
      fontSize: 9.5,
      letterSpacing: "0.2em",
      textTransform: "uppercase",
      color: "var(--sonar)",
      marginBottom: 2,
    },
    primaryBtn: {
      background: "var(--sonar)",
      color: "#04121A",
      border: "none",
      borderRadius: 9,
      padding: "9px 16px",
      fontFamily: "'Space Grotesk',sans-serif",
      fontWeight: 600,
      fontSize: 12.5,
    },
    ghostBtn: {
      background: "transparent",
      color: "var(--foam)",
      border: "1px solid var(--hull)",
      borderRadius: 9,
      padding: "9px 14px",
      fontSize: 12.5,
    },
    microBtn: {
      background: "rgba(79,216,235,0.1)",
      color: "var(--sonar)",
      border: "1px solid var(--hull)",
      borderRadius: 6,
      padding: "3px 9px",
      fontSize: 10.5,
      fontFamily: "'JetBrains Mono',monospace",
    },
    label: {
      fontFamily: "'Space Grotesk',sans-serif",
      fontSize: 12.5,
      fontWeight: 600,
      color: "var(--foam)",
    },
    input: {
      flex: 1,
      background: "var(--bg0)",
      border: "1px solid var(--hull)",
      borderRadius: 8,
      color: "var(--foam)",
      padding: "9px 12px",
      fontSize: 13,
      fontFamily: "'JetBrains Mono',monospace",
    },
    inlineCode: {
      background: "rgba(79,216,235,0.1)",
      color: "var(--sonar)",
      borderRadius: 4,
      padding: "1px 5px",
      fontFamily: "'JetBrains Mono',monospace",
      fontSize: "0.88em",
    },
    codeWrap: {
      margin: "10px 0",
      border: "1px solid var(--hull)",
      borderRadius: 9,
      overflow: "hidden",
      background: "#04090F",
    },
    codeHead: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "6px 12px",
      background: "var(--hull)",
      color: "var(--kelp)",
      fontFamily: "'JetBrains Mono',monospace",
    },
    pre: {
      margin: 0,
      padding: "13px 15px",
      overflowX: "auto",
      fontSize: 12,
      lineHeight: 1.6,
      fontFamily: "'JetBrains Mono',monospace",
      color: "#B8D4E8",
    },
    table: { borderCollapse: "collapse", width: "100%", fontSize: 12.5 },
    th: {
      textAlign: "left",
      padding: "7px 11px",
      borderBottom: "1px solid var(--sonar)",
      color: "var(--sonar)",
      fontFamily: "'Space Grotesk',sans-serif",
      fontWeight: 600,
      whiteSpace: "nowrap",
    },
    td: { padding: "7px 11px", borderBottom: "1px solid var(--hull)", verticalAlign: "top" },
    quote: {
      borderLeft: "3px solid var(--sonar)",
      paddingLeft: 12,
      color: "var(--kelp)",
      margin: "8px 0",
      fontStyle: "italic",
    },
    sonar: {
      gridArea: "sonar",
      display: "flex",
      alignItems: "center",
      gap: 16,
      padding: "0 20px",
      borderTop: "1px solid rgba(79,216,235,0.16)",
      background: "rgba(4,9,16,0.78)",
      backdropFilter: "blur(10px)",
    },
    sonarLabel: { display: "flex", alignItems: "center", gap: 10, minWidth: 158 },
    sonarLabelText: {
      fontFamily: "'Space Grotesk',sans-serif",
      fontSize: 11,
      letterSpacing: "0.18em",
      color: "#CFE0EA",
      whiteSpace: "nowrap",
    },
    sonarFoot: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontFamily: "'JetBrains Mono',monospace",
      fontSize: 9.5,
      letterSpacing: "0.2em",
      color: "var(--kelp)",
      whiteSpace: "nowrap",
    },
    sonarPing: {
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: "#3FB950",
      boxShadow: "0 0 10px rgba(63,185,80,0.9)",
      animation: "ping 2.2s infinite",
    },
    sonarBarWrap: {
      width: 190,
      height: 7,
      background: "rgba(120,180,210,0.16)",
      borderRadius: 99,
      overflow: "hidden",
      flexShrink: 0,
    },
    sonarBarHit: {
      height: "100%",
      background: "linear-gradient(90deg, var(--whale), var(--sonar))",
      borderRadius: 99,
      transition: "width .5s ease",
    },
    sonarNums: {
      display: "flex",
      gap: 15,
      fontFamily: "'JetBrains Mono',monospace",
      fontSize: 11,
      color: "var(--kelp)",
      whiteSpace: "nowrap",
      flex: 1,
      alignItems: "center",
    },
  };
document.documentElement.classList.add("abyss-art");
document.body.classList.add("abyss-art");
document.body.style.margin = "0";
document.body.style.backgroundAttachment = "fixed";
createRoot(document.getElementById("root")).render(jsxRuntime.jsx(ReactDOM.StrictMode, { children: jsxRuntime.jsx(App, {}) }));
