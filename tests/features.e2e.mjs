/* The project-wide features, driven in a real browser against a stand-in DeepSeek:
   the session library on disk with tags and matching lines, the forecast against the real bill,
   flash and pro side by side, pinned context in the cached prefix, and trace triage.

     node build.mjs --api-base http://127.0.0.1:8899
     node tests/features.e2e.mjs
*/
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
const PAGE = readFileSync(new URL("../dist/test-page.html", import.meta.url), "utf8");
/* the helper's token, when the hardened helper (A1) is the one running */
const HTOKEN = (() => {
  try {
    return readFileSync(homedir() + "/.abyss-console/token", "utf8").trim();
  } catch {
    return "";
  }
})();
const hfetch = (url, opts = {}) =>
  fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...(HTOKEN ? { "x-abyss-token": HTOKEN } : {}) } });
const LAB = "/tmp/final-lab2";
rmSync(LAB, { recursive: true, force: true });
mkdirSync(LAB + "/src", { recursive: true });
writeFileSync(LAB + "/src/checkout.js", "export const total = () => 0;\n");
writeFileSync(LAB + "/src/cart.js", "export const sum = () => 0;\n");
writeFileSync(LAB + "/src/legacy.js", Array.from({ length: 25 }, (_, i) => "// old line " + (i + 1)).join("\n") + "\n");

const seen = [];
const seenFim = [];
const srv = createServer((req, res) => {
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
      const roles = msgs.map((x) => x.role);
      const lastUser = [...msgs].reverse().find((x) => x.role === "user");
      const lastUserText = String((lastUser && lastUser.content) || "");
      if (/search the project for exports/.test(lastUserText) && !roles.includes("tool")) {
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
      if (/write to a file please/.test(lastUserText)) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const c = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
        c({ choices: [{ delta: { content: "Here it is:\n\n**" + LAB + "/src/legacy.js**\n```js\nexport const legacy = () => 1;\n```\n" }, finish_reason: null }] });
        c({ choices: [{ delta: {}, finish_reason: "stop" }] });
        c({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 } });
        res.write("data: [DONE]\n\n"); res.end();
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

srv.listen(8899, "127.0.0.1", async () => {
  try {
    await ab("open", "http://127.0.0.1:8899/");
    await sleep(900);
    await ab("eval", `localStorage.setItem('deepseek_console:apikey', JSON.stringify('sk-stand-in'));
      localStorage.setItem('deepseek_console:settings', JSON.stringify({ model:'deepseek-flash', thinking:false, effort:'high', maxTokens:8000, mcpOn:false, mcpUrl:'', mcpGate:'PLAN', mcpToken:'', helperToken:${JSON.stringify(HTOKEN)}, redact:true, budgetUsd:0, panelsOpen:true, pinned:[{id:'p1', name:'guardrails.md', text:'house rule: never log secrets — password=hunter2hunter2', tokens:12}] }));
      localStorage.removeItem('deepseek_console:daily'); localStorage.removeItem('deepseek_console:sessions'); location.reload(); 'x'`);
    await sleep(2200);

    /* F7 — one exchange, then the forecast is compared with the bill */
    await composer("what is the cart total");
    await sleep(200);
    await click("Send ↵");
    await sleep(4000);
    const costLine = await read("(() => { const m=document.body.innerText.match(/Cost of that turn[^\\n]{0,120}/); return m ? m[0] : ''; })()");
    check("F7 forecast and actual on the record", /forecast \$0\./.test(costLine) && /actual \$0\./.test(costLine) && /assuming \d+% cache hits/.test(costLine), costLine.slice(0, 110));

    /* F6 — tags, disk, and the matching line */
    await typeInto("name this session", "cart session");
    await typeInto("tags, comma, separated", "cart, money");
    await click("^save$");
    await sleep(1800);
    const disk = await (await hfetch("http://127.0.0.1:8787/lib")).json();
    check("F6 session and tags land on disk", (disk.sessions || []).some((x) => x.name === "cart session" && (x.tags || []).includes("money")), (disk.sessions || []).length + " sessions on disk");
    await click("^new$");
    await sleep(400);
    await click("open \\(");
    await sleep(400);
    await typeInto("search saved sessions", "total");
    await sleep(600);
    const row = await read("(() => { const b=[...document.querySelectorAll('button')].filter(x=>x.title==='open this session')[0]; return b ? b.innerText.replace(/\\n/g,' ') : ''; })()");
    check("F6 search shows the line it matched", /#cart #money/.test(row) && /what is the cart total/.test(row), row.slice(0, 112));

    /* F8 — both models, both bills */
    await composer("one question, two answers");
    await sleep(300);
    await click("compare flash vs pro");
    await sleep(4500);
    const cmpObj = await value("(() => { const t=document.body.innerText; return JSON.stringify({ both: /FLASH says this/.test(t) && /PRO says this/.test(t), money: (t.match(/\\$0\\.0000\\d\\d/g)||[]).length }); })()");
    check("F8 both answers side by side with a price each", cmpObj.both && cmpObj.money >= 2, "price figures on screen: " + cmpObj.money + ", models asked: " + [...new Set(seen.map((b) => b.model))].join("+"));

    /* F9 — pinned context in the cached prefix, and the meter */
    const before = seen.length;
    await composer("with the pin in place");
    await sleep(200);
    await click("Send ↵");
    await sleep(3500);
    const sys = (seen[seen.length - 1] || {}).messages?.[0]?.content || "";
    check("F9 the pin rides in the system message", sys.includes("PINNED: guardrails.md") && sys.includes("never log secrets"), (seen.length - before) + " call(s), system " + sys.length + " chars");
    check("A2 the pinned secret is scrubbed before it leaves", !sys.includes("hunter2hunter2") && /REDACTED/.test(sys), /REDACTED/.test(sys) ? "redaction marker present" : "redaction marker MISSING");
    check("A23 the build contract teaches the write-card format", sys.includes("### file: <path>"), sys.includes("### file:") ? "taught" : "NOT taught");
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

    /* A23 — a bold-filename reply still gets the write card */
    await composer("write to a file please");
    await sleep(200);
    await click("Send ↵");
    await sleep(4000);
    const wcard = await value("(() => { const t=document.body.innerText; return JSON.stringify({ card: /proposes writing 1 file/.test(t), name: /legacy\\.js/.test(t) }); })()");
    check("A23 the write card renders for the taught format", wcard.card && wcard.name, JSON.stringify(wcard));
    await click("^compare$");
    await sleep(1800);
    const wdiff = await value("(() => { const t=document.body.innerText; return JSON.stringify({ del: /− \\/\\/ old line 1/.test(t), add: /\\+ export const legacy/.test(t), nudge: /removes 25 lines/.test(t) }); })()");
    check("A4 the card shows a real diff and flags a big rewrite", wdiff.del && wdiff.add && wdiff.nudge, JSON.stringify(wdiff));

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
    await typeInto("name it, e.g. house style", "house style");
    await typeInto("the instruction text", "Short sentences. Name the file before each block.");
    await click("^keep$");
    await sleep(900);
    const kept = await (await hfetch("http://127.0.0.1:8787/lib")).json();
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
