// ============================================================================
// E2E: Desktop Commander gate system — tests the EXACT engine shipped inside
// deepseek-api-console.html against a live mock MCP server (Streamable HTTP).
//
//   node tests/dc-gate.e2e.mjs
//
// Covers: risk classification, all four gates (PLAN / ASK ALWAYS / ASK WHEN
// NEEDED / YOLO), the approval queue (approve + deny + denyAll), the guarded
// execute pipeline over real HTTP, session-id propagation, result
// sanitization, unlisted-tool refusal, and fail-safe defaults.
// ============================================================================
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

/* ---- 1. Load the SHIPPED engine out of the HTML (no drift possible) ---- */
const html = readFileSync(new URL("../dist/deepseek-api-console.html", import.meta.url), "utf8");
const block = html.match(/<script type="module" id="dc-mcp-engine">([\s\S]*?)<\/script>/);
assert.ok(block, "engine <script id=dc-mcp-engine> present in HTML");
(0, eval)(block[1]); // indirect eval → global scope; engine attaches globalThis.DCEngine
const E = globalThis.DCEngine;
assert.ok(E, "globalThis.DCEngine exported");

/* ---- 2. Mock Desktop Commander MCP server (Streamable HTTP) ------------ */
const TOOL_DEFS = [
  { name: "read_file", description: "Read a file", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "write_file", description: "Write a file", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "execute_command", description: "Run a shell command", inputSchema: { type: "object", properties: { cmd: { type: "string" } } } },
];
const calls = [];           // every tools/call the server actually executed
let session = null;         // enforced session id — proves header propagation

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => {
    const path = new URL(req.url, "http://x").pathname;
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,mcp-session-id", "access-control-allow-methods": "POST,OPTIONS" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors).end(); return; }
    if (path !== "/mcp") { res.writeHead(404, cors).end("not found"); return; }
    let msg = null; try { msg = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch {}
    if (msg && msg.method === "initialize") {          // no session yet — handshake
      session = "sess-e2e-1";
      res.writeHead(200, { ...cors, "content-type": "application/json", "mcp-session-id": session });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock-dc", version: "1.0" } } }));
      return;
    }
    if (req.headers["mcp-session-id"] !== session) {   // every later call must carry it
      res.writeHead(400, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "missing/invalid Mcp-Session-Id" } }));
      return;
    }
    if (!msg.id) { res.writeHead(202, cors).end(); return; } // notifications/initialized
    if (msg.method === "tools/list") {
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOL_DEFS } }));
      return;
    }
    if (msg.method === "tools/call") {
      const { name, arguments: args } = msg.params;
      calls.push({ name, args });                      // EXECUTED — the thing gates guard
      const body = { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: toolText(name, args) }] } };
      res.writeHead(200, { ...cors, "content-type": "text/event-stream" }); // SSE reply → dual-format parser
      res.write("data: " + JSON.stringify(body) + "\n\n");
      res.end();
      return;
    }
    res.writeHead(404, cors).end();
  });
});
function toolText(name, args) {
  if (name === "read_file") return "FILE-CONTENT:" + "x".repeat(30000); // 30 KB → sanitization
  if (name === "write_file") return "Wrote " + String(args.content ?? "").length + " bytes to " + args.path;
  return "stdout: ok";
}
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

/* ---- 2b. Mock GEMINI bridge: WebSocket MCP behind a token gate ------ */
const WS_TOKEN = "tok-e2e-bridge";
const wsCalls = [];        // every tools/call executed over the WebSocket
let wsTokenSeen = undefined;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const wsAccept = k => createHash("sha1").update(k + WS_GUID).digest("base64");
function wsEncode(str) {
  const p = Buffer.from(str, "utf8"), n = p.length;
  let h;
  if (n < 126) h = Buffer.from([0x81, n]);
  else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(n, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([h, p]);
}
function wsDecode(buf) {
  const frames = []; let off = 0;
  while (off + 2 <= buf.length) {
    try {
      const op = buf[off] & 0x0f, masked = (buf[off + 1] & 0x80) !== 0;
      let len = buf[off + 1] & 0x7f, p = off + 2;
      if (len === 126) { len = buf.readUInt16BE(p); p += 2; }
      else if (len === 127) { len = Number(buf.readBigUInt64BE(p)); p += 8; }
      let mask = null;
      if (masked) { mask = buf.subarray(p, p + 4); p += 4; }
      const payload = Buffer.from(buf.subarray(p, p + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      frames.push({ op, text: payload.toString("utf8") });
      off = p + len;
    } catch { break; }
  }
  return frames;
}
const wsServer = createServer((req, res) => {         // plain-HTTP surface, like the real bridge
  if (req.method === "GET" && req.url.startsWith("/mcp")) { res.writeHead(400).end("Use WebSocket"); return; }
  res.writeHead(404).end("not found");
});
wsServer.on("upgrade", (req, socket) => {
  wsTokenSeen = new URL(req.url, "http://x").searchParams.get("token");
  if (wsTokenSeen !== WS_TOKEN) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + wsAccept(req.headers["sec-websocket-key"]) + "\r\n\r\n");
  const send = o => { try { socket.write(wsEncode(JSON.stringify(o))); } catch {} };
  let buf = Buffer.alloc(0);
  socket.on("data", d => {
    buf = Buffer.concat([buf, d]);
    for (const f of wsDecode(buf)) {
      if (f.op === 0x8) { try { socket.end(); } catch {} return; }
      if (f.op === 0x9) { socket.write(Buffer.from([0x8a, 0])); continue; }
      if (f.op !== 0x1) continue;
      let m = null; try { m = JSON.parse(f.text); } catch {}
      if (!m || !m.id) continue;                          // notifications ignored
      if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock-gemini-bridge", version: "1.0" } } });
      else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: TOOL_DEFS } });
      else if (m.method === "tools/call") { wsCalls.push({ name: m.params.name, args: m.params.arguments }); send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: toolText(m.params.name, m.params.arguments) }] } }); }
      else send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "unknown method" } });
    }
    buf = Buffer.alloc(0);
  });
  socket.on("error", () => {});
});
await new Promise(r => wsServer.listen(0, "127.0.0.1", r));
const wsBase = `http://127.0.0.1:${wsServer.address().port}`;
let pass = 0;
const ok = m => { pass++; console.log("  ✔", m); };

try {
  /* ---- 3. Risk taxonomy (fail-safe: unknown == risky) ----------------- */
  assert.equal(E.classifyRisk("read_file"), "safe");        ok("read_file → safe");
  assert.equal(E.classifyRisk("list_directory"), "safe");   ok("list_directory → safe");
  assert.equal(E.classifyRisk("write_file"), "risky");      ok("write_file → risky");
  assert.equal(E.classifyRisk("execute_command"), "risky"); ok("execute_command → risky");
  assert.equal(E.classifyRisk("totally_new_tool"), "unknown");ok("unknown tool → 'unknown' tier (gated as risky everywhere)");
  assert.equal(E.classifyRisk("delete_everything"), "risky");ok("risky-verb heuristic → risky");

  /* ---- 4. Pure gate decision matrix ----------------------------------- */
  const M = (g, t) => E.decide(g, t).exec;
  assert.equal(M("PLAN", "read_file"), "block");            ok("PLAN blocks reads");
  assert.equal(M("PLAN", "write_file"), "block");           ok("PLAN blocks writes");
  assert.equal(M("ASK ALWAYS", "read_file"), "ask");        ok("ASK ALWAYS asks on reads");
  assert.equal(M("ASK ALWAYS", "write_file"), "ask");       ok("ASK ALWAYS asks on writes");
  assert.equal(M("ASK WHEN NEEDED", "read_file"), "auto");  ok("ASK WHEN NEEDED auto-runs reads");
  assert.equal(M("ASK WHEN NEEDED", "write_file"), "ask");  ok("ASK WHEN NEEDED asks on writes");
  assert.equal(M("ASK WHEN NEEDED", "mystery_tool"), "ask");ok("ASK WHEN NEEDED asks on unknown");
  assert.equal(M("YOLO", "write_file"), "auto");            ok("YOLO auto-runs writes");
  assert.equal(M("YOLO", "mystery_tool"), "auto");          ok("YOLO auto-runs unknown");
  assert.equal(M("???", "read_file"), "block");             ok("unknown gate fails safe (block)");

  /* ---- 5. Connect over real HTTP -------------------------------------- */
  const snap = await E.connect(base);
  assert.equal(snap.status, "ready");                       ok("connect → ready (streamable HTTP)");
  assert.equal(snap.transport, "streamable-http");          ok("transport = streamable-http");
  assert.equal(snap.tools.length, 3);                       ok("tools/list discovered 3 tools");
  assert.ok(E.openAiTools().every(t => t.type === "function" && t.function.name && t.function.parameters));
  ok("openAiTools() shape valid for DeepSeek");

  /* ---- 6. PLAN: nothing ever reaches the server ----------------------- */
  calls.length = 0;
  const p1 = await E.runGuarded("PLAN", "write_file", { path: "/tmp/a", content: "x" });
  assert.equal(p1.status, "blocked");                       ok("PLAN runGuarded → blocked");
  assert.equal(calls.length, 0);                            ok("PLAN → zero tools/call on the wire");

  /* ---- 7. ASK ALWAYS: deny → no execution; approve → execution -------- */
  let job = E.runGuarded("ASK ALWAYS", "read_file", { path: "/tmp/x" });
  await new Promise(r => setTimeout(r, 25));
  let pend = E.pendingList();
  assert.equal(pend.length, 1);                             ok("ASK ALWAYS surfaces approval card");
  assert.equal(pend[0].name, "read_file");                  ok("approval shows tool name");
  assert.equal(pend[0].mode, "ASK ALWAYS");                 ok("approval shows gate mode");
  E.resolveApproval(pend[0].id, false);
  assert.equal((await job).status, "denied");               ok("deny → denied");
  assert.equal(calls.length, 0);                            ok("deny → zero tools/call on the wire");

  job = E.runGuarded("ASK ALWAYS", "read_file", { path: "/tmp/x" });
  await new Promise(r => setTimeout(r, 25));
  E.resolveApproval(E.pendingList()[0].id, true);
  const done = await job;
  assert.equal(done.status, "executed");                    ok("approve → executed");
  assert.equal(calls.length, 1);                            ok("approve → exactly one tools/call");
  assert.equal(calls[0].name, "read_file");                 ok("server received read_file");
  assert.ok(done.result.length <= 12100 && done.result.includes("[truncated"));
  ok("30 KB result sanitized to ≤12 K + truncation marker");

  /* ---- 8. ASK WHEN NEEDED: reads auto, commands gated ------------------ */
  calls.length = 0;
  const auto = await E.runGuarded("ASK WHEN NEEDED", "read_file", { path: "/tmp/y" });
  assert.equal(auto.status, "executed");                    ok("read auto-executes under ASK WHEN NEEDED");
  assert.equal(E.pendingList().length, 0);                  ok("…with no approval prompt");
  job = E.runGuarded("ASK WHEN NEEDED", "execute_command", { cmd: "rm -rf /" });
  await new Promise(r => setTimeout(r, 25));
  assert.equal(E.pendingList().length, 1);                  ok("execute_command triggers approval");
  assert.equal(calls.filter(c => c.name === "execute_command").length, 0);
  ok("command NOT sent before approval");
  E.denyAll();
  assert.equal((await job).status, "denied");               ok("denyAll() resolves pending as denied");

  /* ---- 9. YOLO: everything runs, nothing asks -------------------------- */
  calls.length = 0;
  const y1 = await E.runGuarded("YOLO", "write_file", { path: "/tmp/z", content: "data" });
  const y2 = await E.runGuarded("YOLO", "execute_command", { cmd: "echo hi" });
  assert.equal(y1.status, "executed");                      ok("YOLO executes write_file");
  assert.equal(y2.status, "executed");                      ok("YOLO executes execute_command");
  assert.equal(y2.result, "stdout: ok");                    ok("tool result round-trips");
  assert.equal(calls.length, 2);                            ok("two tools/call on the wire");
  assert.equal(E.pendingList().length, 0);                  ok("YOLO never prompts");

  /* ---- 10. Unlisted tool refused BEFORE any HTTP, even in YOLO --------- */
  const bad = await E.runGuarded("YOLO", "nuclear_launch", {});
  assert.equal(bad.status, "error");                        ok("unlisted tool → error");
  assert.match(bad.error, /not in tools\/list/);            ok("refusal reason = not in tools/list");
  assert.ok(!calls.some(c => c.name === "nuclear_launch"));
  ok("…and zero bytes reached the server");

  /* ---- 11. System-prompt contract exists for every gate ---------------- */
  for (const g of E.GATES) { assert.ok(E.contract(g).includes("Desktop Commander") && E.contract(g).length > 100); ok(`contract(gate=${g}) generated`); }

  /* ---- 12. GEMINI bridge: WebSocket transport behind token gate ------- */
  wsCalls.length = 0; wsTokenSeen = undefined;
  const wsn = await E.connect(wsBase, WS_TOKEN);
  assert.equal(wsn.status, "ready");                     ok("bridge connect(url, token) → ready");
  assert.equal(wsn.transport, "websocket");              ok("transport = websocket");
  assert.equal(wsn.tools.length, 3);                     ok("tools/list over WS discovered 3 tools");
  assert.equal(wsTokenSeen, WS_TOKEN);                   ok("token propagated as ?token= on the upgrade");
  assert.equal(E.openAiTools().length, 3);               ok("openAiTools() served from the WS session");

  wsCalls.length = 0;
  const w1 = await E.runGuarded("YOLO", "write_file", { path: "/tmp/w", content: "x" });
  assert.equal(w1.status, "executed");                   ok("YOLO write executed over WS");
  assert.equal(wsCalls.filter(c => c.name === "write_file").length, 1);
  ok("exactly one tools/call reached the bridge");
  job = E.runGuarded("ASK ALWAYS", "read_file", { path: "/tmp/x" });
  await new Promise(r => setTimeout(r, 25));
  E.resolveApproval(E.pendingList()[0].id, true);
  assert.equal((await job).status, "executed");          ok("approval → WS execution");

  /* ---- 13. Bad token → classified, not swallowed ---------------------- */
  await assert.rejects(E.connect(wsBase, "wrong-token"), /WS|fetch|HTTP/i);
  assert.equal(E.state().status, "error");
  assert.equal(E.state().lastReason.code, "bad-token");  ok("bad token → lastReason.code = bad-token");

  /* ---- 14. Tokenless connect to WS-only bridge → needs-token --------- */
  await assert.rejects(E.connect(wsBase));
  assert.equal(E.state().lastReason.code, "needs-token");ok("tokenless connect → needs-token (bridge speaks WS)");

  /* ---- 15. probe(): phased diagnostics, never silent ------------------ */
  assert.ok(typeof E.probe === "function" && typeof E.reasonFor === "function");
  ok("probe() + reasonFor() exported on DCEngine");
  const pDead = await E.probe("http://127.0.0.1:9", null);
  assert.equal(pDead.reachable, false);
  assert.equal(pDead.code, "server-down");               ok("probe dead port → server-down");
  assert.ok(pDead.advice.includes("launchctl"));        ok("server-down advice carries the launchctl start command");
  const pNoTok = await E.probe(wsBase, null);
  assert.equal(pNoTok.code, "needs-token");              ok("probe bridge without token → needs-token");
  assert.ok(pNoTok.phases.some(p => p.includes("Use WebSocket")));
  ok("probe saw the \"Use WebSocket\" signature on GET /mcp");
  const pBridge = await E.probe(wsBase, WS_TOKEN);
  assert.equal(pBridge.ok, true);
  assert.equal(pBridge.code, "ok");
  assert.equal(pBridge.transport, "websocket");
  assert.equal(pBridge.tools, 3);                        ok("probe bridge with token → ok (websocket, 3 tools)");
  assert.ok(pBridge.phases.some(p => p.includes("reachability") && p.includes("listening")));
  ok("probe reports the reachability phase verdict");
  const pHttp = await E.probe(base, null);
  assert.equal(pHttp.ok, true);
  assert.equal(pHttp.transport, "streamable-http");      ok("probe streamable server (no token) → ok via http ladder");

  console.log(`\nALL ${pass} E2E ASSERTIONS PASSED — gates hold: PLAN blocks, ASK ALWAYS prompts on ` +
              `everything, ASK WHEN NEEDED prompts only on risky/unknown, YOLO runs everything, ` +
              `unknown tools/gates fail safe, approvals deny-by-default, WS bridge + token ` +
              `classification works, and probe() explains every failure mode.`);
} catch (err) {
  console.error("\n✘ E2E FAILURE:", err.message);
  console.error(err.stack.split("\n").slice(0, 4).join("\n"));
  process.exitCode = 1;
} finally {
  server.close();
  wsServer.close();
  process.exit(process.exitCode || 0);
}
