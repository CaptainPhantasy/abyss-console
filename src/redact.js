/* ============================================================================
   Secret scrubber — everything that leaves the machine passes through here first.
   The page reads it as globalThis.AbyRedact; the tests read it straight out of
   the built page, so what ships is what is checked.
   ========================================================================== */
(() => {
  "use strict";

  const RULES = [
    { name: "deepseek-style key", re: /\bsk-[A-Za-z0-9_-]{16,}/g, swap: "sk-REDACTED" },
    { name: "aws access key", re: /\bAKIA[0-9A-Z]{16}\b/g, swap: "AKIA-REDACTED" },
    { name: "github token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, swap: "ghx-REDACTED" },
    { name: "slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, swap: "xoxb-REDACTED" },
    { name: "google api key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/g, swap: "AIza-REDACTED" },
    {
      name: "private key block",
      re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      swap: "-----BEGIN PRIVATE KEY-----REDACTED-----END PRIVATE KEY-----",
    },
    {
      name: "named secret",
      re: /\b(api[_-]?key|secret|password|passwd|token|authorization|bearer)\b(\s*[:=]\s*|\s+)["']?([A-Za-z0-9_\-./+=]{12,})/gi,
      swap: (_m, label, sep) => label + (sep || ": ") + "REDACTED",
    },
    {
      name: "connection string password",
      re: /\b([a-z]+:\/\/[^\s:@/]+):([^\s:@/]{6,})@/gi,
      swap: (_m, head) => head + ":REDACTED@",
    },
  ];

  /* Returns the text with every secret replaced, and a list of what was caught
     (kind and a masked sample only — never the secret itself). */
  function redact(text) {
    let out = String(text == null ? "" : text);
    const found = [];
    for (const rule of RULES) {
      out = out.replace(rule.re, (...args) => {
        const match = args[0];
        const masked = match.length <= 8 ? "…" : match.slice(0, 4) + "…" + match.slice(-2);
        found.push({ kind: rule.name, sample: masked, length: match.length });
        return typeof rule.swap === "function" ? rule.swap(...args) : rule.swap;
      });
    }
    return { text: out, found, count: found.length };
  }

  /* A short line for the screen: "2 secrets redacted (deepseek-style key, named secret)". */
  function summary(found) {
    if (!found || !found.length) return "";
    const kinds = [...new Set(found.map((f) => f.kind))];
    return (
      found.length +
      (found.length === 1 ? " secret" : " secrets") +
      " redacted before sending (" +
      kinds.join(", ") +
      ")"
    );
  }

  globalThis.AbyRedact = { RULES, redact, summary };
})();
