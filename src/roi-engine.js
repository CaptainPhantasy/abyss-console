/* ============================================================================
   Daily ROI rules — the whole idea-making job lives in this one block.
   The page reads it as globalThis.AbyRoi, and the tests read it straight out of
   the built page, so what ships is what gets tested.

   The shape of a run (bounded at three calls, never more):
     1. deepseek-flash, private thinking off, warm temperature — first pass
     2. deepseek-flash, same conversation, the exact problems quoted back
     3. deepseek-v4-pro (only while it is listed), same conversation
   A failed attempt is never saved as an idea.
   ========================================================================== */
(() => {
  "use strict";

  const LEVERS = [
    "cache_hit_ratio",
    "off_peak_timing",
    "thinking_token_suppression",
    "context_stuffing",
    "input_output_asymmetry",
    "image_input",
    "tool_loop_replay",
    "concurrency",
  ];

  const SYSTEM_CONTRACT = [
    "You generate the Daily ROI for the ABYSS console: exactly one novel, buildable project per day that makes money by exploiting DeepSeek's price physics. One idea, every day, never a repeat.",
    "",
    "HARD CONSTRAINTS",
    '1. Buildable by one person in a weekend on the DeepSeek API alone (https://api.deepseek.com, OpenAI-compatible POST /chat/completions, one sk- key). No other AI vendor in the money-making path.',
    '2. The margin must come from a named DeepSeek price mechanic, not from "AI is cheap now".',
    "3. Never reuse or lightly reskin an idea, a title pattern, or a novelty_key from the EXCLUDE list.",
    "",
    "PRICE FACTS YOU MAY CITE (USD per 1M tokens, off-peak; peak hours bill exactly 2x)",
    "- deepseek-flash: input miss $0.15, input hit $0.003 (a cache hit costs 1/50 of a miss), output $0.60.",
    "- deepseek-v4-pro: input miss $0.66, input hit $0.022, output $1.98.",
    "- Peak = 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday only. Every weekend and every other hour is off-peak.",
    "- Thinking (reasoning) tokens bill as OUTPUT and are invisible in the answer text; keep them off for extraction and formatting.",
    "- The prefix cache is automatic, byte-exact and best-effort: static content first, variable content last, never a timestamp near the top.",
    "- 5M free tokens per new account. There is no batch-discount tier; the prefix cache IS the discount.",
    "- deepseek-flash accepts images natively and bills them as input tokens (about 1024 per image, maximum).",
    "",
    "OUTPUT CONTRACT",
    "Return one single json object. No markdown fence. No sentence before it. No sentence after it. No comments. No trailing commas.",
    "Shape (example only, do not copy the values):",
    '{"title":"...","pitch":"...","roi_math":"...","build_steps":["..."],"model_plan":"...","cache_trick":"...","novelty_key":"kebab-case-key","lever":"cache_hit_ratio","unit":{"input_tokens_per_job":0,"output_tokens_per_job":0,"cache_hit_ratio":0.9,"cost_per_job_usd_offpeak":0.0,"price_to_customer_usd":0.0,"gross_margin":"00%"}}',
    "",
    "FIELD RULES",
    '- title: 6 words or fewer, concrete, no "AI-powered", no "revolutionary".',
    "- pitch: one or two plain sentences: what it does and who pays for it.",
    "- roi_math: the arithmetic with the real numbers above. If you cannot show the arithmetic, choose a different idea.",
    "- build_steps: 4 to 8 ordered steps, each a concrete action.",
    "- model_plan: which model, thinking on or off, and why.",
    "- cache_trick: how this design keeps a byte-identical prefix and farms the $0.003 hit price.",
    "- novelty_key: 2 to 4 kebab-case words a later run can dedupe on.",
    "- lever: exactly one of " + LEVERS.join(", ") + ".",
    "- unit.input_tokens_per_job and unit.output_tokens_per_job: positive integers for ONE unit of delivered work.",
    "- unit.cache_hit_ratio: a number from 0 to 1 — the fraction of input tokens billed at the hit price.",
    "- unit.cost_per_job_usd_offpeak: must equal (input*(1-hit)*0.15 + input*hit*0.003 + output*0.60)/1000000 using deepseek-flash prices. It is checked by code; a wrong number rejects the whole json.",
    "- unit.price_to_customer_usd: a number greater than that cost.",
    '- unit.gross_margin: whole-percent string such as "94%", equal to (price - cost) / price.',
    "",
    "QUALITY BAR",
    "Reject your own idea and pick another if someone who has never read the DeepSeek pricing page could have written it.",
  ].join("\n");

  function buildUserPrompt({ excludeLines, dateStr, locale }) {
    return [
      "Generate today's Daily ROI as one json object, per the contract in the system message. Nothing else.",
      "",
      "EXCLUDE — never repeat, paraphrase, or lightly reskin these; oldest first:",
      excludeLines && excludeLines.length ? excludeLines.join("\n") : "(none yet — this is the first run)",
      "",
      "today: " + dateStr,
      "locale: " + locale,
      "novelty_key must not collide with any key above.",
      "Output the json object now.",
    ].join("\n");
  }

  function repairPrompt(errors) {
    return [
      "Your previous json was rejected by mechanical validation:",
      ...errors.slice(0, 6).map((e) => "- " + e),
      "",
      "Fix exactly those problems and return the corrected json object. Same contract, nothing else.",
    ].join("\n");
  }

  /* Read whatever came back. Fences stripped, braces balanced, and an empty or
     cut-off answer named as such instead of "broken JSON". */
  function parseIdea(raw, finishReason) {
    if (typeof raw !== "string" || raw.trim() === "") {
      return { ok: false, error: "the answer came back empty (finish_reason=" + (finishReason || "?") + ")" };
    }
    const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = t.indexOf("{");
    if (start < 0) return { ok: false, error: "no json object in the answer" };
    let depth = 0,
      end = -1,
      inStr = false,
      esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t.charAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) {
      return {
        ok: false,
        error:
          "the json was cut off before its closing brace (finish_reason=" +
          (finishReason || "?") +
          ")" +
          (finishReason === "length" ? " — the answer allowance ran out" : ""),
      };
    }
    try {
      return { ok: true, value: JSON.parse(t.slice(start, end + 1)) };
    } catch (e) {
      return { ok: false, error: "the json would not parse: " + e.message };
    }
  }

  const isObj = (o) => o && typeof o === "object" && !Array.isArray(o);
  const isNear = (a, b, slack) => Math.abs(a - b) <= Math.max(1e-9, slack);

  function validateIdea(obj, { usedKeys = [], prices } = {}) {
    const e = [];
    if (!isObj(obj)) return ["the answer is not a json object"];
    const flash = (prices && prices["deepseek-flash"]) || { miss: 0.15, hit: 0.003, out: 0.6 };

    ["title", "pitch", "roi_math", "build_steps", "model_plan", "cache_trick", "novelty_key", "lever", "unit"].forEach((k) => {
      if (!(k in obj)) e.push("missing field: " + k);
    });
    if (typeof obj.title !== "string" || obj.title.trim().split(/\s+/).length > 6)
      e.push("title must be a short string of 6 words or fewer");
    if (typeof obj.pitch !== "string" || obj.pitch.length < 40) e.push("pitch must be one or two full sentences");
    if (typeof obj.roi_math !== "string" || obj.roi_math.length < 40) e.push("roi_math must show the arithmetic");
    if (typeof obj.cache_trick !== "string" || obj.cache_trick.length < 15) e.push("cache_trick is too short");
    if (typeof obj.model_plan !== "string" || obj.model_plan.length < 10) e.push("model_plan is too short");
    if (!Array.isArray(obj.build_steps) || obj.build_steps.length < 4 || obj.build_steps.length > 8)
      e.push("build_steps must be an array of 4 to 8 steps");
    if (LEVERS.indexOf(obj.lever) === -1) e.push("lever must be exactly one of: " + LEVERS.join(", "));

    if (typeof obj.novelty_key !== "string" || !/^[a-z0-9]+(-[a-z0-9]+){1,3}$/.test(obj.novelty_key)) {
      e.push("novelty_key must be 2 to 4 kebab-case words, for example cache-sitter");
    } else if (usedKeys.indexOf(obj.novelty_key) !== -1) {
      e.push('novelty_key "' + obj.novelty_key + '" was already used on a previous day; pick a different idea');
    }

    const u = obj.unit;
    if (!isObj(u)) {
      e.push("unit must be an object with the cost arithmetic");
      return e;
    }
    const inTok = u.input_tokens_per_job,
      outTok = u.output_tokens_per_job,
      hit = u.cache_hit_ratio;
    if (!Number.isInteger(inTok) || inTok <= 0) e.push("unit.input_tokens_per_job must be a positive whole number");
    if (!Number.isInteger(outTok) || outTok <= 0) e.push("unit.output_tokens_per_job must be a positive whole number");
    if (typeof hit !== "number" || hit < 0 || hit > 1) e.push("unit.cache_hit_ratio must be a number from 0 to 1");
    if (
      e.some(
        (x) =>
          x.startsWith("unit.input_tokens_per_job") ||
          x.startsWith("unit.output_tokens_per_job") ||
          x.startsWith("unit.cache_hit_ratio"),
      )
    )
      return e;

    const expected = (inTok * (1 - hit) * flash.miss + inTok * hit * flash.hit + outTok * flash.out) / 1e6;
    const claimed = u.cost_per_job_usd_offpeak;
    if (typeof claimed !== "number") {
      e.push("unit.cost_per_job_usd_offpeak must be a number");
    } else if (!isNear(claimed, expected, 0.05 * expected)) {
      e.push(
        "unit.cost_per_job_usd_offpeak is " +
          claimed +
          "; the arithmetic gives " +
          expected.toFixed(8) +
          " for " +
          inTok +
          " input at " +
          Math.round(hit * 100) +
          "% cache hit plus " +
          outTok +
          " output on deepseek-flash off-peak ($0.15 miss / $0.003 hit / $0.60 out per 1M)",
      );
    }

    const price = u.price_to_customer_usd;
    if (typeof price !== "number" || price <= expected) {
      e.push("unit.price_to_customer_usd must be a number greater than the " + expected.toFixed(8) + " cost");
    }
    const gm = u.gross_margin;
    if (typeof gm !== "string" || !/^\d{1,3}%$/.test(gm)) {
      e.push('unit.gross_margin must be a whole-percent string such as "94%"');
    } else if (typeof price === "number" && price > 0) {
      const want = ((price - expected) / price) * 100;
      if (Math.abs(parseInt(gm, 10) - want) > 5)
        e.push("unit.gross_margin " + gm + " disagrees with the price and cost; it should be about " + want.toFixed(0) + "%");
    }
    return e;
  }

  /* Which models to try, in order. Pro only while the live list still offers it. */
  function resolveAttempts(modelIds) {
    const ids = Array.isArray(modelIds) ? modelIds : [];
    const hasPro = ids.length === 0 ? true : ids.indexOf("deepseek-v4-pro") !== -1;
    const first = { model: "deepseek-flash", temperature: 1.25, maxTokens: 4000, thinking: false, note: "flash, first pass" };
    const second = { ...first, temperature: 0.4, note: "flash retry, problems quoted back" };
    const third = hasPro
      ? { model: "deepseek-v4-pro", temperature: 0.9, maxTokens: 6000, thinking: false, note: "escalated to v4-pro" }
      : { model: "deepseek-flash", temperature: 0.8, maxTokens: 6000, thinking: true, effort: "high", note: "flash again, thinking on" };
    return [first, second, third];
  }

  function createRoiEngine(deps) {
    const { callApi, recordUsage, cheatsheet, today, locale, prices, modelIds } = deps;

    async function generate() {
      const dateStr = today();
      const messages = [
        { role: "system", content: cheatsheet + "\n\n" + SYSTEM_CONTRACT },
        { role: "user", content: buildUserPrompt({ excludeLines: deps.excludeLines(), dateStr, locale }) },
      ];
      const usedKeys = deps.usedKeys ? deps.usedKeys() : [];
      const attempts = resolveAttempts(modelIds);
      const log = [];
      let spent = 0;
      let raw = "";

      for (let i = 0; i < attempts.length; i++) {
        const a = attempts[i];
        if (deps.onStatus) deps.onStatus("attempt " + (i + 1) + " of 3 — " + a.note + "…");
        let r;
        try {
          r = await callApi({
            model: a.model,
            messages,
            thinking: a.thinking,
            effort: a.effort,
            temperature: a.temperature,
            maxTokens: a.maxTokens,
            json: true,
            onDelta: () => {},
          });
        } catch (err) {
          const msg = String((err && err.message) || err);
          log.push({ note: a.note, model: a.model, transportError: msg });
          messages.push({
            role: "user",
            content: "The previous attempt failed in transport: " + msg + "\nReturn the same json object again.",
          });
          continue;
        }
        const usage = await recordUsage(a.model, r.usage);
        spent += (usage && usage.cost) || 0;
        raw = r.content || "";

        const parsed = parseIdea(raw, r.finishReason);
        const errs = parsed.ok ? validateIdea(parsed.value, { usedKeys, prices }) : [parsed.error];
        log.push({ note: a.note, model: a.model, finish: r.finishReason, usage: r.usage, errors: errs.length ? errs : null, raw });

        if (parsed.ok && errs.length === 0) return { ok: true, idea: parsed.value, attempts: log, cost: spent };
        messages.push({ role: "assistant", content: raw });
        messages.push({ role: "user", content: repairPrompt(errs) });
      }
      return { ok: false, error: "all 3 attempts failed — the last answer is shown below", attempts: log, cost: spent, raw };
    }

    return { generate };
  }

  globalThis.AbyRoi = {
    LEVERS,
    SYSTEM_CONTRACT,
    buildUserPrompt,
    repairPrompt,
    parseIdea,
    validateIdea,
    resolveAttempts,
    createRoiEngine,
  };
})();
