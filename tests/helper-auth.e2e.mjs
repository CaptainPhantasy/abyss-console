/* The helper's door, proven: the per-install token and the origin allowlist.
   Spawns its own helper on 8792 with its own token file, so the real one is untouched.

     node --test tests/helper-auth.e2e.mjs
*/
import { spawn } from "node:child_process";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, rmSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = 8792;
const AUTH = "/tmp/abyss-helper-auth-token";

let child = null;
let token = "";
const at = (path) => `http://127.0.0.1:${PORT}${path}`;
const call = async (path, { method = "GET", body, headers = {}, origin, ms = 60000 } = {}) => {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (origin) h.origin = origin;
  const res = await fetch(at(path), {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  return { status: res.status, text: await res.text(), headers: res.headers };
};
const json = (r) => {
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
};

before(async () => {
  try {
    rmSync(AUTH, { force: true });
  } catch {}
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
  assert.equal(token.length, 64, "a 32-byte token was generated on first start");
});

after(() => {
  if (child) child.kill();
});

test("/health stays open and names the token requirement", async () => {
  const r = await call("/health");
  assert.equal(r.status, 200);
  assert.equal(json(r).tokenRequired, true);
});

test("the served page carries the token; the page on disk never does", async () => {
  const served = await call("/");
  assert.equal(served.status, 200);
  assert.ok(served.text.includes(JSON.stringify(token)), "the served copy has the token injected");
  const disk = readFileSync(join(root, "dist/deepseek-api-console.html"), "utf8");
  assert.ok(!disk.includes(token), "the file on disk does not carry the token value");
});

test("a privileged route without the token is refused", async () => {
  const r = await call("/run", { method: "POST", body: { cmd: "echo should-not-run", confirm: true } });
  assert.equal(r.status, 403);
  assert.match(json(r).error, /token/i);
});

test("a wrong token is refused", async () => {
  const r = await call("/run", {
    method: "POST",
    body: { cmd: "echo should-not-run", confirm: true },
    headers: { "x-abyss-token": "0".repeat(64) },
  });
  assert.equal(r.status, 403);
});

test("the original exploit shape — a foreign origin, confirm:true — is refused", async () => {
  const r = await call("/run", {
    method: "POST",
    body: { cmd: "echo should-not-run", confirm: true },
    origin: "https://evil.example",
  });
  assert.equal(r.status, 403);
  assert.match(json(r).error, /origin/i);
});

test("a foreign origin is refused even with the right token", async () => {
  const r = await call("/fs/read?path=" + encodeURIComponent(join(root, "README.md")), {
    headers: { "x-abyss-token": token },
    origin: "https://evil.example",
  });
  assert.equal(r.status, 403);
  assert.match(json(r).error, /origin/i);
});

test("preflight from a foreign origin is not allowed", async () => {
  const r = await call("/run", { method: "OPTIONS", origin: "https://evil.example" });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), null, "no allow-origin for strangers");
});

test("preflight from loopback is allowed", async () => {
  const r = await call("/run", { method: "OPTIONS", origin: "http://127.0.0.1:" + PORT });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("with the token, a command runs", async () => {
  const r = await call("/run", {
    method: "POST",
    body: { cmd: "node -e \"console.log('abyss-auth-ok')\"", confirm: true },
    headers: { "x-abyss-token": token },
  });
  assert.equal(r.status, 200);
  const b = json(r);
  assert.equal(b.ok, true);
  assert.match(b.stdout, /abyss-auth-ok/);
});

test("with the token, a disk read works (the served page's own path)", async () => {
  const r = await call("/fs/read?path=" + encodeURIComponent(join(root, "README.md")), {
    headers: { "x-abyss-token": token },
  });
  assert.equal(r.status, 200);
  assert.match(json(r).text, /abyss-console/);
});
