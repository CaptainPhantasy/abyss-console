#!/usr/bin/env node
/* abyss-bridge — the small local helper for the ABYSS page.
 *
 * A web page cannot do three things this page needs: reach the MCP room (the room
 * refuses browser origins with its own 403), read files off this disk in bulk, or run
 * a command. This one file does those, and nothing else.
 *
 *   node abyss-bridge.mjs                 # serve the page on http://127.0.0.1:8787
 *   node abyss-bridge.mjs --port 8788     # a different port
 *   node abyss-bridge.mjs --page /path/to/deepseek-api-console.html
 *
 * What it serves:
 *   GET  /                     the page itself
 *   GET  /health               is the helper up, is the room reachable, how many servers
 *   GET  /room/servers         the room's server list as plain json
 *   POST /room/call            { server, tool, arguments } — one room tool call
 *   POST /mcp                  a plain MCP endpoint, so the page's own gate system works
 *   GET  /fs/tree?path=…       a folder listing (names, sizes, whether it is text)
 *   GET  /fs/read?path=…       one file, with a size cap
 *   GET  /fs/search?path=…&q=… plain-text search across a folder
 *
 * The room is reached through your existing room bridge (stdio; ROOM_BRIDGE overrides
 * the path), which does the room's own onboarding steps and caches its token. This
 * helper names itself `abyss-webapp` in the room's ledger.
 *
 * Security: every route except the page itself and /health requires the per-install
 * token (header x-abyss-token). It is generated once into ~/.abyss-console/token
 * (ABYSS_TOKEN_FILE overrides) and injected only into the page this helper serves;
 * browser requests from other origins are refused, preflight included.
 */
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, copyFileSync, existsSync, statSync, readdirSync, realpathSync, mkdirSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve, extname, basename, dirname } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PORT = Number(flag("--port", process.env.ABYSS_BRIDGE_PORT || 8787));
const PAGE = resolve(flag("--page", join(homedir(), "deepseek-api-console.html")));
const BRIDGE = process.env.ROOM_BRIDGE || join(homedir(), ".local/share/floyd/mcp-servers/floyd-room-bridge/index.mjs");
const HARNESS = process.env.ROOM_HARNESS || "abyss-webapp";
const TOKEN_FILE = process.env.ROOM_TOKEN_FILE || join(homedir(), ".local/share/floyd/room-onboarding-abyss.json");
const AUTH_FILE = process.env.ABYSS_TOKEN_FILE || join(homedir(), ".abyss-console", "token");
const HOME = homedir();
/* The per-install token. Generated once, kept 0600, and injected only into the copy
   of the page this helper serves. Every route except / and /health demands it, so a
   page from any other origin cannot read this disk, run commands, or reach the room. */
const HELPER_TOKEN = (() => {
  try {
    const t = readFileSync(AUTH_FILE, "utf8").trim();
    if (t.length >= 16) return t;
    throw new Error("the existing helper token is invalid; refusing to replace it");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const t = randomBytes(32).toString("hex");
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  writeFileSync(AUTH_FILE, t + "\n", { mode: 0o600, flag: "wx" });
  return t;
})();
const HELPER_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const MAX_READ = 8 * 1024 * 1024; /* 8 MB of text per file, by default */
/* When the page stops talking to us, we stop. launchd wakes us on the next connection. */
const IDLE_EXIT = Number(flag("--idle-exit", process.env.ABYSS_IDLE_EXIT || 0)); /* seconds, 0 = never */
let lastHeard = Date.now();
let busy = 0;
let quitDeadline = 0; /* set by /quit; a page reload cancels it before it fires */
let lastPageServe = 0; /* when the page itself was last served — tells a reload from a close */

/* ------------------------------------------------------------------ the room */
class RoomLink {
  constructor() {
    this.child = null;
    this.buf = "";
    this.seq = 0;
    this.pending = new Map();
    this.tools = null;
    this.lastError = null;
    this.lastOk = null;
  }

  start() {
    if (this.child) return;
    this.child = spawn(process.execPath, [BRIDGE], {
      env: { ...process.env, ROOM_HARNESS: HARNESS, ROOM_TOKEN_FILE: TOKEN_FILE },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (d) => this.onData(d));
    this.child.stderr.on("data", (d) => {
      const line = String(d).trim();
      if (line) this.lastError = line.slice(0, 300);
    });
    this.child.on("exit", () => {
      this.child = null;
      for (const [, p] of this.pending) p.reject(new Error("the room bridge exited"));
      this.pending.clear();
    });
  }

  onData(chunk) {
    this.buf += chunk.toString();
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const p = msg.id !== undefined && this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        p.resolve(msg);
      }
    }
  }

  rpc(method, params, ms = 90000) {
    this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the room did not answer ${method} within ${Math.round(ms / 1000)}s`));
      }, ms);
      this.pending.set(id, {
        resolve: (m) => {
          clearTimeout(timer);
          m.error ? reject(new Error(`${m.error.code} ${m.error.message}`)) : resolve(m.result);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async ensureReady() {
    if (this.ready) return;
    await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "abyss-bridge", version: "1.0.0" },
    });
    this.ready = true;
  }

  async listTools() {
    await this.ensureReady();
    if (!this.tools) this.tools = (await this.rpc("tools/list", {})).tools || [];
    return this.tools;
  }

  /* The room wraps its answers two or three layers deep in content/text blocks.
     Dig until plain json comes out, so every route below can just read fields. */
  static unwrap(result) {
    let text = (result.content || []).map((c) => c.text || "").join("\n");
    let data = null;
    let depth = 0;
    while (depth++ < 4) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        break;
      }
      if (parsed && Array.isArray(parsed.content)) {
        text = parsed.content.map((c) => c.text || "").join("\n");
        continue;
      }
      data = parsed;
      break;
    }
    return { text, data };
  }

  async call(name, args = {}) {
    await this.ensureReady();
    const res = await this.rpc("tools/call", { name, arguments: args }, 120000);
    const { text, data } = RoomLink.unwrap(res);
    this.lastOk = new Date().toISOString();
    return { isError: !!res.isError, text, data };
  }

  /* The room hands out its catalogue one small page at a time, and the bridge
     truncates any answer longer than 8000 characters, so ask for small pages and
     shrink the page size whenever one comes back cut. Cached for ten minutes. */
  async catalog() {
    if (this._catalog && Date.now() - this._catalogAt < 10 * 60 * 1000) return this._catalog;
    const items = [];
    let cursor = null;
    let limit = 6;
    let total = null;
    for (let page = 0; page < 60; page++) {
      const args = { limit };
      if (cursor) args.cursor = cursor;
      const res = await this.rpc("tools/call", { name: "room_list_servers", arguments: args }, 120000);
      const { text, data } = RoomLink.unwrap(res);
      const truncated = text.length >= 7990 || !data;
      if (truncated) {
        if (limit === 1) break; /* cannot ask any smaller */
        limit = Math.max(1, Math.floor(limit / 2));
        continue;
      }
      items.push(...(data.items || []));
      total = data.total ?? total;
      cursor = data.nextCursor || null;
      if (!cursor || (total && items.length >= total)) break;
    }
    this._catalog = { total, count: items.length, servers: items };
    this._catalogAt = Date.now();
    return this._catalog;
  }

  async status() {
    try {
      const r = await this.call("room_status");
      const served = this._catalog || null;
      const count = served ? served.count : null;
      return {
        connected: !r.isError,
        detail: r.text.slice(0, 300),
        servers: count ? Number(count) : null,
        harness: HARNESS,
        tokenFile: TOKEN_FILE,
        tokenCached: existsSync(TOKEN_FILE),
        lastError: this.lastError,
      };
    } catch (err) {
      return { connected: false, detail: String(err.message || err), harness: HARNESS, tokenCached: existsSync(TOKEN_FILE) };
    }
  }
}

const room = new RoomLink();

/* ------------------------------------------------------------------ filesystem */
const TEXT_EXT = new Set([
  ".txt", ".md", ".markdown", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".jsonc", ".css", ".scss",
  ".html", ".htm", ".xml", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".sh", ".bash", ".zsh", ".py",
  ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".pl", ".lua", ".sql",
  ".csv", ".tsv", ".log", ".env", ".gitignore", ".dockerfile", ".gradle", ".lock", ".gitattributes",
]);
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "target", ".venv", "venv", "__pycache__", ".cache", ".DS_Store"]);

function safePath(p) {
  const abs = resolve(p || HOME);
  return abs;
}

function walk(root, limit = 4000) {
  /* what the project's own .gitignore would not commit, the walk does not index */
  const rules = [];
  try {
    for (const raw of readFileSync(join(root, ".gitignore"), "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      const p = line.replace(/\/+$/, "");
      const esc = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      const re = p.includes("*") ? new RegExp("^" + esc + "$") : null;
      rules.push(re ? (rel, name) => re.test(name) || re.test(rel) : (rel, name) => name === p || rel === p || rel.startsWith(p + "/"));
    }
  } catch {}
  const ignored = (rel, name) => rules.some((f) => f(rel, name));
  const out = [];
  const stack = [root];
  while (stack.length && out.length < limit) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".DS_Store")) continue;
      const full = join(dir, e.name);
      if (rules.length && ignored(full.slice(root.length + 1), e.name)) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(full);
      } else if (e.isFile()) {
        let st = null;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        const e2 = extname(e.name).toLowerCase();
        const kind = TEXT_EXT.has(e2)
          ? "text"
          : PDF_EXT.has(e2) || OFFICE_TEXT_EXT.has(e2) || ZIP_XML_EXT.has(e2)
            ? "document"
            : IMAGE_EXT.has(e2)
              ? "image"
              : "other";
        out.push({ path: full, size: st.size, mtime: st.mtimeMs, text: kind === "text", kind });
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------- reading attachments
   Everything arrives as text the model can take, or as a picture it reads natively.
   Pictures bill as input tokens (about 1024 each); text bills by the character. */
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".heic"]);
const PDF_EXT = new Set([".pdf"]);
const OFFICE_TEXT_EXT = new Set([".doc", ".docx", ".rtf", ".odt", ".html", ".htm", ".webarchive", ".wordml"]);
const ZIP_XML_EXT = new Set([".xlsx", ".xlsm", ".pptx", ".docx"]);
const AUDIO_VIDEO_EXT = new Set([".mp3", ".m4a", ".wav", ".aac", ".flac", ".mp4", ".mov", ".mkv", ".webm", ".avi"]);

const IMAGE_TOKENS = 1024;
const estimate = (tokens) => ({
  tokens,
  /* per 1M tokens, off-peak: flash input miss $0.15, pro input miss $0.66 */
  costFlashUsd: (tokens / 1e6) * 0.15,
  costProUsd: (tokens / 1e6) * 0.66,
  costFlashPeakUsd: (tokens / 1e6) * 0.3,
});

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120000, ...opts });
}

function stripXml(xml) {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/* One file in, ready-to-send material out. */
function readAttachment(inputPath, { ocr = false, maxBytes = MAX_READ } = {}) {
  /* tesseract cannot open a path that goes through a symlink (/tmp is one), so
     hand every external tool the real path. */
  let filePath = resolve(inputPath);
  try {
    filePath = realpathSync(filePath);
  } catch {}
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath);
  let st;
  try {
    st = statSync(filePath);
  } catch (err) {
    return { ok: false, path: filePath, name, error: "cannot read it: " + String(err.message || err) };
  }
  if (st.isDirectory()) return { ok: false, path: filePath, name, error: "that is a folder — use the folder route" };
  const bytes = st.size;

  if (AUDIO_VIDEO_EXT.has(ext)) {
    return { ok: false, path: filePath, name, bytes, error: "DeepSeek takes text and pictures only — audio and video cannot be sent" };
  }

  if (IMAGE_EXT.has(ext)) {
    if (bytes > 32 * 1024 * 1024) {
      return { ok: false, path: filePath, name, bytes, error: "over the 32 MB picture limit the API allows" };
    }
    let target = filePath;
    let note = "";
    if (bytes > 6 * 1024 * 1024) {
      /* shrink big pictures so the request stays light; 2048px is plenty for reading a screen */
      const small = join(tmpdirSafe(), "abyss-attach-" + Date.now() + "." + (ext === ".jpg" || ext === ".jpeg" ? "jpg" : "png"));
      const fmt = ext === ".jpg" || ext === ".jpeg" ? "jpeg" : "png";
      run("sips", ["-s", "format", fmt, "-Z", "2048", filePath, "--out", small]);
      target = small;
      note = "shrank it from " + (bytes / 1048576).toFixed(1) + " MB so the request stays light";
    }
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
    const dataUrl = "data:" + mime + ";base64," + readFileSync(target).toString("base64");
    const out = { ok: true, path: filePath, name, bytes, kind: "image", dataUrl, tokens: IMAGE_TOKENS, estimate: estimate(IMAGE_TOKENS) };
    if (note) out.note = note;
    if (ocr) {
      try {
        out.ocr = run("tesseract", [target, "stdout"]).trim().slice(0, 200000);
        out.tokens += Math.ceil(out.ocr.length / 4);
        out.estimate = estimate(out.tokens);
      } catch (err) {
        out.ocrError = String(err.message || err).slice(0, 160);
      }
    }
    return out;
  }

  let text = "";
  let how = "";
  try {
    if (PDF_EXT.has(ext)) {
      text = run("pdftotext", ["-layout", filePath, "-"]).slice(0, 4 * 1024 * 1024);
      how = "text lifted out with pdftotext";
      let looksLikeScan = false;
      if (text.replace(/\s/g, "").length < 40) {
        try {
          looksLikeScan = run("pdfimages", ["-list", filePath]).split("\n").length > 3;
        } catch {
          looksLikeScan = true;
        }
      }
      if (looksLikeScan) {
        /* a scan: no text layer, so read the first pages as pictures instead */
        const dir = join(tmpdirSafe(), "pdf-" + Date.now());
        try {
          execFileSync("mkdir", ["-p", dir]);
          run("pdftoppm", ["-r", "200", "-png", "-f", "1", "-l", "5", filePath, join(dir, "page")]);
          const pages = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
          let ocrText = "";
          for (const page of pages) {
            try {
              ocrText += "\n\n--- page " + page.replace(/\D+/g, "") + " ---\n" + run("tesseract", [join(dir, page), "stdout"]);
            } catch {}
          }
          if (ocrText.trim().length > text.trim().length) {
            text = ocrText.slice(0, 4 * 1024 * 1024);
            how = "this pdf is a scan, so the first " + pages.length + " pages were read with OCR (tesseract + pdftoppm)";
          }
        } catch (err) {
          how += " — and it looks like a scan, but the page pictures could not be read: " + String(err.message || err).slice(0, 120);
        }
      }
    } else if (OFFICE_TEXT_EXT.has(ext)) {
      text = run("textutil", ["-convert", "txt", "-stdout", filePath]).slice(0, 4 * 1024 * 1024);
      how = "converted with textutil";
    } else if (ZIP_XML_EXT.has(ext)) {
      const raw = run("unzip", ["-p", filePath]).slice(0, 16 * 1024 * 1024);
      text = stripXml(raw).slice(0, 4 * 1024 * 1024);
      how = "unzipped and the text pulled out";
    } else {
      if (bytes > maxBytes) {
        return { ok: false, path: filePath, name, bytes, error: `that file is ${(bytes / 1048576).toFixed(1)} MB, over the ${(maxBytes / 1048576).toFixed(0)} MB read cap` };
      }
      const buf = readFileSync(filePath);
      if (buf.subarray(0, 4096).includes(0)) {
        return { ok: false, path: filePath, name, bytes, error: "that looks binary — I cannot read it as text" };
      }
      text = buf.toString("utf8");
      how = "read as text";
    }
  } catch (err) {
    return { ok: false, path: filePath, name, bytes, error: "could not read it: " + String(err.message || err).slice(0, 160) };
  }

  const tokens = Math.ceil(text.length / 4);
  return { ok: true, path: filePath, name, bytes, kind: "text", text, tokens, how, estimate: estimate(tokens) };
}

/* ---------------------------------------------------------------- writing
   Every write keeps a copy of what was there first, and every copy is listed in
   a journal, so a change can be undone without asking the model for anything. */
/* ---------------------------------------------------------------- library
   Sessions and recipes kept as files in your home folder, so clearing the
   browser's saved data cannot lose them. */
const LIB_DIR = () => {
  const dir = join(homedir(), ".abyss-console");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
};
const LIB_FILE = (kind) => join(LIB_DIR(), kind + ".json");

function readLibrary(kind) {
  try {
    const raw = readFileSync(LIB_FILE(kind), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLibrary(kind, list) {
  writeFileSync(LIB_FILE(kind), JSON.stringify(list, null, 1), "utf8");
  return list.length;
}

/* The scheduled-tasks governance asks every unit to log its own runs: append-only,
   ISO-stamped, so a later auditor can see what happened and when. */
function logRun(event, detail) {
  const line = [new Date().toISOString(), "pid=" + process.pid, event, detail || ""].join("\t") + "\n";
  try {
    appendFileSync(join(homedir(), ".abyss-console", "runs.log"), line);
  } catch {}
  console.log("[run] " + line.trim());
}

const UNDO_DIR = () => {
  const dir = join(homedir(), ".cache", "abyss-bridge", "undo");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
};
const JOURNAL = () => join(homedir(), ".cache", "abyss-bridge", "writes.jsonl");

function writeFileSafely(path, text, why) {
  const abs = resolve(path);
  if (!(abs.startsWith(HOME) || abs.startsWith("/Volumes") || abs.startsWith("/tmp") || abs.startsWith("/private"))) {
    return { ok: false, error: "that path is outside this machine's home folder, /tmp and the Storage drives" };
  }
  let before = null;
  let existed = false;
  try {
    before = readFileSync(abs);
    existed = true;
  } catch {
    existed = false;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = join(UNDO_DIR(), stamp + "--" + basename(abs).replace(/\W/g, "_"));
  try {
    if (existed) copyFileSync(abs, backup);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  } catch (err) {
    return { ok: false, error: "could not write it: " + String(err.message || err).slice(0, 200) };
  }
  const entry = {
    at: new Date().toISOString(),
    path: abs,
    existed,
    backup: existed ? backup : null,
    bytesBefore: existed ? before.length : 0,
    bytesAfter: Buffer.byteLength(text, "utf8"),
    why: why || "",
  };
  try {
    appendFileSync(JOURNAL(), JSON.stringify(entry) + "\n");
  } catch {}
  return { ok: true, path: abs, bytes: entry.bytesAfter, existed, backup: entry.backup };
}

/* ---------------------------------------------------------------- patches
   A unified diff, applied hunk by hunk. Each hunk is checked against the file as
   it is right now; a hunk whose context no longer matches is reported, not forced. */
function parsePatch(text) {
  const lines = String(text || "").split("\n");
  const files = [];
  let cur = null;
  let hunk = null;
  const pushHunk = () => {
    if (cur && hunk && hunk.lines.length) cur.hunks.push(hunk);
    hunk = null;
  };
  for (const line of lines) {
    const mFile = line.match(/^\+\+\+\s+(?:b\/)?(.+?)(?:\t.*)?$/);
    const mMinus = line.match(/^---\s+(?:a\/)?(.+?)(?:\t.*)?$/);
    const mHunk = line.match(/^@@\s+-?(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (mMinus && !mFile) continue;
    if (mFile) {
      pushHunk();
      cur = { path: mFile[1].trim(), hunks: [] };
      files.push(cur);
      continue;
    }
    if (mHunk && cur) {
      pushHunk();
      hunk = { from: Number(mHunk[1]), lines: [] };
      continue;
    }
    if (!cur) continue;
    if (hunk === null) continue;
    if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "") hunk.lines.push(line === "" ? " " : line);
    else if (line.startsWith("\\")) continue;
  }
  pushHunk();
  return files;
}

/* Does this hunk fit at this line? Exact first; trim:true also forgives trailing
   whitespace on the context and removed lines. Added lines never constrain a fit. */
function hunkMatchAt(src, at, lines, { trim = false } = {}) {
  let c = at;
  for (const line of lines) {
    const kind = line[0];
    if (kind === "+") continue;
    const text = line.slice(1);
    const here = src[c];
    if (here === undefined) return false;
    if (here === text) {
      c++;
      continue;
    }
    if (trim && String(here).replace(/\s+$/, "") === text.replace(/\s+$/, "")) {
      c++;
      continue;
    }
    return false;
  }
  return true;
}

function applyHunks(before, hunks, fuzz = 8) {
  const src = before.split("\n");
  const out = [];
  let cursor = 0;
  const report = [];
  for (const hunk of hunks) {
    const want = Math.max(0, hunk.from - 1);
    const noContext = !hunk.lines.some((l) => l[0] === " " || l[0] === "-");
    let start = -1;
    let how = "exact";
    if (want >= cursor && want <= src.length && hunkMatchAt(src, want, hunk.lines)) start = want;
    if (start === -1) {
      for (let off = 1; off <= fuzz && start === -1; off++) {
        for (const at2 of [want - off, want + off]) {
          if (at2 >= cursor && at2 <= src.length && hunkMatchAt(src, at2, hunk.lines)) {
            start = at2;
            how = "moved " + (at2 < want ? "up" : "down") + " " + Math.abs(at2 - want) + " line(s)";
            break;
          }
        }
      }
    }
    if (start === -1) {
      for (let off = 0; off <= fuzz && start === -1; off++) {
        for (const at2 of [want - off, want + off]) {
          if (at2 >= cursor && at2 <= src.length && hunkMatchAt(src, at2, hunk.lines, { trim: true })) {
            start = at2;
            how = "whitespace-tolerant" + (off ? ", " + off + " line(s) off" : "");
            break;
          }
        }
      }
    }
    if (start === -1 && noContext) {
      start = Math.max(cursor, Math.min(want, src.length));
      how = "pure insert";
    }
    if (start === -1) {
      /* never force a hunk: report where it should have gone and what is there instead */
      report.push({
        from: hunk.from,
        conflict: true,
        why: "no exact or nearby match within " + fuzz + " line(s)",
        expected: hunk.lines.filter((l) => l[0] === " " || l[0] === "-").map((l) => l.slice(1)).slice(0, 3),
        found: src.slice(want, want + 3).map((l) => (l === undefined ? "(end of file)" : l)),
      });
      continue;
    }
    while (cursor < start && cursor < src.length) out.push(src[cursor++]);
    for (const line of hunk.lines) {
      const kind = line[0];
      if (kind === " ") {
        out.push(src[cursor]);
        cursor++;
      } else if (kind === "-") {
        cursor++;
      } else {
        out.push(line.slice(1));
      }
    }
    report.push({
      from: hunk.from,
      conflict: false,
      at: start + 1,
      how,
      added: hunk.lines.filter((l) => l[0] === "+").length,
      removed: hunk.lines.filter((l) => l[0] === "-").length,
    });
  }
  while (cursor < src.length) out.push(src[cursor++]);
  return { text: out.join("\n"), report };
}

function undoLast(path) {
  const abs = resolve(path);
  let lines = [];
  try {
    lines = readFileSync(JOURNAL(), "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return { ok: false, error: "nothing has been written yet" };
  }
  const entries = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
  const mine = entries.filter((e) => e.path === abs && !e.undoneAt);
  if (!mine.length) return { ok: false, error: "no un-undone write for that path" };
  const last = mine[mine.length - 1];
  try {
    if (last.existed && last.backup && existsSync(last.backup)) {
      copyFileSync(last.backup, abs);
    } else if (!last.existed) {
      /* the file did not exist before the write: put the journal straight and remove it */
      execFileSync("rm", [abs]);
    }
  } catch (err) {
    return { ok: false, error: "could not restore: " + String(err.message || err).slice(0, 200) };
  }
  last.undoneAt = new Date().toISOString();
  try {
    writeFileSync(JOURNAL(), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  } catch {}
  return { ok: true, path: abs, restoredFrom: last.backup, removedFile: !last.existed };
}

function tmpdirSafe() {
  const dir = join(homedir(), ".cache", "abyss-bridge");
  try {
    execFileSync("mkdir", ["-p", dir]);
  } catch {}
  return dir;
}

/* ------------------------------------------------------------------ http */
const CORS = {
  "access-control-allow-headers": "content-type,x-abyss-token,mcp-session-id,mcp-protocol-version",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-expose-headers": "mcp-session-id",
};

const json = (res, code, body) => {
  res.writeHead(code, { ...CORS, "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

function readBody(req, cap = 12 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > cap) {
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString() || ""));
  });
}

const OPEN_PATHS = new Set(["/", "/index.html", "/deepseek-api-console.html", "/health"]);

const server = createServer(async (req, res) => {
  lastHeard = Date.now();
  busy++;
  res.on("close", () => {
    busy--;
    lastHeard = Date.now();
  });
  const url = new URL(req.url, "http://127.0.0.1");

  /* Trust only this helper's own origin. Other loopback ports and opaque origins
     are other applications. Validate Host as well to reject DNS rebinding. */
  const host = req.headers.host || "";
  const origin = req.headers.origin || "";
  if (!HELPER_HOSTS.has(host) || (origin && origin !== `http://${host}`) ||
      ["cross-site", "same-site"].includes(req.headers["sec-fetch-site"])) {
    json(res, 403, { error: "refused: the request host or origin is not this helper's own page" });
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }

  /* Token gate: everything except the page itself and /health needs it. */
  const given = String(req.headers["x-abyss-token"] || "");
  const givenBuf = Buffer.from(given, "utf8");
  const realBuf = Buffer.from(HELPER_TOKEN, "utf8");
  if (!OPEN_PATHS.has(url.pathname) && !(givenBuf.length === realBuf.length && timingSafeEqual(givenBuf, realBuf))) {
    logRun("auth-refused", url.pathname + " (no token)");
    json(res, 403, {
      error:
        "the helper token is missing or wrong. Open the page from http://127.0.0.1:" + PORT +
        "/ — the helper puts the token into that copy. (Token file: " + AUTH_FILE + ".)",
    });
    return;
  }

  /* the page itself — served with the helper token injected, and only here */
  if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/deepseek-api-console.html") {
    if (!existsSync(PAGE)) {
      res.writeHead(404, CORS).end("the page file was not found: " + PAGE);
      return;
    }
    const tokenScript = "<script>window.__ABYSS_TOKEN=" + JSON.stringify(HELPER_TOKEN) + ";</script>";
    let html = readFileSync(PAGE, "utf8");
    html = html.includes("<head>") ? html.replace("<head>", "<head>" + tokenScript) : tokenScript + html;
    lastPageServe = Date.now();
    quitDeadline = 0; /* the page (re)loaded — a pending quit was a reload, not a close */
    res.writeHead(200, { ...CORS, "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store", "content-security-policy": "frame-ancestors 'none'",
      "x-frame-options": "DENY", "cross-origin-resource-policy": "same-origin" });
    res.end(html);
    return;
  }

  /* The tab may be closing, or it may be reloading: a reload fetches the page around the same
     moment this beacon fires, and the two race. A quit that lands within a second of a page
     load is a reload and is ignored; otherwise the helper waits two more seconds, and a page
     load in that window cancels it outright. Only a close with no page load stops the helper. */
  if (url.pathname === "/quit") {
    json(res, 200, { ok: true, quitting: true });
    if (Date.now() - lastPageServe < 1000) {
      logRun("quit-ignored", "the page had just (re)loaded");
      return;
    }
    logRun("quit-requested", "by the page");
    quitDeadline = Date.now() + 2000;
    setTimeout(() => { if (quitDeadline && Date.now() >= quitDeadline) bye(); }, 2100);
    return;
  }

  if (url.pathname === "/health") {
    const tools = await room.listTools().catch(() => null);
    json(res, 200, {
      ok: true,
      helper: "abyss-bridge",
      page: PAGE,
      pageExists: existsSync(PAGE),
      tokenRequired: true,
      mcpEndpoint: `http://127.0.0.1:${PORT}/mcp`,
      roomBridge: BRIDGE,
      roomBridgeExists: existsSync(BRIDGE),
      harness: HARNESS,
      tokenCached: existsSync(TOKEN_FILE),
      roomTools: tools ? tools.map((t) => t.name) : null,
      home: HOME,
      node: process.version,
    });
    return;
  }

  if (url.pathname === "/room/status") {
    json(res, 200, await room.status());
    return;
  }

  if (url.pathname === "/room/servers") {
    try {
      const c = await room.catalog();
      const cats = {};
      for (const it of c.servers) cats[it.category || "other"] = (cats[it.category || "other"] || 0) + 1;
      json(res, 200, { count: c.count, total: c.total, categories: cats, servers: c.servers });
    } catch (err) {
      json(res, 502, { error: String(err.message || err) });
    }
    return;
  }

  if (url.pathname === "/room/tools") {
    const server_ = url.searchParams.get("server") || "";
    const q = url.searchParams.get("q") || "";
    const args = { query: q };
    if (server_) args.server = server_;
    const r = await room.call("room_search_tools", args);
    json(res, r.isError ? 502 : 200, r.data ? { server: server_, query: q, result: r.data } : { raw: r.text.slice(0, 6000) });
    return;
  }

  if (url.pathname === "/room/describe") {
    const r = await room.call("room_describe_tool", {
      server: url.searchParams.get("server") || "",
      tool: url.searchParams.get("tool") || "",
    });
    json(res, r.isError ? 502 : 200, r.data || { raw: r.text.slice(0, 6000) });
    return;
  }

  if (url.pathname === "/room/call" && req.method === "POST") {
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "the body must be json: { server, tool, arguments }" });
      return;
    }
    if (!body.tool) {
      json(res, 400, { error: "name the tool you want called" });
      return;
    }
    const r = await room.call("room_call_tool", { server: body.server, tool: body.tool, arguments: body.arguments || {} });
    json(res, r.isError ? 502 : 200, { isError: r.isError, text: r.text.slice(0, 20000), data: r.data });
    return;
  }

  /* a plain MCP endpoint, so the page's own gate system and approval queue work */
  if (url.pathname === "/mcp" && req.method === "POST") {
    let msg = null;
    try {
      msg = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "not json" } });
      return;
    }
    if (!msg || msg.id === undefined) {
      res.writeHead(202, CORS).end();
      return;
    }
    try {
      await room.ensureReady();
      if (msg.method === "initialize") {
        json(res, 200, {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "abyss-bridge", version: "1.0.0" },
          },
        });
        return;
      }
      if (msg.method === "tools/list") {
        const tools = await room.listTools();
        json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { tools } });
        return;
      }
      if (msg.method === "tools/call") {
        const name = msg.params && msg.params.name;
        const args = (msg.params && msg.params.arguments) || {};
        const r = await room.rpc("tools/call", { name, arguments: args }, 180000);
        json(res, 200, { jsonrpc: "2.0", id: msg.id, result: r });
        return;
      }
      json(res, 200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown method: " + msg.method } });
    } catch (err) {
      json(res, 200, { jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: String(err.message || err) } });
    }
    return;
  }

  /* the session and recipe library, on disk */
  if (url.pathname === "/lib" && req.method === "GET") {
    json(res, 200, {
      dir: LIB_DIR(),
      sessions: readLibrary("sessions"),
      recipes: readLibrary("recipes"),
    });
    return;
  }

  if (url.pathname === "/lib/sessions" && req.method === "POST") {
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {}
    const list = readLibrary("sessions");
    if (body.remove) {
      const next = list.filter((x) => x.id !== body.remove);
      json(res, 200, { ok: true, removed: body.remove, sessions: writeLibrary("sessions", next) });
      return;
    }
    if (!body.id) {
      json(res, 400, { error: "a session needs an id" });
      return;
    }
    const at = list.findIndex((x) => x.id === body.id);
    const entry = { ...body, savedAt: new Date().toISOString() };
    if (at === -1) list.unshift(entry);
    else list[at] = { ...list[at], ...entry };
    json(res, 200, { ok: true, sessions: writeLibrary("sessions", list.slice(0, 500)), entry });
    return;
  }

  if (url.pathname === "/lib/recipes" && req.method === "POST") {
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {}
    const list = readLibrary("recipes");
    if (body.remove) {
      const next = list.filter((x) => x.id !== body.remove);
      json(res, 200, { ok: true, removed: body.remove, recipes: writeLibrary("recipes", next) });
      return;
    }
    if (!body.id || !body.name || typeof body.text !== "string") {
      json(res, 400, { error: "a recipe needs { id, name, text }" });
      return;
    }
    const at = list.findIndex((x) => x.id === body.id);
    const entry = { ...body, savedAt: new Date().toISOString() };
    if (at === -1) list.unshift(entry);
    else list[at] = { ...list[at], ...entry };
    json(res, 200, { ok: true, recipes: writeLibrary("recipes", list.slice(0, 500)), entry });
    return;
  }

  /* write one file, keeping what was there before */
  if (url.pathname === "/fs/write" && req.method === "POST") {
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "the body must be json: { path, text }" });
      return;
    }
    if (!body.path || typeof body.text !== "string") {
      json(res, 400, { error: "give me { path, text }" });
      return;
    }
    if (Buffer.byteLength(body.text, "utf8") > MAX_READ) {
      json(res, 413, { error: "that text is bigger than the write cap" });
      return;
    }
    const out = writeFileSafely(body.path, body.text, body.why);
    json(res, out.ok ? 200 : 422, out);
    return;
  }

  /* apply a unified diff, whole or hunk by hunk */
  if (url.pathname === "/fs/patch" && req.method === "POST") {
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "the body must be json: { patch, paths? , dryRun? }" });
      return;
    }
    if (!body.patch || typeof body.patch !== "string") {
      json(res, 400, { error: "give me { patch } — a unified diff" });
      return;
    }
    const wanted = Array.isArray(body.paths) && body.paths.length ? body.paths : null;
    const files = parsePatch(body.patch).filter((f) => !wanted || wanted.indexOf(f.path) !== -1);
    if (!files.length) {
      json(res, 422, { error: "that does not look like a unified diff (no --- and +++ and @@ lines in a usable order)" });
      return;
    }
    const results = [];
    for (const f of files) {
      const abs = resolve(f.path);
      let before = "";
      let existed = true;
      try {
        before = readFileSync(abs, "utf8");
      } catch {
        existed = false;
      }
      const { text, report } = applyHunks(before, f.hunks);
      const clean = report.every((r) => !r.conflict);
      if (body.dryRun || !clean) {
        results.push({ path: abs, existed, applied: false, clean, report });
        continue;
      }
      const written = writeFileSafely(abs, text, "applied a patch from the chat");
      results.push({ path: abs, existed, applied: written.ok, clean, backup: written.backup, report });
    }
    json(res, 200, { files: results, applied: results.filter((r) => r.applied).length, conflicts: results.filter((r) => !r.clean).length });
    return;
  }

  /* put back what was there before */
  if (url.pathname === "/fs/undo" && req.method === "POST") {
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {}
    json(res, 200, undoLast(body.path || ""));
    return;
  }

  if (url.pathname === "/fs/journal") {
    let entries = [];
    try {
      entries = readFileSync(JOURNAL(), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {}
    json(res, 200, { count: entries.length, entries: entries.slice(-40).reverse() });
    return;
  }

  /* run a command, when the page has been told to */
  if (url.pathname === "/run" && req.method === "POST") {
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {}
    if (!body.cmd || !String(body.cmd).trim()) {
      json(res, 400, { error: "give me { cmd, cwd }" });
      return;
    }
    if (body.confirm !== true) {
      json(res, 403, { error: "a command only runs when the request says confirm: true — the page asks you first" });
      return;
    }
    const cwd = body.cwd && existsSync(body.cwd) ? body.cwd : HOME;
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let code = 0;
    try {
      stdout = execFileSync("/bin/bash", ["-lc", String(body.cmd)], {
        cwd,
        encoding: "utf8",
        timeout: Math.min(Number(body.timeoutMs || 120000), 600000),
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (err) {
      code = typeof err.status === "number" ? err.status : 1;
      stdout = String(err.stdout || "");
      stderr = String(err.stderr || err.message || "");
    }
    json(res, 200, {
      cmd: body.cmd,
      cwd,
      code,
      ok: code === 0,
      ms: Date.now() - started,
      stdout: stdout.slice(-40000),
      stderr: stderr.slice(-40000),
    });
    return;
  }

  /* ------------------------------------------------------------------- git */
  /* Read-only facts plus explicit stage and commit; the page asks before the writes. */
  const gitRootOf = (requested) => {
    const p2 = safePath(requested || HOME);
    try {
      return execFileSync("git", ["-C", p2, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 5000, maxBuffer: 1 << 20 }).trim();
    } catch {
      return "";
    }
  };
  const runGit = (repo, args, timeout = 20000) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout, maxBuffer: 8 << 20 });

  if (url.pathname === "/git/status") {
    const gitRoot = gitRootOf(url.searchParams.get("path"));
    if (!gitRoot) { json(res, 200, { ok: false, error: "that folder is not inside a git work tree" }); return; }
    let branch = "";
    let head = "";
    try {
      branch = runGit(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"], 5000).trim();
      head = runGit(gitRoot, ["rev-parse", "--short", "HEAD"], 5000).trim();
    } catch {
      branch = "(no commits yet)";
    }
    let changed = [];
    try {
      changed = runGit(gitRoot, ["status", "--porcelain=v1"], 10000)
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ xy: line.slice(0, 2), path: line.slice(3).trim() }));
    } catch {}
    json(res, 200, { ok: true, root: gitRoot, branch, head, changed, clean: changed.length === 0 });
    return;
  }

  if (url.pathname === "/git/diff") {
    const gitRoot = gitRootOf(url.searchParams.get("path"));
    if (!gitRoot) { json(res, 200, { ok: false, error: "that folder is not inside a git work tree" }); return; }
    const file = url.searchParams.get("file") || "";
    const staged = url.searchParams.get("staged") === "1";
    const args = staged ? ["diff", "--cached", "--no-color"] : ["diff", "HEAD", "--no-color"];
    if (file) args.push("--", file);
    let text = "";
    try {
      text = runGit(gitRoot, args);
    } catch (err) {
      text = String(err.stdout || "");
      if (!text) {
        /* a repo with no commits yet has no HEAD to diff against */
        const fallback = staged ? ["diff", "--cached", "--no-color"] : ["diff", "--no-color"];
        if (file) fallback.push("--", file);
        try { text = runGit(gitRoot, fallback); } catch (err2) { text = String(err2.stdout || ""); }
      }
    }
    const cut = 200000;
    const truncated = text.length > cut;
    json(res, 200, {
      ok: true,
      root: gitRoot,
      file: file || "(everything)",
      staged,
      text: truncated ? text.slice(0, cut) + "\n…[diff cut at " + cut + " characters]" : text,
      truncated,
    });
    return;
  }

  if (url.pathname === "/git/stage" && req.method === "POST") {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || "{}"); } catch {}
    if (body.confirm !== true) { json(res, 403, { error: "staging changes the repo's state — send confirm: true; the page asks first" }); return; }
    const gitRoot = gitRootOf(body.path);
    if (!gitRoot) { json(res, 200, { ok: false, error: "that folder is not inside a git work tree" }); return; }
    const files = Array.isArray(body.files) && body.files.length ? body.files.map(String) : [];
    try {
      runGit(gitRoot, files.length ? ["add", "--", ...files] : ["add", "-A"], 30000);
    } catch (err) {
      json(res, 200, { ok: false, error: String(err.stderr || err.stdout || err.message || err).slice(0, 300) });
      return;
    }
    logRun("git-stage", (files.length ? files.join(" ") : "-A").slice(0, 120));
    json(res, 200, { ok: true, root: gitRoot, staged: files.length ? files : ["-A"] });
    return;
  }

  if (url.pathname === "/git/commit" && req.method === "POST") {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || "{}"); } catch {}
    if (body.confirm !== true) { json(res, 403, { error: "a commit is a real change — send confirm: true; the page asks first" }); return; }
    const message = String(body.message || "").trim();
    if (!message) { json(res, 400, { error: "a commit needs { message }" }); return; }
    const gitRoot = gitRootOf(body.path);
    if (!gitRoot) { json(res, 200, { ok: false, error: "that folder is not inside a git work tree" }); return; }
    try {
      const out = runGit(gitRoot, ["commit", "-m", message], 60000);
      let hash = "";
      try { hash = runGit(gitRoot, ["rev-parse", "--short", "HEAD"], 5000).trim(); } catch {}
      logRun("git-commit", (hash + " " + message).slice(0, 120));
      json(res, 200, { ok: true, root: gitRoot, hash, output: out.slice(0, 2000) });
    } catch (err) {
      json(res, 200, { ok: false, error: String(err.stderr || err.stdout || err.message || err).slice(0, 400) });
    }
    return;
  }

  /* several files at once, for when the model asks for a few by path */
  if (url.pathname === "/fs/many") {
    const pathsParam = url.searchParams.get("paths") || "";
    const root = safePath(url.searchParams.get("root") || HOME);
    const want = pathsParam.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 24);
    if (!want.length) {
      json(res, 400, { error: "give me paths: /fs/many?paths=a,b,c" });
      return;
    }
    const out = [];
    let tokens = 0;
    const cap = Math.min(Number(url.searchParams.get("maxBytes") || 512 * 1024), MAX_READ);
    const totalCap = 4 * 1024 * 1024;
    for (const w of want) {
      const abs = w.startsWith("/") ? resolve(w) : resolve(root, w);
      const a = readAttachment(abs, { maxBytes: cap });
      if (!a.ok) {
        out.push({ path: abs, error: a.error });
        continue;
      }
      if (a.kind === "image") {
        out.push({ path: abs, error: "a picture — attach it on its own, it goes as picture data" });
        continue;
      }
      if (tokens + a.tokens > totalCap / 4) {
        out.push({ path: abs, error: "the read budget for this request was already full" });
        continue;
      }
      out.push({ path: a.path, name: a.name, bytes: a.bytes, tokens: a.tokens, text: a.text });
      tokens += a.tokens;
    }
    json(res, 200, { root, asked: want.length, read: out.filter((x) => x.text).length, tokens, files: out });
    return;
  }

  /* one file, ready to attach */
  if (url.pathname === "/attach") {
    const p = safePath(url.searchParams.get("path") || "");
    if (!(p.startsWith(HOME) || p.startsWith("/Volumes") || p.startsWith("/tmp") || p.startsWith("/private"))) {
      json(res, 403, { error: "that path is outside this machine's home folder, /tmp and the Storage drives" });
      return;
    }
    const out = readAttachment(p, { ocr: url.searchParams.get("ocr") === "1" });
    json(res, out.ok ? 200 : 422, out);
    return;
  }

  /* a whole folder, as an index plus the text of the files worth sending */
  if (url.pathname === "/attach/folder") {
    const root = safePath(url.searchParams.get("path") || HOME);
    const maxFiles = Math.min(Number(url.searchParams.get("maxFiles") || 60), 400);
    const perFile = Math.min(Number(url.searchParams.get("maxBytes") || 2 * 1024 * 1024), MAX_READ);
    const totalCap = Math.min(Number(url.searchParams.get("maxTokens") || 400000), 4000000);
    const wanted = (url.searchParams.get("files") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const all = walk(root, 20000);
    const chosen = wanted.length
      ? all.filter((f) => wanted.includes(f.path))
      : all.filter((f) => f.kind === "text" || f.kind === "document").slice(0, maxFiles);
    const files = [];
    const skipped = [];
    let tokens = 0;
    if (!wanted.length) {
      for (const f of all) {
        if (f.kind === "image") skipped.push({ path: f.path, why: "pictures are attached one at a time, not folded into a folder pull" });
        else if (f.kind === "other") skipped.push({ path: f.path, why: "not a text or document type" });
      }
    }
    for (const f of chosen) {
      if (tokens >= totalCap) {
        skipped.push({ path: f.path, why: "the token budget for this pull was already full" });
        continue;
      }
      const a = readAttachment(f.path, { maxBytes: perFile });
      if (!a.ok) {
        skipped.push({ path: f.path, why: a.error });
        continue;
      }
      if (a.kind === "image") {
        skipped.push({ path: f.path, why: "pictures are attached one at a time, not folded into a folder pull" });
        continue;
      }
      files.push({ path: a.path, name: a.name, bytes: a.bytes, tokens: a.tokens, text: a.text });
      tokens += a.tokens;
    }
    json(res, 200, {
      root,
      index: {
        files: all.length,
        textFiles: all.filter((f) => f.kind === "text").length,
        documents: all.filter((f) => f.kind === "document").length,
        images: all.filter((f) => f.kind === "image").length,
        bytes: all.reduce((a, f) => a + f.size, 0),
      },
      attached: files.length,
      skipped: skipped.length,
      skippedWhy: skipped.slice(0, 20),
      tokens,
      estimate: estimate(tokens),
      files,
    });
    return;
  }

  /* filesystem, for attachments and for asking the model for a file by path */
  if (url.pathname === "/fs/tree") {
    const root = safePath(url.searchParams.get("path") || HOME);
    const limit = Math.min(Number(url.searchParams.get("limit") || 4000), 20000);
    const files = walk(root, limit);
    const shown = files.slice(0, Math.min(limit, 2000));
    json(res, 200, {
      root,
      count: files.length,
      shownCount: shown.length,
      truncated: shown.length < files.length || files.length >= limit,
      newest: files.reduce((a, f) => Math.max(a, f.mtime || 0), 0),
      textFiles: files.filter((f) => f.text).length,
      bytes: files.reduce((a, f) => a + f.size, 0),
      files: shown,
    });
    return;
  }

  if (url.pathname === "/fs/read") {
    const p = safePath(url.searchParams.get("path") || "");
    if (!p.startsWith(HOME) && !p.startsWith("/Volumes") && !p.startsWith("/tmp") && !p.startsWith("/private")) {
      json(res, 403, { error: "that path is outside this machine's home folder, /tmp and the Storage drives" });
      return;
    }
    try {
      const st = statSync(p);
      if (st.size > MAX_READ) {
        json(res, 413, { error: `that file is ${(st.size / 1048576).toFixed(1)} MB, over the ${MAX_READ / 1048576} MB read cap` });
        return;
      }
      const buf = readFileSync(p);
      const binary = buf.subarray(0, 4096).includes(0);
      json(res, 200, {
        path: p,
        bytes: st.size,
        binary,
        text: binary ? null : buf.toString("utf8"),
      });
    } catch (err) {
      json(res, 404, { error: String(err.message || err) });
    }
    return;
  }

  if (url.pathname === "/fs/search") {
    const root = safePath(url.searchParams.get("path") || HOME);
    const q = url.searchParams.get("q") || "";
    if (!q) {
      json(res, 400, { error: "give me something to search for: ?q=" });
      return;
    }
    const needle = q.toLowerCase();
    const hits = [];
    for (const f of walk(root, 4000)) {
      if (!f.text || f.size > MAX_READ) continue;
      let text;
      try {
        text = readFileSync(f.path, "utf8");
      } catch {
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          hits.push({ path: f.path, line: i + 1, text: lines[i].trim().slice(0, 200) });
          if (hits.length >= 200) break;
        }
      }
      if (hits.length >= 200) break;
    }
    json(res, 200, { root, query: q, count: hits.length, hits });
    return;
  }

  res.writeHead(404, CORS).end("no such route");
});

/* launchd can own the port and hand us the socket the moment something connects. */
const fromLaunchd = !!(process.env.LAUNCH_JOB_LABEL || process.env.ABYSS_FROM_LAUNCHD) && process.env.ABYSS_NO_FD !== "1";

/* launchd hands us the listening socket, but not always on fd 3 — find it. */
function launchdSocketFd() {
  const wanted = Number(process.env.ABYSS_SOCKET_FD || 0);
  const tryFd = (n) => {
    try {
      const st = statSync("/dev/fd/" + n);
      return (st.mode & 0o170000) === 0o140000 ? n : 0; /* S_IFSOCK */
    } catch {
      return 0;
    }
  };
  if (wanted) return tryFd(wanted);
  const seen = [];
  for (let n = 0; n <= 32; n++) {
    try {
      const st = statSync("/dev/fd/" + n);
      const kind = (st.mode & 0o170000) === 0o140000 ? "socket" : (st.mode & 0o170000) === 0o020000 ? "char" : "file";
      seen.push(n + ":" + kind);
      if (kind === "socket") {
        console.log("launchd fds: " + seen.join(" "));
        return n;
      }
    } catch {}
  }
  console.log("launchd fds: " + seen.join(" "));
  return 0;
}
/* If another copy already holds the port, wait and try again rather than dying —
   launchd would otherwise restart us in a tight loop and fill the log. */
let retry = 0;
server.on("error", (err) => {
  const msg = String(err.message || err);
  if (/EADDRINUSE/.test(msg)) {
    retry++;
    if (retry === 1) logRun("waiting-for-port", "another copy holds " + PORT);
    else if (retry % 12 === 0) console.error("still waiting for port " + PORT + " (attempt " + retry + ")");
    setTimeout(() => {
      try {
        server.close(() => server.listen(PORT, "127.0.0.1", banner));
      } catch {
        server.listen(PORT, "127.0.0.1", banner);
      }
    }, 10000);
    return;
  }
  console.error("listen failed:", msg);
  process.exit(1);
});

const banner = () => {
  logRun("started", "port " + PORT + (IDLE_EXIT ? " idle-exit=" + IDLE_EXIT + "s" : ""));
  console.log(`abyss-bridge on http://127.0.0.1:${PORT}${IDLE_EXIT ? ` (stops after ${IDLE_EXIT}s of quiet)` : ""}`);
  console.log(`  page:  ${PAGE}${existsSync(PAGE) ? "" : "  (missing — build it first)"}`);
  console.log(`  room:  ${existsSync(BRIDGE) ? BRIDGE : "bridge not found: " + BRIDGE}  as "${HARNESS}"`);
  console.log(`  mcp:   http://127.0.0.1:${PORT}/mcp`);
};

if (fromLaunchd) {
  const fd = launchdSocketFd();
  if (fd) {
    console.log("adopting launchd's socket on fd " + fd);
    server.once("listening", banner);
    server.listen({ fd });
  } else {
    console.error("no launchd socket found among fds 3..32 — listening on the port myself");
    server.listen(PORT, "127.0.0.1", banner);
  }
} else {
  server.listen(PORT, "127.0.0.1", banner);
}

/* When the page has been gone for a while, let the heavy part go: the room bridge
   child, its TLS connections and its MCP sessions. The listener itself stays, so the
   next visit is instant and needs no command. */
const RELEASE_AFTER = Number(flag("--release-after", process.env.ABYSS_RELEASE_AFTER || 75));
setInterval(() => {
  const quiet = (Date.now() - lastHeard) / 1000;
  if (room.child && busy === 0 && quiet > RELEASE_AFTER) {
    logRun("released-room-bridge", "quiet for " + Math.round(quiet) + "s");
    try {
      room.child.kill();
    } catch {}
    room.child = null;
    room.ready = false;
    room.tools = null;
    room._catalog = null;
  }
}, 5000);

if (IDLE_EXIT > 0) {
  setInterval(() => {
    const quietFor = (Date.now() - lastHeard) / 1000;
    if (busy === 0 && quietFor > IDLE_EXIT) {
      console.log(`nothing heard for ${Math.round(quietFor)}s — stopping (launchd will wake me on the next visit)`);
      bye();
    }
  }, 5000);
}

const bye = () => {
  if (room.child) room.child.kill();
  server.close();
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
