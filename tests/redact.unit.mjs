/* The secret scrubber, read straight out of the built page.

     node --test tests/redact.unit.mjs
*/
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const page = readFileSync(new URL("../dist/deepseek-api-console.html", import.meta.url), "utf8");
const block = page.match(/<script type="module" id="abyss-redact">([\s\S]*?)<\/script>/);
assert.ok(block, "the abyss-redact block is in the built page");
(0, eval)(block[1]);
const R = globalThis.AbyRedact;
assert.ok(R, "globalThis.AbyRedact exists");

test("a deepseek-style key never leaves", () => {
  const out = R.redact("my key is sk-abcdef0123456789abcdef please keep it");
  assert.ok(!/sk-abcdef0123456789abcdef/.test(out.text));
  assert.match(out.text, /sk-REDACTED/);
  assert.equal(out.count, 1);
  assert.equal(out.found[0].kind, "deepseek-style key");
});

test("the sample in the report is masked, never the secret itself", () => {
  const out = R.redact("sk-abcdef0123456789abcdef");
  assert.ok(!/abcdef0123456789/.test(out.found[0].sample), "the sample must not contain the secret");
});

test("github, slack, google and aws tokens are caught", () => {
  const cases = [
    ["ghp_" + "a".repeat(30), "github token"],
    ["xoxb-1234567890-abcdefghij", "slack token"],
    ["AIza" + "b".repeat(35), "google api key"],
    ["AKIA" + "C".repeat(16), "aws access key"],
  ];
  for (const [secret, kind] of cases) {
    const out = R.redact("token " + secret + " end");
    assert.ok(!out.text.includes(secret), kind + " should be gone");
    assert.ok(out.found.some((f) => f.kind === kind), kind + " should be named");
  }
});

test("private key blocks are swallowed whole", () => {
  // spelled in two parts: a committed line must not carry the full marker shape
  const pem = "-----BEGIN " + "RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nnotarealkey\n-----END RSA PRIVATE KEY-----";
  const out = R.redact("here:\n" + pem + "\ndone");
  assert.ok(!/MIIEowIBAAKCAQEA/.test(out.text));
  assert.match(out.text, /REDACTED/);
  assert.ok(out.found.some((f) => f.kind === "private key block"));
});

test("passwords written the ordinary ways are caught", () => {
  for (const line of [
    "password=hunter2hunter2",
    "api_key: 9f8e7d6c5b4a", // gitleaks:allow (fake fixture for the scrubber test)
    "TOKEN = abcdef123456", // gitleaks:allow (fake fixture for the scrubber test)
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9',
  ]) {
    const out = R.redact(line);
    assert.ok(!/hunter2hunter2|9f8e7d6c5b4a|abcdef123456|eyJhbGciOiJIUzI1NiJ9/.test(out.text), line + " → " + out.text);
    assert.ok(out.count >= 1, line);
  }
});

test("a password inside a connection string goes", () => {
  const out = R.redact("postgres://admin:s3cr3tp4ss@db.internal:5432/app");
  assert.ok(!/s3cr3tp4ss/.test(out.text));
  assert.match(out.text, /postgres:\/\/admin:REDACTED@db\.internal/);
});

test("ordinary writing is left exactly alone", () => {
  const text = "The cache hit price is $0.003 per million and the peak window starts at 01:00 UTC. Nothing secret here.";
  const out = R.redact(text);
  assert.equal(out.text, text);
  assert.equal(out.count, 0);
});

test("the summary names what was caught without repeating it", () => {
  const out = R.redact("sk-abcdef0123456789abcdef and password=hunter2hunter2");
  const line = R.summary(out.found);
  assert.match(line, /2 secrets redacted before sending/);
  assert.ok(!/abcdef0123456789/.test(line), "the summary must not leak the value");
  assert.ok(!/hunter2hunter2/.test(line));
});
