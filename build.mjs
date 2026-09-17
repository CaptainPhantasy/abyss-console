#!/usr/bin/env node
/* Rebuilds the single-file page from the readable pieces in src/.
 *
 *   node build.mjs              -> dist/deepseek-api-console.html
 *   node build.mjs --install    -> also writes ~/deepseek-api-console.html
 *   node build.mjs --check      -> only parse-checks the pieces, writes nothing
 *   node build.mjs --no-art     -> build without the whale picture (for reading tests)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
const args = new Set(process.argv.slice(2));

const shell = read("src/shell.template.html");
const engine = read("src/mcp-engine.js");
const roi = read("src/roi-engine.js");
const redact = read("src/redact.js");
const vendor = read("src/vendor.min.js");
const app = read("src/app.js");
const skin = read("src/skin.css");
const art = args.has("--no-art") ? "" : readFileSync(join(here, "assets/background.webp")).toString("base64");

for (const [name, text, needle] of [
  ["mcp-engine.js", engine, "</script"],
  ["roi-engine.js", roi, "</script"],
  ["redact.js", redact, "</script"],
  ["app.js", app, "</script"],
  ["vendor.min.js", vendor, "</script"],
  ["skin.css", skin, "</style"],
]) {
  if (text.includes(needle)) throw new Error(`${name} contains "${needle}" — that would end its block early`);
}

function parseCheck(name, code) {
  const f = join(tmpdir(), `abyss-check-${name.replace(/\W/g, "_")}.mjs`);
  writeFileSync(f, code);
  execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  return `${name} parses`;
}

if (args.has("--check")) {
  console.log(
    [
      parseCheck("roi-engine", roi),
      parseCheck("redact", redact),
      parseCheck("mcp-engine", engine),
      parseCheck("app", app),
      parseCheck("vendor", vendor),
    ].join("\n"),
  );
  process.exit(0);
}

const artCss = art ? `.abyss-art{background-image:url("data:image/webp;base64,${art}")}` : ".abyss-art{background:#060b14}";

let html = shell
  .replace("/*ART*/", () => `${skin}\n${artCss}`)
  .replace("/*ROI*/", () => roi)
  .replace("/*REDACT*/", () => redact)
  .replace("/*MCP*/", () => engine)
  .replace("/*BUNDLE*/", () => `${vendor}\n${app}`);

/* --api-base <url> points a test build at a local stand-in for DeepSeek. */
const apiBase = process.argv.indexOf("--api-base");
if (apiBase !== -1 && process.argv[apiBase + 1]) {
  const url = process.argv[apiBase + 1];
  const before = html;
  html = html.replace('const API_BASE = "https://api.deepseek.com"', `const API_BASE = ${JSON.stringify(url)}`);
  if (html === before) throw new Error("--api-base: could not find the API_BASE line");
  console.log(`api base overridden -> ${url}`);
}

mkdirSync(join(here, "dist"), { recursive: true });
const out = args.has("--api-base") ? join(here, "dist/test-page.html") : join(here, "dist/deepseek-api-console.html");
writeFileSync(out, html, "utf8");
console.log(`${out.replace(here + "/", "")}  ${(html.length / 1024).toFixed(0)} KB`);

if (args.has("--install")) {
  const dest = join(process.env.HOME, "deepseek-api-console.html");
  writeFileSync(dest, html, "utf8");
  console.log(`installed -> ${dest}`);
}
