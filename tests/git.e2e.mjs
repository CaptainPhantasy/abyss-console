/* Git through the helper's door: status, diff, stage and commit against a scratch
   repository, token gate included. No browser.

     node --test tests/git.e2e.mjs
*/
import { spawn, execFileSync } from "node:child_process";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = 8790;
const REPO = mkdtempSync(join(tmpdir(), "abyss-git-repo-"));
const AUTH = join(mkdtempSync(join(tmpdir(), "abyss-git-lab-")), "token");

const at = (path) => `http://127.0.0.1:${PORT}${path}`;
const hdr = () => (token ? { "x-abyss-token": token } : {});

let child = null;
let token = "";

const get = async (path) => {
  const res = await fetch(at(path), { headers: hdr(), signal: AbortSignal.timeout(15000) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const post = async (path, payload) => {
  const res = await fetch(at(path), {
    method: "POST",
    headers: { "content-type": "application/json", ...hdr() },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  execFileSync("git", ["-C", REPO, "init", "-q"]);
  execFileSync("git", ["-C", REPO, "config", "user.email", "abyss-test@example.invalid"]);
  execFileSync("git", ["-C", REPO, "config", "user.name", "Abyss Test"]);
  writeFileSync(join(REPO, "app.js"), "export const v = 1;\n");
  execFileSync("git", ["-C", REPO, "add", "-A"]);
  execFileSync("git", ["-C", REPO, "commit", "-q", "-m", "initial", "--no-verify"]);

  child = spawn(process.execPath, [join(root, "abyss-bridge.mjs"), "--port", String(PORT), "--page", join(root, "dist/deepseek-api-console.html")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ABYSS_TOKEN_FILE: AUTH },
  });
  const up = Date.now() + 15000;
  for (;;) {
    try {
      const r = await fetch(at("/health"), { signal: AbortSignal.timeout(3000) });
      if (r.ok) break;
    } catch {}
    if (Date.now() > up) throw new Error("the helper did not start within 15 seconds");
    await new Promise((r) => setTimeout(r, 300));
  }
  token = readFileSync(AUTH, "utf8").trim();
  assert.ok(token.length >= 32, "the helper generated its token");
});

after(() => {
  if (child) child.kill();
});

test("the git routes need the token like every other door", async () => {
  const bare = await fetch(at("/git/status?path=" + encodeURIComponent(REPO)), { signal: AbortSignal.timeout(5000) });
  assert.equal(bare.status, 403);
});

test("status names the branch and a clean tree", async () => {
  const { status, body } = await get("/git/status?path=" + encodeURIComponent(REPO));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.clean, true);
  assert.ok(body.branch && !body.branch.startsWith("("), "branch: " + body.branch);
  assert.match(body.head, /^[0-9a-f]{7,}$/);
});

test("an untracked file shows up in the change list", async () => {
  writeFileSync(join(REPO, "new.js"), "export const n = 2;\n");
  const { body } = await get("/git/status?path=" + encodeURIComponent(REPO));
  assert.equal(body.clean, false);
  const row = body.changed.find((c) => c.path === "new.js");
  assert.ok(row, "new.js in " + JSON.stringify(body.changed));
  assert.equal(row.xy, "??");
});

test("diff vs HEAD shows what changed in a tracked file", async () => {
  writeFileSync(join(REPO, "app.js"), "export const v = 2;\n");
  const { body } = await get("/git/diff?path=" + encodeURIComponent(REPO) + "&file=app.js");
  assert.equal(body.ok, true);
  assert.match(body.text, /-export const v = 1;/);
  assert.match(body.text, /\+export const v = 2;/);
});

test("a folder outside a work tree says so instead of failing", async () => {
  const { body } = await get("/git/status?path=" + encodeURIComponent(tmpdir()));
  assert.equal(body.ok, false);
  assert.match(body.error, /work tree/);
});

test("staging without confirm is refused", async () => {
  const { status } = await post("/git/stage", { path: REPO, files: ["new.js"] });
  assert.equal(status, 403);
});

test("staging with confirm works, and a commit lands", async () => {
  const staged = await post("/git/stage", { path: REPO, files: ["new.js"], confirm: true });
  assert.equal(staged.body.ok, true);
  const after = await get("/git/status?path=" + encodeURIComponent(REPO));
  const row = after.body.changed.find((c) => c.path === "new.js");
  assert.equal(row.xy, "A ");

  const noMessage = await post("/git/commit", { path: REPO, confirm: true });
  assert.equal(noMessage.status, 400);

  const commit = await post("/git/commit", { path: REPO, message: "add new.js from the git lane", confirm: true });
  assert.equal(commit.body.ok, true, JSON.stringify(commit.body));
  assert.match(commit.body.hash, /^[0-9a-f]{7,}$/);

  const final = await get("/git/status?path=" + encodeURIComponent(REPO));
  assert.equal(final.body.changed.find((c) => c.path === "new.js"), undefined, "the committed file leaves the list");
  assert.ok(final.body.changed.find((c) => c.path === "app.js"), "the still-modified tracked file stays listed");
});
