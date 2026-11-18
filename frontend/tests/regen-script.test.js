import test from "node:test";
import assert from "node:assert/strict";
import { maxTakeCount, scriptRegenPayload } from "../src/regenScript.js";

test("take ceiling follows duration and never drops below the current list", () => {
  assert.equal(maxTakeCount(4, 60), 30);
  assert.equal(maxTakeCount(36, 20), 36);
  assert.equal(maxTakeCount(0, 0), 1);
});

test("revise payload keeps drops, inserts, and the resulting count", () => {
  const body = scriptRegenPayload({
    mode: "revise",
    notes: "  final mais curto  ",
    rows: [
      { n: 1, kept: true },
      { n: 2, kept: false },
      { n: 3, kept: true },
    ],
    additions: [
      { after: 1, note: " fecha o portão " },
      { after: null, note: "" },
    ],
    maxCount: 30,
  });
  assert.deepEqual(body, {
    revise: true,
    notes: "final mais curto",
    take_count: 4,
    drop_takes: [2],
    add_takes: [
      { after: 1, note: "fecha o portão" },
      { after: null, note: "" },
    ],
  });
});

test("rewrite payload ignores the old take list and clamps the count", () => {
  const body = scriptRegenPayload({
    mode: "rewrite",
    notes: "",
    count: 99,
    rows: [{ n: 1, kept: false }],
    additions: [{ after: 1, note: "ignorado" }],
    maxCount: 8,
  });
  assert.equal(body.revise, false);
  assert.equal(body.take_count, 8);
  assert.deepEqual(body.drop_takes, []);
  assert.deepEqual(body.add_takes, []);
});
