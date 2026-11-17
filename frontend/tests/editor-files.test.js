import assert from "node:assert/strict";
import test from "node:test";
import { takeSelectedFiles } from "../src/editorFiles.js";

function fakeInput(names) {
  // Mimic a live FileList: clearing value empties the same array object.
  const files = names.map((name) => ({ name, size: 1 }));
  const input = {
    files,
    set value(v) {
      if (v === "") files.splice(0, files.length);
    },
  };
  return input;
}

test("takeSelectedFiles copies FileList before clearing the input", () => {
  const input = fakeInput(["bed.mp3", "fx.wav"]);
  const files = takeSelectedFiles(input);
  assert.equal(files.length, 2);
  assert.equal(files[0].name, "bed.mp3");
  assert.equal(input.files.length, 0);
});

test("live FileList cleared before copy loses the selection", () => {
  const input = fakeInput(["bed.mp3"]);
  const live = input.files;
  input.value = "";
  assert.equal(live.length, 0);
});
