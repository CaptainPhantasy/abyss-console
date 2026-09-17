/* The local helper, checked for real: it serves the page, onboards into the room,
   lists the servers, and completes one read-only tool call. No browser needed.

     node tests/helper.e2e.mjs
*/
import { spawn } from "node:child_process";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = 8791;

let child = null;
const at = (path) => `http://127.0.0.1:${PORT}${path}`;
const get = async (path, ms = 120000) => {
  const res = await fetch(at(path), { signal: AbortSignal.timeout(ms) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const post = async (path, payload, ms = 120000) => {
  const res = await fetch(at(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(ms),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  child = spawn(process.execPath, [join(root, "abyss-bridge.mjs"), "--port", String(PORT), "--page", join(root, "dist/deepseek-api-console.html")], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const up = Date.now() + 15000;
  for (;;) {
    try {
      const r = await fetch(at("/health"), { signal: AbortSignal.timeout(3000) });
      if (r.ok) return;
    } catch {}
    if (Date.now() > up) throw new Error("the helper did not start within 15 seconds");
    await new Promise((r) => setTimeout(r, 300));
  }
});

after(() => {
  if (child) child.kill();
});

test("it starts and reports where the page and the room bridge are", async () => {
  const { status, body } = await get("/health");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.harness, "abyss-webapp");
  assert.ok(body.pageExists, "the page file exists");
  assert.ok(body.roomBridgeExists, "your room bridge is installed");
  assert.equal(body.roomTools.length, 8, "the bridge offers its eight room tools");
});

test("it serves the page", async () => {
  const res = await fetch(at("/"));
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /id="abyss-roi-engine"/, "the real page came back");
  assert.match(html, /id="dc-mcp-engine"/);
});

test("it onboards into the room under its own name", async () => {
  const { status, body } = await get("/room/status");
  assert.equal(status, 200);
  assert.equal(body.harness, "abyss-webapp");
  assert.equal(body.connected, true, "the room accepted the caller: " + String(body.detail).slice(0, 200));
  assert.ok(/room OK/i.test(body.detail), "and ran its own connection test");
});

test("it pages through the room's server catalogue", async () => {
  const { status, body } = await get("/room/servers");
  assert.equal(status, 200);
  assert.ok(body.count > 10, `expected a real catalogue, got ${body.count}`);
  assert.ok(body.servers.every((s) => s.name), "every entry has a name");
  const cats = Object.keys(body.categories || {});
  assert.ok(cats.length >= 2, "servers arrive in categories");
});

test("a read-only tool call through /mcp reaches the room", async () => {
  const init = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
  assert.equal(init.body.result.serverInfo.name, "abyss-bridge");

  const list = await post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(list.body.result.tools.length, 8);

  const call = await post("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "room_status", arguments: {} } });
  const text = (call.body.result.content || []).map((c) => c.text).join("\n");
  assert.match(text, /room OK/i, "the room answered: " + text.slice(0, 160));
});

test("it reads and searches this disk", async () => {
  const read = await get("/fs/read?path=" + encodeURIComponent(join(root, "README.md")));
  assert.equal(read.status, 200);
  assert.match(read.body.text, /abyss-console/, "the readme came back");

  const search = await get("/fs/search?path=" + encodeURIComponent(root) + "&q=abyss-bridge");
  assert.equal(search.status, 200);
  assert.ok(search.body.count > 0, "the search found the helper's own name somewhere in the project");
});

test("it refuses a path outside home and the storage drives", async () => {
  const { status, body } = await get("/fs/read?path=" + encodeURIComponent("/etc/hosts"));
  assert.equal(status, 403);
  assert.match(body.error, /outside/);
});
