/* The project-wide features, driven in a real browser against a stand-in DeepSeek:
   the session library on disk with tags and matching lines, the forecast against the real bill,
   flash and pro side by side, pinned context in the cached prefix, and trace triage.

     node build.mjs --api-base http://127.0.0.1:8899
     node tests/features.e2e.mjs
*/
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const PAGE = readFileSync(new URL("../dist/test-page.html", import.meta.url), "utf8");
const MOCK_PORT = Number(process.env.ABYSS_TEST_API_PORT || 8899);
const LAB = mkdtempSync(join(tmpdir(), "abyss-features-"));
const HELPER = "http://127.0.0.1:8793";
const AUTH = join(LAB, "token");
const ISOLATE = join(LAB, "isolate.cjs");
writeFileSync(ISOLATE, `require('node:os').homedir = () => ${JSON.stringify(LAB)}; require('node:module').syncBuiltinESMExports();`);
let HTOKEN = "";
let helper;
const hfetch = (url, opts = {}) =>
  fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...(HTOKEN ? { "x-abyss-token": HTOKEN } : {}) } });
mkdirSync(LAB + "/src", { recursive: true });
writeFileSync(LAB + "/src/checkout.js", "export const total = () => 0;\n");
writeFileSync(LAB + "/src/cart.js", "export const sum = () => 0;\n");
const LEGACY_TEXT = Array.from({ length: 25 }, (_, i) => "// old line " + (i + 1)).join("\n") + "\n";
writeFileSync(LAB + "/src/legacy.js", LEGACY_TEXT);
writeFileSync(LAB + "/check.js", "process.exit(1);\n");
writeFileSync(LAB + "/src/big.js", "// a big line of source\n".repeat(700));
/* a scratch git repo: the branch and the uncommitted list are real too */
execFileSync("git", ["-C", LAB, "init", "-q"]);
execFileSync("git", ["-C", LAB, "config", "user.email", "abyss-lane@example.invalid"]);
execFileSync("git", ["-C", LAB, "config", "user.name", "Abyss Lane"]);
writeFileSync(LAB + "/.gitignore", ".abyss-console/\ntoken\n");
execFileSync("git", ["-C", LAB, "add", "-A"]);
execFileSync("git", ["-C", LAB, "commit", "-q", "-m", "lane fixtures", "--no-verify"]);
writeFileSync(LAB + "/src/wip.js", "export const wip = () => 0;\n");

const seen = [];
const seenFim = [];
const srv = createServer((req, res) => {
  res.setHeader("access-control-allow-origin", HELPER);
  res.setHeader("access-control-allow-headers", "content-type,authorization");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); return; }
  if (u.pathname === "/models") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] })); return; }
  if (u.pathname === "/beta/completions") {
    const ch = []; req.on("data", (c) => ch.push(c));
    req.on("end", () => {
      const b = JSON.parse(Buffer.concat(ch).toString() || "{}");
      seenFim.push({ model: b.model, prompt: String(b.prompt || "") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ text: "\n  return items.length;\n", finish_reason: "stop" }] }));
    });
    return;
  }
  if (u.pathname === "/chat/completions") {
    const ch = []; req.on("data", (c) => ch.push(c));
    req.on("end", () => {
      const b = JSON.parse(Buffer.concat(ch).toString() || "{}");
      seen.push(b);
      const msgs = b.messages || [];
      const lastUser = [...msgs].reverse().find((x) => x.role === "user");
      const lastUserText = String((lastUser && lastUser.content) || "");
      const freshTurn = ((msgs[msgs.length - 1] || {}).role === "user");
      if (freshTurn && /search the project for exports/.test(lastUserText)) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const c = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
        c({ choices: [{ delta: { tool_calls: [
          { index: 0, id: "call_s1", type: "function", function: { name: "search_project", arguments: JSON.stringify({ pattern: "export const" }) } },
          { index: 1, id: "call_r1", type: "function", function: { name: "find_references", arguments: JSON.stringify({ name: "total" }) } },
        ] }, finish_reason: null }] });
        c({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
        c({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 } });
        res.write("data: [DONE]\n\n"); res.end();
        return;
      }
      if (freshTurn && /plan this out/.test(lastUserText)) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const c = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
        c({ choices: [{ delta: { tool_calls: [
          { index: 0, id: "call_t1", type: "function", function: { name: "task_update", arguments: JSON.stringify({ goal: "ship the map check", steps: [{ text: "rank the map", done: true }, { text: "prove it", done: false }] }) } },
        ] }, finish_reason: null }] });
        c({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
        c({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 } });
        res.write("data: [DONE]\n\n"); res.end();
        return;
      }
      if (/write to a file please/.test(lastUserText)) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const c = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
        c({ choices: [{ delta: { content: "Here it is:\n\n**" + LAB + "/src/legacy.js**\n```js\nexport const legacy = () => 1;\n```\n" }, finish_reason: null }] });
        c({ choices: [{ delta: {}, finish_reason: "stop" }] });
        c({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 } });
        res.write("data: [DONE]\n\n"); res.end();
        return;
      }
      if (/This command failed/.test(lastUserText)) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const c = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
        c({ choices: [{ delta: { content: "Fixed:\n\n### file: " + LAB + "/check.js\n```js\nprocess.exit(0);\n```\n" }, finish_reason: null }] });
        c({ choices: [{ delta: {}, finish_reason: "stop" }] });
        c({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 } });
        res.write("data: [DONE]\n\n"); res.end();
        return;
      }
      if (freshTurn && /read the big file/.test(lastUserText)) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const c = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
        c({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_b1", type: "function", function: { name: "read_project_files", arguments: JSON.stringify({ paths: ["src/big.js"] }) } }] }, finish_reason: null }] });
        c({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
        c({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 } });
        res.write("data: [DONE]\n\n"); res.end();
        return;
      }
      if (/slow compare/.test(lastUserText)) {
        const text = b.model === "deepseek-v4-pro" ? "PRO says this" : "FLASH says this";
        setTimeout(() => {
          try {
            res.writeHead(200, { "content-type": "text/event-stream" });
            const c = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
            c({ choices: [{ delta: { content: text }, finish_reason: null }] });
            c({ choices: [{ delta: {}, finish_reason: "stop" }] });
            c({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 } });
            res.write("data: [DONE]\n\n"); res.end();
          } catch {}
        }, 2500);
        return;
      }
      const text = /finish this for me/.test(lastUserText)
        ? "Sure:\n\n```js\nfunction count(items) {\n```\n"
        : b.model === "deepseek-v4-pro" ? "PRO says this" : "FLASH says this";
      res.writeHead(200, { "content-type": "text/event-stream" });
      const c = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
      c({ choices: [{ delta: { content: text }, finish_reason: null }] });
      c({ choices: [{ delta: {}, finish_reason: "stop" }] });
      c({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 } });
      res.write("data: [DONE]\n\n"); res.end();
    });
    return;
  }
  res.writeHead(404).end("no");
});
const ab = (...a) => new Promise((res, rej) => {
  const c = spawn("agent-browser", a, { stdio: ["ignore", "pipe", "pipe"] });
  let o = "", e = ""; c.stdout.on("data", (d) => (o += d)); c.stderr.on("data", (d) => (e += d));
  const t = setTimeout(() => { c.kill(); rej(new Error("timeout " + a[0])); }, 120000);
  c.on("close", (code) => { clearTimeout(t); code === 0 ? res(o.trim()) : rej(new Error(e.slice(0, 150))); });
});
const ev = async (js) => JSON.parse(await ab("eval", js).catch(() => '"null"')).valueOf();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (re) => ab("eval", `(() => { const b=[...document.querySelectorAll('button')].find(x=>new RegExp(${JSON.stringify(re)}).test(x.textContent)); if(!b) return 'no'; b.click(); return 'ok'; })()`);
const typeInto = (placeholderRe, txt) => ab("eval", `(() => { const i=[...document.querySelectorAll('input,input[type=text],textarea')].find(x=>x.placeholder && new RegExp(${JSON.stringify(placeholderRe)}).test(x.placeholder)); if(!i) return 'no-input'; const proto=i.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(i, ${JSON.stringify(txt)}); i.dispatchEvent(new Event('input',{bubbles:true})); return 'typed'; })()`);
const composer = (txt) => typeInto("Talk to Abyss|Add your DeepSeek API key", txt);
const read = (js) => ab("eval", js);
const value = async (js) => {
  const raw = await ab("eval", js);
  try {
    const once = JSON.parse(raw);
    /* agent-browser hands back a json-encoded string; unwrap once more only if it holds json */
    if (typeof once !== "string") return once;
    try {
      return JSON.parse(once);
    } catch {
      return once;
    }
  } catch {
    return raw;
  }
};
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  — " + detail : "")); };

srv.listen(MOCK_PORT, "127.0.0.1", async () => {
  try {
    helper = spawn(process.execPath, ["--require", ISOLATE, fileURLToPath(new URL("../abyss-bridge.mjs", import.meta.url)),
      "--port", "8793", "--page", fileURLToPath(new URL("../dist/test-page.html", import.meta.url))], {
      stdio: "ignore", env: { ...process.env, ABYSS_TOKEN_FILE: AUTH, ROOM_BRIDGE: join(LAB, "no-room.mjs"), ABYSS_NO_FD: "1" },
    });
    process.on("exit", () => helper.kill());
    const deadline = Date.now() + 15000;
    for (;;) {
      try { if ((await fetch(HELPER + "/", { signal: AbortSignal.timeout(3000) })).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error("isolated helper did not start");
      await sleep(100);
    }
    HTOKEN = readFileSync(AUTH, "utf8").trim();
    if (process.argv.includes("--serve-only")) {
      console.log(JSON.stringify({ page: HELPER + "/", project: LAB, mode: "manual browser check" }));
      return;
    }
    await ab("open", HELPER + "/");
    await sleep(900);
    await ab("eval", `localStorage.setItem('deepseek_console:apikey', JSON.stringify('sk-stand-in'));
      localStorage.setItem('deepseek_console:settings', JSON.stringify({ model:'deepseek-flash', thinking:false, effort:'high', maxTokens:8000, mcpOn:false, mcpUrl:'', mcpGate:'PLAN', mcpToken:'', helperToken:${JSON.stringify(HTOKEN)}, redact:true, budgetUsd:0, panelsOpen:true, verifyCmds:{${JSON.stringify(LAB)}:"node check.js\\necho after-check"}, pinned:[{id:'p1', name:'guardrails.md', text:'house rule: never log secrets — password=hunter2hunter2', tokens:12},{id:'p2', name:'legacy.js', path:${JSON.stringify(LAB + "/src/legacy.js")}, text:${JSON.stringify(LEGACY_TEXT)}, tokens:50, at:'2026-09-17T06:00:00.000Z'}] }));
      localStorage.removeItem('deepseek_console:daily'); localStorage.removeItem('deepseek_console:sessions'); localStorage.removeItem('deepseek_console:totals'); location.reload(); 'x'`);
    await sleep(2200);

    /* F7 — one exchange, then the forecast is compared with the bill */
    await composer("what is the cart total");
    await sleep(200);
    await click("Send ↵");
    await sleep(4000);
    const costLine = await read("(() => { const m=document.body.innerText.match(/Cost of that turn[^\\n]{0,260}/); return m ? m[0] : ''; })()");
    check("F7 forecast and actual on the record", /forecast \$0\./.test(costLine) && /actual \$0\./.test(costLine) && /assuming \d+% cache hits/.test(costLine) && /cold session/.test(costLine), costLine.slice(0, 150));

    /* F6 — tags, disk, and the matching line */
    await typeInto("name this session", "cart session");
    await typeInto("tags, comma, separated", "cart, money");
    await click("^save$");
    await sleep(1800);
    const disk = await (await hfetch(HELPER + "/lib")).json();
    check("F6 session and tags land on disk", (disk.sessions || []).some((x) => x.name === "cart session" && (x.tags || []).includes("money")), (disk.sessions || []).length + " sessions on disk");
    const tagHints = await value("(() => { const d=document.querySelector('datalist#tag-hints'); return JSON.stringify(d ? [...d.querySelectorAll('option')].map((x)=>x.value) : []); })()");
    check("A21 the tag box suggests tags you already use", Array.isArray(tagHints) && tagHints.includes("cart") && tagHints.includes("money"), JSON.stringify(tagHints));
    /* A21 — the whole library leaves and comes back as one file */
    const importPath = LAB + "/library-in.json";
    writeFileSync(importPath, JSON.stringify({ exportedAt: "2026-09-17T00:00:00.000Z", sessions: [{ id: "imp1", name: "imported session", at: "2026-09-17T06:30:00.000Z", tags: ["imported"], messages: [{ role: "user", content: "imported hello" }, { role: "assistant", content: "imported world" }] }], recipes: [{ id: "impr1", name: "imported bluntness", text: "Be blunt. Say what is wrong first." }] }));
    await typeInto("import library from this path", importPath);
    await sleep(300);
    await click("^import library$");
    await sleep(1600);
    const libAfterImport = await (await hfetch(HELPER + "/lib")).json();
    const importedSession = (libAfterImport.sessions || []).find((x) => x.id === "imp1");
    const importedRecipe = (libAfterImport.recipes || []).find((x) => x.id === "impr1");
    check(
      "A21 the library imports from a file, on disk",
      !!importedSession && (importedSession.messages || []).length === 2 && !!importedRecipe && /blunt/i.test(importedRecipe.text),
      "session: " + (importedSession ? (importedSession.messages || []).length + " messages" : "missing") + "; recipe: " + (importedRecipe ? "present" : "missing"),
    );
    await click("^export library$");
    await sleep(700);
    const exportMsg = await value("(() => /exported \\d+ session\\(s\\) and \\d+ recipe\\(s\\) as json/.test(document.body.innerText))()");
    check("A21 the library exports as one file", exportMsg === true, "export message: " + exportMsg);
    await click("^new$");
    await sleep(400);
    await click("open \\(");
    await sleep(400);
    await typeInto("search saved sessions", "total");
    await sleep(600);
    const row = await read("(() => { const b=[...document.querySelectorAll('button')].filter(x=>x.title==='open this session')[0]; return b ? b.innerText.replace(/\\n/g,' ') : ''; })()");
    check("F6 search shows the line it matched", /#cart #money/.test(row) && /what is the cart total/.test(row), row.slice(0, 112));
    /* A6 — saving an open session again updates it in place */
    await ab("eval", "(() => { const b=[...document.querySelectorAll('button')].filter((x)=>x.title==='open this session').find((x)=>/cart session/.test(x.textContent||'')); if(!b) return 'no'; b.click(); return 'ok'; })()");
    await sleep(900);
    const libBefore = await (await hfetch(HELPER + "/lib")).json();
    const cartBefore = (libBefore.sessions || []).filter((x) => x.name === "cart session").sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || {};
    const totalBefore = (libBefore.sessions || []).length;
    await composer("a second turn for the session test");
    await sleep(200);
    await click("Send ↵");
    await sleep(3500);
    await click("^save$");
    await sleep(1500);
    const libAfter = await (await hfetch(HELPER + "/lib")).json();
    const cartAfter = (libAfter.sessions || []).filter((x) => x.id === cartBefore.id)[0] || {};
    check(
      "A6 saving again updates in place, no clone",
      !!cartBefore.id && (libAfter.sessions || []).length === totalBefore && (cartAfter.messages || []).length > (cartBefore.messages || []).length,
      "entry " + cartBefore.id + ": " + (cartBefore.messages || []).length + " → " + (cartAfter.messages || []).length + " messages; library " + totalBefore + " → " + (libAfter.sessions || []).length,
    );
    /* A7 — sessions open as tabs, both stay reachable */
    await click("^new$");
    await sleep(400);
    await typeInto("name this session", "canvas tab two");
    await composer("a third chat for the tab test");
    await sleep(200);
    await click("Send ↵");
    await sleep(3500);
    await click("^save$");
    await sleep(1200);
    await click("^new$");
    await sleep(400);
    await click("open \\(");
    await sleep(700);
    await typeInto("search saved sessions", "");
    await sleep(400);
    await ab("eval", "(() => { const b=[...document.querySelectorAll('button')].filter((x)=>x.title==='open this session').find((x)=>/canvas tab two/.test(x.textContent||'')); if(!b) return 'no'; b.click(); return 'ok'; })()");
    await sleep(900);
    await click("open \\(");
    await sleep(700);
    await ab("eval", "(() => { const b=[...document.querySelectorAll('button')].filter((x)=>x.title==='open this session').find((x)=>/cart session/.test(x.textContent||'')); if(!b) return 'no'; b.click(); return 'ok'; })()");
    await sleep(900);
    const tbl = await value("(() => { const t2=[...document.querySelectorAll('button')].filter((x)=>x.title==='switch to this open chat').map((x)=>x.textContent.trim()); const chip=(document.body.innerText.match(/current: [^\\n·]+/)||[''])[0]; return JSON.stringify({ tabs: t2, chip }); })()");
    check("A7 two sessions stay open as tabs", tbl.tabs.includes("canvas tab two") && tbl.tabs.includes("cart session") && /current: cart session/.test(tbl.chip), JSON.stringify(tbl));
    await ab("eval", "(() => { const b=[...document.querySelectorAll('button')].filter((x)=>x.title==='switch to this open chat').find((x)=>/canvas tab two/.test(x.textContent||'')); if(!b) return 'no'; b.click(); return 'ok'; })()");
    await sleep(700);
    const tbl2 = await value("(() => { const chip=(document.body.innerText.match(/current: [^\\n·]+/)||[''])[0]; return JSON.stringify({ chip }); })()");
    check("A7 switching tabs brings the other chat back", /current: canvas tab two/.test(tbl2.chip) && tbl2.chip !== tbl.chip, JSON.stringify({ before: tbl.chip, after: tbl2.chip }));
    /* A19 — delete takes two presses, and only the second one removes */
    await click("open \\(");
    await sleep(700);
    const before19 = ((await (await hfetch(HELPER + "/lib")).json()).sessions || []).length;
    await ab("eval", "(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.title||'').startsWith('delete')); if(!b) return 'no'; b.click(); return 'ok'; })()");
    await sleep(600);
    const sureShown = await value("(() => /sure\\?/.test(document.body.innerText))()");
    const afterOne = ((await (await hfetch(HELPER + "/lib")).json()).sessions || []).length;
    await ab("eval", "(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.trim()==='sure?'); if(!b) return 'no'; b.click(); return 'ok'; })()");
    await sleep(900);
    const afterTwo = ((await (await hfetch(HELPER + "/lib")).json()).sessions || []).length;
    check("A19 delete takes two presses and only then removes", sureShown === true && afterOne === before19 && afterTwo === before19 - 1, "before " + before19 + ", after one " + afterOne + ", after two " + afterTwo);

    /* F8 — both models, both bills */
    await composer("one question, two answers");
    await sleep(300);
    await click("compare flash vs pro");
    await sleep(4500);
    const cmpObj = await value(`(() => {
      const t = document.body.innerText;
      const cards = [...document.querySelectorAll("div")].filter((d) => /FLASH says this/.test(d.innerText || "") && /PRO says this/.test(d.innerText || "") && /thinking off/.test(d.innerText || ""));
      const card = cards.length ? cards[cards.length - 1].innerText : "";
      return JSON.stringify({ both: /FLASH says this/.test(t) && /PRO says this/.test(t), money: (card.match(/\\$0\\.\\d{6,}/g) || []).length, sample: card.replace(/\\s+/g, " ").slice(0, 120) });
    })()`);
    check("F8 both answers side by side with a price each", cmpObj.both && cmpObj.money >= 2, "both panels' prices: " + cmpObj.money + " — " + cmpObj.sample + ", models asked: " + [...new Set(seen.map((b) => b.model))].join("+"));
    const a15 = await value("(() => { const ts=[...document.querySelectorAll('button')].map((x)=>x.title||''); return JSON.stringify({ cmp: ts.some((x)=>/flash and to pro side by side/.test(x)), rev: ts.some((x)=>/be blunt/.test(x)), label: /second opinion from pro/.test(document.body.innerText) }); })()");
    check("A15 the two compare actions explain themselves", a15.cmp && a15.rev && a15.label, JSON.stringify(a15));
    const a11 = await value("(() => { const t=document.body.innerText; const btns=[...document.querySelectorAll('button')].map((x)=>(x.textContent||'').trim()); return JSON.stringify({ meter: /(today|project) \\$/.test(t), est: btns.includes('cost ▾'), chip: /send ≈ /.test(t), sigma: /Σ /.test(t) }); })()");
    check("A11 one cost number, the rest behind a click", a11.meter && a11.est && !a11.chip && !a11.sigma, JSON.stringify(a11));
    await click("^sent ▾$");
    await sleep(700);
    const a20 = await value("(() => { const t=document.body.innerText; return JSON.stringify({ panel: /exactly what left the machine/.test(t), body: /\"messages\"/.test(t), copy: [...document.querySelectorAll('button')].some((x)=>(x.textContent||'').trim()==='copy') }); })()");
    check("A20 the sent-request inspector shows the body", a20.panel && a20.body && a20.copy, JSON.stringify(a20));
    /* A14 — the compare pair can be cancelled mid-flight */
    await composer("slow compare question");
    await sleep(200);
    await click("compare flash vs pro");
    await sleep(700);
    const midTxt = await value("(() => JSON.stringify({ cancel: [...document.querySelectorAll('button')].some((x)=>(x.textContent||'').trim()==='cancel compare') }))()");
    await click("cancel compare");
    await sleep(1200);
    const afterTxt = await value("(() => { const t=document.body.innerText; return JSON.stringify({ cancelled: /cancelled/.test(t), back: [...document.querySelectorAll('button')].some((x)=>(x.textContent||'').trim()==='compare flash vs pro') }); })()");
    check("A14 the compare pair cancels on demand", midTxt.cancel && afterTxt.cancelled && afterTxt.back, JSON.stringify({ mid: midTxt, after: afterTxt }));
    /* A13 — the ⌘K command palette */
    await ab("eval", "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })); 'k'");
    await sleep(500);
    const palOpen = await value("(() => JSON.stringify({ open: [...document.querySelectorAll('input')].some((x)=>/⌘K palette/.test(x.placeholder||'')) }))()");
    await ab("eval", "(() => { const i=[...document.querySelectorAll('input')].find((x)=>/⌘K palette/.test(x.placeholder||'')); if(!i) return 'no'; const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(i,'cost'); i.dispatchEvent(new Event('input',{bubbles:true})); return 'typed'; })()");
    await sleep(300);
    await ab("eval", "(() => { const i=[...document.querySelectorAll('input')].find((x)=>/⌘K palette/.test(x.placeholder||'')); if(!i) return 'no'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 'enter'; })()");
    await sleep(700);
    const palRun = await value("(() => { const t2=document.body.innerText; const still=[...document.querySelectorAll('input')].some((x)=>/⌘K palette/.test(x.placeholder||'')); return JSON.stringify({ ran: /this send: ~/.test(t2), closed: !still }); })()");
    check("A13 ⌘K opens a palette that runs actions", palOpen.open && palRun.ran && palRun.closed, JSON.stringify({ palOpen, palRun }));

    /* F9 — pinned context in the cached prefix, and the meter */
    const before = seen.length;
    await composer("with the pin in place");
    await sleep(200);
    await click("Send ↵");
    await sleep(3500);
    const sys = (seen[seen.length - 1] || {}).messages?.[0]?.content || "";
    check("F9 the pin rides in the system message", sys.includes("PINNED: guardrails.md") && sys.includes("never log secrets"), (seen.length - before) + " call(s), system " + sys.length + " chars");
    check("A2 the pinned secret is scrubbed before it leaves", !sys.includes("hunter2hunter2") && /REDACTED/.test(sys), /REDACTED/.test(sys) ? "redaction marker present" : "redaction marker MISSING");
    check("A23 the build contract teaches the write-card format", sys.includes("### file: <path>") && sys.includes("touched:"), sys.includes("### file:") && sys.includes("touched:") ? "taught, plus the touched-files line" : "NOT fully taught");
    check(
      "A22 the spend footer never rides into a request",
      (((seen[seen.length - 1] || {}).messages) || []).every((x) => !/^\*\*Cost of that turn\*\*/.test(String(x.content || ""))),
      "messages in the request: " + ((((seen[seen.length - 1] || {}).messages) || []).length),
    );
    const meter = await value("(() => /cached after the first send · session hit-rate/.test(document.body.innerText) ? 'shown' : 'missing')()");
    check("F9 the cache meter sits next to the pins", meter === "shown", meter);

    /* F10 — a trace names two files in the project, and they attach */
    await typeInto("index a folder", LAB);
    await sleep(300);
    await click("^index$");
    await sleep(6000);
    await click("trace…");
    await sleep(500);
    await typeInto("paste the stack trace", "TypeError: price is not a function\n    at total (" + LAB + "/src/checkout.js:2:20)\n    at sum (" + LAB + "/src/cart.js:2:21)");
    await sleep(300);
    await click("find the files");
    await sleep(1500);
    const tri = await value("(() => { const t=document.body.innerText; const m=t.match(/the trace names (\\d+) file\\(s\\) in this project/); return JSON.stringify({ n: m ? Number(m[1]) : 0, attach: /attach these \\d+ files/.test(t) }); })()");
    check("F10 the trace's files are found", tri.n === 2 && tri.attach, JSON.stringify(tri));
    await click("attach these 2 files");
    await sleep(2500);
    const chips = await value("(() => { const t=document.body.innerText; return JSON.stringify(Number((t.match(/file · (checkout|cart)\\.js/g)||[]).length)); })()");
    check("F10 those files attach to the next message", chips === 2, "chips: " + chips);

    /* B2/B3 — the model can search the project and find references */
    const beforeTools = seen.length;
    await click("^attach map$");
    await sleep(500);
    await composer("search the project for exports");
    await sleep(200);
    await click("Send ↵");
    await sleep(4500);
    const firstCall = seen[beforeTools] || {};
    const offered = ((firstCall.tools || []).map((x) => x.function && x.function.name)).join(",");
    check("B2/B3 both project tools are offered", /search_project/.test(offered) && /find_references/.test(offered), "tools: " + offered);
    const lastReq = seen[seen.length - 1] || {};
    const toolTexts = (lastReq.messages || []).filter((x) => x.role === "tool").map((x) => String(x.content)).join("\n");
    check("B2 search_project returns file:line hits", /checkout\.js:1/.test(toolTexts) && /cart\.js:1/.test(toolTexts), (toolTexts.match(/hits for[^\n]*/) || ["(no search result)"])[0]);
    check("B3 find_references names where a symbol is used", /references to "total"/.test(toolTexts) && /checkout\.js:1/.test(toolTexts), (toolTexts.match(/references to[^\n]*/) || ["(no references result)"])[0]);
    const toolPeak = await value("(() => (globalThis.__ABYSS_TOOLS || {}).peak || 0)()");
    check("B10 independent reads run together", toolPeak >= 2, "peak concurrent tool runs: " + toolPeak);
    const mapMsg = ((lastReq.messages || []).map((x) => String(x.content || "")).find((c) => c.includes("### attached: project map")) || "");
    const atCart = mapMsg.indexOf("cart.js");
    const atBig = mapMsg.indexOf("big.js");
    check("B6 the map ranks the relevant file above the big one", !!mapMsg && atCart !== -1 && atBig !== -1 && atCart < atBig, mapMsg ? "cart at " + atCart + ", big at " + atBig : "(no map in the request)");

    /* B8/B17 — a task list the model writes, the page shows, and the next turn carries */
    await composer("plan this out");
    await sleep(200);
    await click("Send ↵");
    await sleep(4500);
    const taskPanel = await value("(() => { const t=document.body.innerText; return JSON.stringify({ goal: /task · ship the map check/.test(t), done: /1\\/2 done/.test(t) }); })()");
    check("B8 the task list is visible on the page", taskPanel.goal && taskPanel.done, JSON.stringify(taskPanel));
    await composer("with the task in place");
    await sleep(200);
    await click("Send ↵");
    await sleep(3500);
    const taskReq = seen[seen.length - 1] || {};
    const taskSys = String(((taskReq.messages || [])[0] || {}).content || "");
    check("B8/B17 the task list survives into the next request", /## TASK:/.test(taskSys) && /- \[x\] rank the map/.test(taskSys) && /- \[ \] prove it/.test(taskSys), (taskSys.match(/## TASK:[\s\S]{0,140}/) || ["(no TASK line)"])[0].replace(/\n/g, " | "));

    /* B11 — a task can carry its own budget, and the page refuses to spend past it */
    const beforeGuard = seen.length;
    await typeInto("task budget", "0.00001");
    await sleep(300);
    await composer("one more thing");
    await sleep(200);
    await click("Send ↵");
    await sleep(1200);
    const guardText = await value("(() => { const m = document.body.innerText.match(/This task's budget is spent[^\\n]*/); return m ? m[0] : ''; })()");
    check("B11 the task stops at its budget", /This task's budget is spent/.test(guardText) && seen.length === beforeGuard, "calls after the guard: " + (seen.length - beforeGuard) + " — " + String(guardText).slice(0, 110));
    await typeInto("task budget", "0");
    await sleep(300);

    /* A5/B9 — git: the panel on the page, and the branch plus changes in the context */
    const sysB9 = String((((firstCall || {}).messages || [])[0] || {}).content || "");
    check(
      "B9 the branch and the uncommitted list ride in the request context",
      /## GIT: branch \S+ at [0-9a-f]{7,}/.test(sysB9) && /uncommitted change/.test(sysB9) && /wip\.js/.test(sysB9),
      (sysB9.match(/## GIT:[^\n]*/) || ["(no GIT line)"])[0].slice(0, 150),
    );
    const gitRow = await value("(() => { const t=document.body.innerText; const btns=[...document.querySelectorAll('button')].map((x)=>(x.textContent||'').trim()); return JSON.stringify({ row: /git · \\S+ at [0-9a-f]{7}/.test(t), changed: /· \\d+ changed/.test(t), stageAll: btns.includes('stage all'), chip: /\\?\\? src\\/wip\\.js/.test(t) }); })()");
    check("A5 the git panel shows the branch and the change list", gitRow.row && gitRow.changed && gitRow.stageAll && gitRow.chip, JSON.stringify(gitRow));
    await ab("eval", "(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.textContent||'').trim().endsWith('src/wip.js')); if(!b) return 'no'; b.click(); return 'ok'; })()");
    await sleep(700);
    const gitDiffOpen = await value("(() => /diff vs HEAD · src\\/wip\\.js/.test(document.body.innerText))()");
    check("A5 a changed file opens its diff", gitDiffOpen === true, "diff panel open: " + gitDiffOpen);

    /* B1 — one click: apply, run, feed back, repeat; bounded, logged, stoppable */
    await click("apply & fix");
    await sleep(12000);
    const loopRes = await value("(() => { const t=document.body.innerText; return JSON.stringify({ r1: /fix round 1: nothing new to apply/.test(t), r2: /fix round 2: wrote 1 file/.test(t), exit0: /→ exit 0/.test(t), green: /all 2 command\\(s\\) green — stopping after 2 round/.test(t) }); })()");
    check("B1 the fix loop applies, runs, feeds back and stops green", loopRes.r1 && loopRes.r2 && loopRes.exit0 && loopRes.green, JSON.stringify(loopRes));
    const b15Txt = await value("(() => /`echo after-check` → exit 0/.test(document.body.innerText))()");
    check("B15 the loop runs the verify lines one at a time", b15Txt === true, "second command reported: " + b15Txt);
    check("B1 the loop really wrote the fix to disk", readFileSync(LAB + "/check.js", "utf8").trim() === "process.exit(0);", "check.js now: " + readFileSync(LAB + "/check.js", "utf8").trim());

    /* B4 — a cut tool result says so */
    await composer("read the big file");
    await sleep(200);
    await click("Send ↵");
    await sleep(4500);
    const bigReq = seen[seen.length - 1] || {};
    const bigTool = (bigReq.messages || []).filter((x) => x.role === "tool").map((x) => String(x.content)).join("\n");
    check("B4 a cut tool result says where it was cut", /cut at 12,000 characters/.test(bigTool), "tool result " + bigTool.length + " chars :: " + bigTool.slice(0, 150).replace(/\n/g, "\\n"));

    /* A23 — a bold-filename reply still gets the write card */
    await composer("write to a file please");
    await sleep(200);
    await click("Send ↵");
    await sleep(4000);
    const wcard = await value("(() => { const el=[...document.querySelectorAll('div')].find((x)=>/^This reply proposes writing/.test((x.textContent||'').trim())); const t=el ? el.textContent : ''; return JSON.stringify({ card: !!el, name: /legacy\\.js/.test(t) }); })()");
    check("A23 the write card renders for the taught format", wcard.card && wcard.name, JSON.stringify(wcard));
    await click("^compare$");
    await sleep(2600);
    const wdiff = await value("(() => { const t=document.body.innerText; return JSON.stringify({ del: /− \\/\\/ old line 1/.test(t), add: /\\+ export const legacy/.test(t), nudge: /removes 25 lines/.test(t), err: /could not read/.test(t) || /not answering/.test(t) }); })()");
    check("A4 the card shows a real diff and flags a big rewrite", wdiff.del && wdiff.add && wdiff.nudge, JSON.stringify(wdiff));

    /* A8/A9 — the map says when files changed; a pin says when its file changed */
    writeFileSync(LAB + "/src/fresh.js", "export const fresh = () => 1;\n");
    writeFileSync(LAB + "/src/legacy.js", "// rewritten by the freshness test\n");
    await ab("eval", "window.dispatchEvent(new Event('focus')); 'focused'");
    await sleep(1200);
    const staleTxt = await value("(() => { const t=document.body.innerText; return JSON.stringify({ map: /files changed — press re-index/.test(t), pin: /changed on disk/.test(t), aged: /indexed \\d{2}:\\d{2}/.test(t) }); })()");
    check("A8/A9 changed files and edited pins are flagged", staleTxt.map && staleTxt.pin && staleTxt.aged, JSON.stringify(staleTxt));
    await ab("eval", "(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.title==='re-read this file now'); if(!b) return 'no'; b.click(); return 'ok'; })()");
    await sleep(900);
    const reRead = await value("(() => /changed on disk/.test(document.body.innerText))()");
    check("A9 re-reading a pin clears the flag", reRead === false, "still stale: " + reRead);
    await click("^re-index$");
    await sleep(6000);
    const mapGone = await value("(() => !/files changed — press re-index/.test(document.body.innerText))()");
    check("A8 re-indexing clears the map's flag", mapGone === true, "map still says stale: " + !mapGone);

    /* a code block can be finished by the cheap model (fill-in-the-middle) */
    await click("^new$");
    await sleep(600);
    await composer("finish this for me");
    await sleep(200);
    await click("Send ↵");
    await sleep(4000);
    await click("finish it");
    await sleep(2500);
    const fim = await value("(() => { const t=document.body.innerText; return JSON.stringify({ shown: /THE MODEL CONTINUED IT WITH/.test(t), added: /return items\\.length/.test(t) }); })()");
    check("Feature: fill-in-the-middle finishes a code block", fim.shown && fim.added && seenFim.length === 1 && /function count/.test(seenFim[0].prompt), "asked " + seenFim.length + " time(s), model " + (seenFim[0] || {}).model + ", shown " + fim.shown + ", added " + fim.added + ", prompt " + String((seenFim[0] || {}).prompt || "").slice(0, 60).replace(/\n/g, "\\n"));

    /* a recipe is kept and put back in the composer */
    await ab("eval", "document.querySelectorAll('nav button')[3].click(); 'settings'");
    await sleep(900);
    const lifeTxt = await value("(() => { const t=document.body.innerText; return JSON.stringify({ q75: /75 seconds/.test(t), close: /Closing this tab asks the helper/.test(t) }); })()");
    check("A16/A17 the helper's lifecycle is stated on the page", lifeTxt.q75 && lifeTxt.close, JSON.stringify(lifeTxt));
    await typeInto("name it, e.g. house style", "house style");
    await typeInto("the instruction text", "Short sentences. Name the file before each block.");
    await click("^keep$");
    await sleep(900);
    const kept = await (await hfetch(HELPER + "/lib")).json();
    check("Feature: recipes are kept, on disk too", (kept.recipes || []).some((x) => (x.tags || []).length >= 0 && x.text.includes("Short sentences")), (kept.recipes || []).length + " recipes on disk");
    await ab("eval", "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.title==='put it in the composer'); if(!b) return 'no'; b.click(); return 'ok'; })()");
    await sleep(400);
    await ab("eval", "document.querySelectorAll('nav button')[0].click(); 'chat'");
    await sleep(700);
    const inComposer = await value(
      "(() => { const ta=[...document.querySelectorAll('textarea')].find(x=>/Talk to Abyss|Add your DeepSeek API key/.test(x.placeholder||'')); return JSON.stringify(!!ta && /Short sentences/.test(ta.value)); })()",
    );
    check("Feature: a recipe lands in the composer", inComposer === true, String(inComposer));

    console.log("\n" + results.filter(Boolean).length + "/" + results.length + " checks passed");
    srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
  } catch (e) { console.log("FAILED:", e.message); srv.close(); process.exit(1); }
});
