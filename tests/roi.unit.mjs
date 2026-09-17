/* The daily-idea rules, checked without a browser and without spending anything.
   The rules are read straight out of the built page, so what ships is what runs here.

     node --test tests/roi.unit.mjs
*/
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const page = readFileSync(new URL("../dist/deepseek-api-console.html", import.meta.url), "utf8");
const block = page.match(/<script type="module" id="abyss-roi-engine">([\s\S]*?)<\/script>/);
assert.ok(block, "the abyss-roi-engine block is present in the built page");
(0, eval)(block[1]);
const R = globalThis.AbyRoi;
assert.ok(R, "globalThis.AbyRoi exists");

const PRICES = { "deepseek-flash": { miss: 0.15, hit: 0.003, out: 0.6 } };

/* A complete, arithmetically correct idea: 50,000 input at 90% hit + 4,000 output. */
const goodIdea = () => ({
  title: "Cache Sitter For Plumbers",
  pitch: "Watches a plumber's inbox and drafts replies. The shop pays per month, not per seat.",
  roi_math: "50,000 input at 90% hit costs (5000*0.15 + 45000*0.003)/1e6 = $0.000885, plus 4,000 output at $0.60/M = $0.0024, so $0.0033 a job against a $0.25 price.",
  build_steps: ["Pick the reply template", "Wrap it in a cached prefix", "Add a Stripe link", "Ship to one shop"],
  model_plan: "deepseek-flash with thinking off — this is formatting work, and thinking tokens bill as output.",
  cache_trick: "The template and the shop's tone rules are byte-identical every call, so only the customer note is fresh input.",
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
});

test("a fenced, valid answer is read", () => {
  const r = R.parseIdea("```json\n" + JSON.stringify(goodIdea()) + "\n```", "stop");
  assert.equal(r.ok, true);
  assert.equal(r.value.title, "Cache Sitter For Plumbers");
});

test("a cut-off answer is named as cut off, not 'broken json'", () => {
  const r = R.parseIdea('{"title":"Half An Idea","pitch":"it just stops', "length");
  assert.equal(r.ok, false);
  assert.match(r.error, /cut off/);
  assert.match(r.error, /allowance ran out/);
});

test("an empty answer is named as empty", () => {
  const r = R.parseIdea("", "length");
  assert.equal(r.ok, false);
  assert.match(r.error, /empty/);
});

test("a correct idea passes every check", () => {
  assert.deepEqual(R.validateIdea(goodIdea(), { usedKeys: [], prices: PRICES }), []);
});

test("wrong arithmetic is caught, and the message shows the right number", () => {
  const idea = goodIdea();
  idea.unit.cost_per_job_usd_offpeak = 0.5;
  const errs = R.validateIdea(idea, { usedKeys: [], prices: PRICES });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /cost_per_job_usd_offpeak/);
  assert.match(errs[0], /0\.003285/);
});

test("a repeated novelty_key is caught", () => {
  const errs = R.validateIdea(goodIdea(), { usedKeys: ["cache-sitter-plumbers"], prices: PRICES });
  assert.ok(errs.some((e) => /already used/.test(e)));
});

test("a missing field, a bad lever and a nonsense margin are all caught", () => {
  const idea = goodIdea();
  delete idea.cache_trick;
  idea.lever = "vibes";
  idea.unit.gross_margin = "12%";
  const errs = R.validateIdea(idea, { usedKeys: [], prices: PRICES });
  assert.ok(errs.some((e) => /missing field: cache_trick/.test(e)));
  assert.ok(errs.some((e) => /lever must be exactly one of/.test(e)));
  assert.ok(errs.some((e) => /gross_margin/.test(e)));
});

test("the third try is pro while pro is listed, and flash with thinking when it is not", () => {
  const withPro = R.resolveAttempts(["deepseek-flash", "deepseek-v4-pro"]);
  assert.equal(withPro.length, 3);
  assert.equal(withPro[0].model, "deepseek-flash");
  assert.equal(withPro[0].thinking, false, "thinking stays off for json work");
  assert.equal(withPro[2].model, "deepseek-v4-pro");

  const withoutPro = R.resolveAttempts(["deepseek-flash"]);
  assert.equal(withoutPro[2].model, "deepseek-flash");
  assert.equal(withoutPro[2].thinking, true, "no pro: fall back to flash with thinking on");
});

function fakeApi(answers) {
  const seen = [];
  return {
    seen,
    callApi: async (opts) => {
      seen.push(opts);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return { content: typeof next === "string" ? next : JSON.stringify(next), usage: { prompt_tokens: 10, completion_tokens: 5 }, finishReason: "stop" };
    },
  };
}

const engineFor = (answers) => {
  const api = fakeApi(answers);
  const engine = R.createRoiEngine({
    callApi: api.callApi,
    recordUsage: async () => ({ hit: 0, miss: 10, out: 5, cost: 0.0001 }),
    cheatsheet: "cheat sheet",
    today: () => "2026-09-16",
    locale: "America/Indiana/Indianapolis",
    prices: PRICES,
    modelIds: ["deepseek-flash", "deepseek-v4-pro"],
    excludeLines: () => ["2026-09-15 | old-idea | Old Idea"],
    usedKeys: () => ["old-idea"],
  });
  return { engine, api };
};

test("a good first answer is accepted after one call, with the contract in the prompt", async () => {
  const { engine, api } = engineFor([goodIdea()]);
  const res = await engine.generate();
  assert.equal(res.ok, true);
  assert.equal(res.attempts.length, 1);
  assert.equal(api.seen.length, 1);
  assert.equal(api.seen[0].thinking, false);
  assert.equal(api.seen[0].json, true);
  assert.match(api.seen[0].messages[0].content, /Return one single json object/);
  assert.match(api.seen[0].messages[1].content, /2026-09-15 \| old-idea \| Old Idea/);
});

test("a broken answer triggers one repair round, quoting the problem", async () => {
  const { engine, api } = engineFor(['{"title":"Cut off here', goodIdea()]);
  const res = await engine.generate();
  assert.equal(res.ok, true);
  assert.equal(res.attempts.length, 2);
  assert.equal(api.seen.length, 2);
  assert.match(api.seen[1].messages[3].content, /rejected by mechanical validation/);
  assert.equal(api.seen[1].messages[3].role, "user");
  assert.equal(api.seen[1].messages[2].role, "assistant");
});

test("two broken answers escalate to pro, and the run then succeeds", async () => {
  const { engine, api } = engineFor(['{"title":"Cut off', '{"title":"Also cut off', goodIdea()]);
  const res = await engine.generate();
  assert.equal(res.ok, true);
  assert.equal(res.attempts.length, 3);
  assert.equal(api.seen[2].model, "deepseek-v4-pro");
  assert.equal(api.seen[2].maxTokens, 6000);
});

test("three failures stop and hand back the raw text for the screen", async () => {
  const { engine, api } = engineFor(['{"title":"One', '{"title":"Two', '{"title":"Three']);
  const res = await engine.generate();
  assert.equal(res.ok, false);
  assert.equal(api.seen.length, 3, "never a fourth call");
  assert.match(res.raw, /Three/);
  assert.ok(res.attempts.every((a) => a.errors));
});

test("a transport failure does not burn the ladder", async () => {
  const { engine } = engineFor([new Error("HTTP 503"), goodIdea()]);
  const res = await engine.generate();
  assert.equal(res.ok, true);
  assert.equal(res.attempts[0].transportError, "HTTP 503");
});
