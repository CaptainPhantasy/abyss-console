/* Drives the built page in a real browser against a local stand-in for DeepSeek.
   Proves the three-try ladder, the repair round, the pro escalation, the
   empty-choices usage chunk, and that a total failure saves nothing.
   No real API call is made.

   Run it against the test build:
     node build.mjs --api-base http://127.0.0.1:8899
     node tests/roi.e2e.mjs
*/
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const PAGE = readFileSync(new URL("../dist/test-page.html", import.meta.url), "utf8");
const PORT = 8899;

/* ---------- the idea the stand-in returns when it behaves ---------- */
const good = {
  title: "Cache Sitter For Plumbers",
  pitch: "Watches a plumber's inbox and drafts replies. The shop pays monthly, not per seat.",
  roi_math:
    "50,000 input at 90% hit is (5000*0.15 + 45000*0.003)/1e6 = $0.000885, plus 4,000 output at $0.60/M = $0.0024, so $0.003285 a job against a $0.25 price.",
  build_steps: ["Pick the reply template", "Wrap it in a cached prefix", "Add a Stripe link", "Ship it to one shop"],
  model_plan: "deepseek-flash with thinking off — formatting work, and thinking bills as output.",
  cache_trick: "Template and shop tone rules are byte-identical each call, so only the customer note is fresh input.",
  novelty_key: "cache-sitter-plumbers",
  lever: "cache_hit_ratio",
  unit: {
    input_tokens_per_job: 50000,
    output_tokens_per_job: 4000,
    cache_hit_ratio: 0.9,
    cost_per_job_usd_offpeak: (50000 * 0.1 * 0.15 + 50000 * 0.9 * 0.003 + 4000 * 0.6) / 1e6,
    price_to_customer_usd: 0.25,
    gross_margin: "99%",
  },
};

let script = [];
let seen = [];

function sse(res, content, finishReason) {
  const chunk = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  chunk({ id: "x", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  if (content) chunk({ id: "x", choices: [{ index: 0, delta: { content }, finish_reason: null }] });
  chunk({ id: "x", choices: [{ index: 0, delta: {}, finish_reason: finishReason }] });
  /* the documented trap: a usage chunk whose choices array is empty */
  chunk({
    id: "x",
    choices: [],
    usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_cache_hit_tokens: 1000, prompt_cache_miss_tokens: 200 },
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  if (url.pathname === "/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] }));
    return;
  }
  if (url.pathname === "/chat/completions") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      } catch {}
      seen.push(body);
      const next = script.shift() || { content: JSON.stringify(good), finish: "stop" };
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      sse(res, next.content, next.finish || "stop");
    });
    return;
  }
  res.writeHead(404).end("no");
});

/* ---------- browser driving ---------- */
/* Asynchronous on purpose: this process also serves the page, so blocking the
   event loop here would deadlock the browser waiting on our own web server. */
function ab(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn("agent-browser", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("agent-browser timed out on: " + args[0]));
    }, 40000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`agent-browser ${args[0]} failed (${code}): ${err.slice(0, 200)}`));
    });
  });
}
const evalJs = async (js) => (await ab("eval", js)).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const unquote = (raw) => {
  try {
    return JSON.parse(JSON.parse(raw));
  } catch {
    return null;
  }
};

/* Small, single-line browser calls only: every step is a round trip of its own,
   so one slow call can never wedge the run. */
async function driveCase() {
  await ab("open", `http://127.0.0.1:${PORT}/`);
  await sleep(400);
  await evalJs("localStorage.setItem('deepseek_console:apikey', JSON.stringify('sk-stand-in')); localStorage.removeItem('deepseek_console:ideas'); 'seeded'");
  await ab("reload");
  await sleep(1400);
  console.log("    · page loaded, seeding done");
  await evalJs("document.querySelectorAll('nav button')[1].click(); 'idea tab'");
  await sleep(300);
  console.log("    · idea tab open");
  const clicked = await evalJs(
    "(() => { const b = [...document.querySelectorAll('button')].filter((x) => /surface today|regenerate today/.test(x.textContent))[0]; if (!b) return 'missing'; b.click(); return 'clicked'; })()",
  );
  assert.match(clicked, /clicked/, "the generate button was there and was clicked");

  const until = Date.now() + 40000;
  for (;;) {
    const raw = await evalJs(
      "JSON.stringify({ ideas: JSON.parse(localStorage.getItem('deepseek_console:ideas') || '{}'), failed: /Nothing was saved/.test(document.body.innerText) })",
    );
    const state = unquote(raw) || {};
    if (Object.keys(state.ideas || {}).length || state.failed) {
      return { ideas: state.ideas, body: await evalJs("document.body.innerText") };
    }
    assert.ok(Date.now() < until, "the run finished within 40 seconds");
    await sleep(500);
  }
}

async function runCase(name, answers, expect) {
  script = answers.slice();
  seen = [];
  const out = await driveCase();
  const saved = Object.values(out.ideas || {})[0];
  const checks = expect({ requests: seen, saved, body: out.body });

  console.log(`\n${name}`);
  console.log(`  calls made: ${seen.length} -> ${seen.map((r) => r.model).join(", ") || "(none)"}`);
  seen.forEach((r, i) =>
    console.log(
      `   #${i + 1} thinking=${JSON.stringify(r.thinking && r.thinking.type)} json=${JSON.stringify(
        r.response_format,
      )} temp=${r.temperature} max_tokens=${r.max_tokens}`,
    ),
  );
  console.log(`  saved: ${saved ? saved.title + " / " + saved.novelty_key : "(nothing)"}`);
  checks.forEach((c) => console.log("  ✓ " + c));
}

/* ---------- the three runs ---------- */
const only = process.argv[2] && process.argv[2].startsWith("--case=") ? process.argv[2].slice(7) : "";
const cases = { 1: "repair", 2: "pro", 3: "stop" };
const wanted = cases[only] || "";
server.listen(PORT, "127.0.0.1", async () => {
  try {
    if (!wanted || wanted === "repair") await runCase(
      "A broken answer, then a good one — the repair round",
      [
        { content: '{"title":"Cut off here', finish: "length" },
        { content: JSON.stringify(good), finish: "stop" },
      ],
      ({ requests, saved, body }) => {
        assert.equal(requests.length, 2, "exactly two calls");
        assert.equal(requests[0].thinking.type, "disabled", "thinking off for json work");
        assert.equal(requests[0].response_format.type, "json_object", "json mode asked for");
        assert.ok(requests[0].temperature >= 1, "first pass runs warm for variety");
        assert.ok(requests[1].temperature < requests[0].temperature, "the retry is cooler");
        const repair = requests[1].messages[requests[1].messages.length - 1].content;
        assert.match(repair, /rejected by mechanical validation/, "the problem is quoted back");
        assert.match(repair, /cut off/, "and it names the cut-off answer");
        assert.ok(saved, "the idea was saved");
        assert.equal(saved.novelty_key, "cache-sitter-plumbers");
        assert.equal(saved.lever, "cache_hit_ratio");
        assert.equal(saved.attempts, 2);
        assert.ok(/unit economics, recomputed here/i.test(body), "the card shows the verified numbers");
        assert.ok(/\$0\.00328500/.test(body), "and the recomputed cost");
        return [
          "two calls, thinking off, json mode, repair quoted",
          "idea saved with lever, key and a 2-attempt count",
          "card shows $0.00328500 recomputed by the page",
        ];
      },
    );

    if (!wanted || wanted === "pro") await runCase(
      "Two broken answers — the third goes to pro",
      [
        { content: '{"title":"One', finish: "length" },
        { content: '{"title":"Two', finish: "length" },
        { content: JSON.stringify(good), finish: "stop" },
      ],
      ({ requests, saved }) => {
        assert.equal(requests.length, 3);
        assert.equal(requests[2].model, "deepseek-v4-pro", "pro only on the third try");
        assert.equal(requests[2].max_tokens, 6000, "and with more room");
        assert.equal(saved.attempts, 3);
        return ["three calls, the last on deepseek-v4-pro with 6000 max tokens", "idea saved on the third try"];
      },
    );

    if (!wanted || wanted === "stop") await runCase(
      "Three broken answers — nothing is saved",
      [
        { content: '{"title":"One', finish: "length" },
        { content: '{"title":"Two', finish: "length" },
        { content: '{"title":"Three', finish: "length" },
      ],
      ({ requests, saved, body }) => {
        assert.equal(requests.length, 3, "never a fourth call");
        assert.equal(saved, undefined, "no idea stored");
        assert.ok(/Nothing was saved — here is exactly what came back/.test(body), "the screen says so");
        assert.ok(/Three/.test(body), "and shows the last raw answer");
        return ["exactly three calls, then a stop", "nothing written to saved ideas", "the raw answer is shown on screen"];
      },
    );

    console.log("\nALL DAILY-IDEA BROWSER CHECKS PASSED");
    server.close();
    process.exit(0);
  } catch (err) {
    console.error("\nFAILED:", err.stack || err.message);
    server.close();
    process.exit(1);
  }
});
