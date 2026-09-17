/* Writing, undoing and running, straight through the helper.

     node --test tests/files.e2e.mjs
*/
import { spawn } from "node:child_process";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = 8793;
const LAB = join(tmpdir(), "abyss-files-test");

let child = null;
const at = (p) => `http://127.0.0.1:${PORT}${p}`;
const post = async (p, body) => {
  const res = await fetch(at(p), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const get = async (p) => {
  const res = await fetch(at(p), { signal: AbortSignal.timeout(60000) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  mkdirSync(LAB, { recursive: true });
  child = spawn(process.execPath, [join(root, "abyss-bridge.mjs"), "--port", String(PORT), "--page", join(root, "dist/deepseek-api-console.html")], { stdio: ["ignore", "pipe", "pipe"] });
  const up = Date.now() + 15000;
  for (;;) {
    try {
      if ((await fetch(at("/health"), { signal: AbortSignal.timeout(3000) })).ok) return;
    } catch {}
    if (Date.now() > up) throw new Error("the helper did not start");
    await new Promise((r) => setTimeout(r, 300));
  }
});

after(() => {
  if (child) child.kill();
  try {
    rmSync(LAB, { recursive: true, force: true });
  } catch {}
});

test("writing a file keeps the old one, and undo puts it back", async () => {
  const target = join(LAB, "note.txt");
  writeFileSync(target, "the original text\n");
  const w = await post("/fs/write", { path: target, text: "the new text\n", why: "test" });
  assert.equal(w.status, 200);
  assert.equal(w.body.ok, true);
  assert.equal(w.body.existed, true);
  assert.equal(readFileSync(target, "utf8"), "the new text\n");

  const u = await post("/fs/undo", { path: target });
  assert.equal(u.body.ok, true);
  assert.equal(readFileSync(target, "utf8"), "the original text\n", "the original came back");
});

test("undoing a brand new file removes it again", async () => {
  const target = join(LAB, "created.txt");
  await post("/fs/write", { path: target, text: "hello\n" });
  assert.ok(existsSync(target));
  const u = await post("/fs/undo", { path: target });
  assert.equal(u.body.removedFile, true);
  assert.equal(existsSync(target), false, "the file it created is gone again");
});

test("the journal lists what was written, newest first", async () => {
  const { body } = await get("/fs/journal");
  assert.ok(body.count > 0);
  assert.ok(body.entries[0].at >= body.entries[body.entries.length - 1].at);
  assert.ok(body.entries.some((e) => e.path.endsWith("note.txt")));
});

test("a command runs only when the request says confirm", async () => {
  const refused = await post("/run", { cmd: "echo should-not-run" });
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /confirm/);

  const ran = await post("/run", { cmd: "echo hello && pwd", cwd: LAB, confirm: true });
  assert.equal(ran.body.ok, true);
  assert.equal(ran.body.code, 0);
  assert.match(ran.body.stdout, /hello/);
  assert.match(ran.body.stdout, /abyss-files-test/);
});

test("a failing command reports its code and its complaint", async () => {
  const r = await post("/run", { cmd: "printf 'boom: 3 checks failed\\n' >&2; exit 2", confirm: true });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.code, 2);
  assert.match(r.body.stderr, /boom: 3 checks failed/);
});

test("writing outside home, /tmp and the storage drives is refused", async () => {
  const r = await post("/fs/write", { path: "/etc/abyss-should-not-exist", text: "nope" });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /outside/);
});
