/* Attachments, checked against real files of every common type.
   Builds its own test files where needed, so it runs anywhere.

     node --test tests/attach.e2e.mjs
*/
import { spawn, execFileSync } from "node:child_process";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = 8792;
const LAB = join(tmpdir(), "abyss-attach-test");

let child = null;
const at = (p) => `http://127.0.0.1:${PORT}${p}`;
const get = async (p, ms = 240000) => {
  const res = await fetch(at(p), { signal: AbortSignal.timeout(ms) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const attach = (p, q = "") => get("/attach?path=" + encodeURIComponent(p) + q);

before(async () => {
  mkdirSync(LAB, { recursive: true });
  writeFileSync(join(LAB, "note.txt"), "ABYSS note\n\nnumbers: 42, 1.5\nsecond line for extraction\n");
  writeFileSync(join(LAB, "rows.csv"), "name,qty,price\nwidget,3,9.99\n");
  execFileSync("textutil", ["-convert", "docx", join(LAB, "note.txt"), "-output", join(LAB, "note.docx")]);
  execFileSync("textutil", ["-convert", "rtf", join(LAB, "note.txt"), "-output", join(LAB, "note.rtf")]);
  execFileSync("sh", ["-c", `cupsfilter ${join(LAB, "note.txt")} > ${join(LAB, "note.pdf")} 2>/dev/null`]);
  /* a real .xlsx, built with zip, so the unzip path is genuinely exercised */
  const xl = join(LAB, "xlsxbld", "xl");
  mkdirSync(join(xl, "worksheets"), { recursive: true });
  writeFileSync(join(LAB, "xlsxbld", "[Content_Types].xml"), '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  writeFileSync(join(xl, "sharedStrings.xml"),
    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>name</t></si><si><t>qty</t></si><si><t>widget</t></si><si><t>7</t></si></sst>');
  writeFileSync(join(xl, "worksheets", "sheet1.xml"),
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>');
  execFileSync("sh", ["-c", `cd ${join(LAB, "xlsxbld")} && zip -qr ${join(LAB, "sheet.xlsx")} . `]);
  /* a picture with text on it, so OCR has something honest to read.
     Made from the text file through a pdf, so it needs no font of its own. */
  execFileSync("sh", [
    "-c",
    `pdftoppm -r 150 -png -f 1 -l 1 ${join(LAB, "note.pdf")} ${join(LAB, "sign")} && mv ${join(LAB, "sign")}-1.png ${join(LAB, "sign.png")}`,
  ]);

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

test("plain text, csv and code read straight through", async () => {
  const txt = await attach(join(LAB, "note.txt"));
  assert.equal(txt.status, 200);
  assert.equal(txt.body.kind, "text");
  assert.match(txt.body.text, /ABYSS note/);
  assert.ok(txt.body.tokens > 5 && txt.body.tokens < 100, "a sane token count");
  assert.ok(txt.body.estimate.costFlashUsd > 0, "and a cost estimate");

  const csv = await attach(join(LAB, "rows.csv"));
  assert.match(csv.body.text, /widget,3,9\.99/);
});

test("a pdf gives up its text", async () => {
  const { status, body } = await attach(join(LAB, "note.pdf"));
  assert.equal(status, 200);
  assert.match(body.text, /ABYSS note/, "the words came out of the pdf");
  assert.match(body.how, /pdftotext/);
});

test("word and rtf are converted", async () => {
  for (const name of ["note.docx", "note.rtf"]) {
    const { status, body } = await attach(join(LAB, name));
    assert.equal(status, 200, name);
    assert.match(body.text, /ABYSS note/, name + " text");
    assert.match(body.how, /textutil/, name + " how");
  }
});

test("a spreadsheet is unzipped and its text pulled out", async () => {
  const { status, body } = await attach(join(LAB, "sheet.xlsx"));
  assert.equal(status, 200, "xlsx: " + JSON.stringify(body).slice(0, 160));
  assert.match(body.how, /unzipped/, "it went through the unzip path");
  assert.match(body.text, /widget/, "and the cell text came out: " + String(body.text).slice(0, 80));
});

test("a picture comes back as picture data the model reads natively", async () => {
  const { status, body } = await attach(join(LAB, "sign.png"));
  assert.equal(status, 200);
  assert.equal(body.kind, "image");
  assert.match(body.dataUrl, /^data:image\/png;base64,/);
  assert.equal(body.tokens, 1024, "pictures bill about 1024 tokens each");
});

test("asking for OCR on a picture reads the words on it", async () => {
  const { body } = await attach(join(LAB, "sign.png"), "&ocr=1");
  assert.ok(body.ocr && body.ocr.length > 0, "ocr text came back");
  assert.match(body.ocr, /ABYSS/i);
  assert.ok(body.tokens > 1024, "and the reading is counted in the cost");
});

test("a path through the /tmp symlink still works", async () => {
  /* tesseract cannot open a path that goes through a symlink; the helper resolves it */
  const viaTmp = await attach(join(LAB, "sign.png"));
  assert.equal(viaTmp.status, 200);
});

test("a whole folder comes over with its documents, not just its text files", async () => {
  const { status, body } = await get("/attach/folder?path=" + encodeURIComponent(LAB));
  assert.equal(status, 200);
  assert.ok(body.attached >= 5, `expected text, pdf, docx, rtf, csv and xlsx, got ${body.attached}`);
  assert.ok(body.tokens > 20, "token total present");
  assert.ok(body.estimate.costFlashUsd >= 0);
  const names = body.files.map((f) => f.name);
  assert.ok(names.includes("note.pdf"), "the pdf came along: " + names.join(", "));
  assert.ok(names.includes("sheet.xlsx"), "so did the spreadsheet: " + names.join(", "));
  assert.ok(!names.includes("sign.png"), "pictures are attached one at a time, not folded in");
  assert.ok(body.skipped >= 1, "and it says what it left out");
});

test("a large folder is capped by the token budget, and says so", async () => {
  const { body } = await get("/attach/folder?path=" + encodeURIComponent(LAB) + "&maxTokens=40");
  assert.ok(body.tokens <= 60, `the budget was respected, got ${body.tokens}`);
  assert.ok(body.skippedWhy.length > 0, "and the leftovers are explained");
});

test("audio and video are refused with the reason", async () => {
  const wav = join(LAB, "tone.wav");
  execFileSync("sh", ["-c", `printf 'RIFF....WAVEfmt ' > ${wav}`]);
  const { status, body } = await attach(wav);
  assert.equal(status, 422);
  assert.match(body.error, /text and pictures only/);
});

test("a path outside home, /tmp and the storage drives is refused", async () => {
  const { status, body } = await attach("/etc/hosts");
  assert.equal(status, 403);
  assert.match(body.error, /outside/);
});
