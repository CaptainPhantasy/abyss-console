/* The patch matcher, checked where it lives: hunks apply exactly, tolerate a small
   drift or trailing whitespace, and are never forced — a hunk that does not fit is
   reported with what was expected and what is there instead.

     node --test tests/diff.unit.mjs
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const bridge = readFileSync(join(here, "..", "abyss-bridge.mjs"), "utf8");
const source = bridge.slice(bridge.indexOf("function hunkMatchAt"), bridge.indexOf("function undoLast"));
const ctx = vm.createContext({});
vm.runInContext(source + "\nglobalThis.applyHunks = applyHunks;", ctx);
const apply = ctx.applyHunks;

test("an exact hunk applies in place", () => {
  const before = "a\nb\nc\n";
  const hunks = [{ from: 1, lines: [" a", "-b", "+B", " c"] }];
  const r = apply(before, hunks);
  assert.equal(r.text, "a\nB\nc\n");
  assert.equal(r.report[0].conflict, false);
  assert.equal(r.report[0].how, "exact");
});

test("a hunk the file has drifted away from still lands, and says where", () => {
  const before = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n";
  /* the diff thinks it is at line 2, but the matching content now sits at line 5 */
  const hunks = [{ from: 2, lines: [" five", "-six", "+SIX", " seven"] }];
  const r = apply(before, hunks);
  assert.equal(r.report[0].conflict, false);
  assert.match(r.report[0].how, /moved down 3 line\(s\)/);
  assert.match(r.text, /five\nSIX\nseven/);
});

test("trailing whitespace on a context line does not stop a hunk", () => {
  const before = "a   \nb\nc\n";
  const hunks = [{ from: 1, lines: [" a", "-b", "+B", " c"] }];
  const r = apply(before, hunks);
  assert.equal(r.report[0].conflict, false);
  assert.match(r.report[0].how, /whitespace-tolerant/);
  assert.match(r.text, /^a   \nB\nc/);
});

test("a hunk that does not fit anywhere near is refused, not forced", () => {
  const before = "a\nb\nc\n";
  const hunks = [{ from: 1, lines: [" totally", "-different", "+content"] }];
  const r = apply(before, hunks);
  assert.equal(r.report[0].conflict, true);
  assert.match(r.report[0].why, /no exact or nearby match/);
  assert.deepEqual([...r.report[0].expected], ["totally", "different"]);
  assert.deepEqual([...r.report[0].found], ["a", "b", "c"]);
  assert.equal(r.text, before, "the file is left as it was");
});

test("a conflict does not poison a hunk that does fit", () => {
  const before = "a\nb\nc\nd\n";
  const hunks = [
    { from: 1, lines: [" a", "-b", "+B"] },
    { from: 2, lines: [" nope", "-nothing", "+here"] },
  ];
  const r = apply(before, hunks);
  assert.equal(r.report[0].conflict, false);
  assert.equal(r.report[1].conflict, true);
  assert.match(r.text, /^a\nB/);
});

test("a pure insert lands where the diff asked, even with no context", () => {
  const before = "a\nb\n";
  const hunks = [{ from: 2, lines: ["+inserted"] }];
  const r = apply(before, hunks);
  assert.equal(r.report[0].conflict, false);
  assert.equal(r.text, "a\ninserted\nb\n");
});
