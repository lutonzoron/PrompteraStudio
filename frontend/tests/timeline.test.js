import assert from "node:assert/strict";
import test from "node:test";
import { generatedTimeline, groupTimelineDays } from "../src/timeline.js";

test("editing or regenerating an older video never moves it ahead of a newer project", () => {
  const old = { id: "old", has_master: true, created_at: 100, updated_at: 9999 };
  const newer = { id: "new", has_master: true, created_at: 200, updated_at: 200 };
  const projects = [old, newer];
  assert.deepEqual(generatedTimeline(projects).map((p) => p.id), ["new", "old"]);
  assert.deepEqual(projects.map((p) => p.id), ["old", "new"]);
});
test("archived generated videos remain visible, unfinished or missing masters do not", () => {
  const projects = [
    { id: "archived", status: "archived", has_master: true, created_at: 100 },
    { id: "done", status: "done", has_master: true, created_at: 200 },
    { id: "partial", status: "generating", has_master: false, created_at: 300 },
    { id: "missing", status: "done", has_master: false, created_at: 400 },
  ];
  assert.deepEqual(generatedTimeline(projects).map((p) => p.id), ["done", "archived"]);
});
test("search matches Portuguese accents and slugs without changing chronological order", () => {
  const projects = [
    { id: "a", title: "A avó", slug: "vo_01", has_master: true, created_at: 1 },
    { id: "b", title: "Visita à avó", slug: "vo_02", has_master: true, created_at: 2 },
  ];
  assert.deepEqual(generatedTimeline(projects, " AVO ").map((p) => p.id), ["b", "a"]);
  assert.deepEqual(generatedTimeline(projects, "vo_01").map((p) => p.id), ["a"]);
  assert.deepEqual(generatedTimeline(projects, "missing"), []);
});
test("category and reviewed filters can be combined without changing chronological order", () => {
  const projects = [
    { id: "g1", category: "general", reviewed: true, has_master: true, created_at: 1 },
    { id: "f1", category: "footage", reviewed: false, has_master: true, created_at: 2 },
    { id: "g2", category: "general", reviewed: false, has_master: true, created_at: 3 },
    { id: "f2", category: "footage", reviewed: true, has_master: true, created_at: 4 },
  ];
  assert.deepEqual(generatedTimeline(projects, "", { category: "footage" }).map((p) => p.id), ["f2", "f1"]);
  assert.deepEqual(generatedTimeline(projects, "", { reviewed: "reviewed" }).map((p) => p.id), ["f2", "g1"]);
  assert.deepEqual(generatedTimeline(projects, "", { reviewed: "unreviewed" }).map((p) => p.id), ["g2", "f1"]);
  assert.deepEqual(
    generatedTimeline(projects, "", { category: "general", reviewed: "unreviewed" }).map((p) => p.id),
    ["g2"],
  );
});
test("pagination can extend the same day group and older days keep chronological sequence", () => {
  const day = new Date(2026, 10, 18, 12).getTime() / 1000;
  const projects = generatedTimeline([
    { id: "first", has_master: true, created_at: day },
    { id: "second", has_master: true, created_at: day - 60 },
    { id: "yesterday", has_master: true, created_at: day - 86400 },
  ]);
  const groups = groupTimelineDays(projects);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].projects.map((p) => p.id), ["first", "second"]);
  assert.equal(groups[1].projects[0].id, "yesterday");
  assert.equal(groupTimelineDays(projects.slice(0, 1))[0].key, groups[0].key);
});
test("empty history, missing dates and equal timestamps are stable", () => {
  assert.deepEqual(generatedTimeline(null), []);
  const projects = generatedTimeline([
    { id: "b", has_master: true }, { id: "a", has_master: true },
  ]);
  assert.deepEqual(projects.map((p) => p.id), ["a", "b"]);
  assert.equal(groupTimelineDays(projects)[0].key, "unknown");
});
