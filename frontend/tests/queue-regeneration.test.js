import assert from "node:assert/strict";
import test from "node:test";
import { regenerationCascade, regenerationView } from "../src/queueRegeneration.js";

const project = {
  id: "p1",
  title: "Horror Anime 1min",
  status: "queued",
  current_take: 5,
  takes: [
    { n: 5, title: "Take 5" },
    { n: 6, title: "Take 6" },
  ],
  stats: { partial_cascade: [5, 6], partial_from_take: 5 },
  runner_state: { completed: [1, 2, 3, 4, 7, 8, 9, 10, 11, 12], partial_regen_cascade: [5, 6] },
  progress: { completed: 10, total: 12, completed_ns: [1, 2, 3, 4, 7, 8, 9, 10, 11, 12] },
};

test("regenerationCascade reads partial cascade", () => {
  assert.deepEqual(regenerationCascade(project), [5, 6]);
  assert.equal(regenerationCascade({ stats: {} }), null);
});

test("regenerationView splits queued chain without whole-video progress", () => {
  const view = regenerationView(project);
  assert.equal(view.total, 2);
  assert.equal(view.completed, 0);
  assert.equal(view.from, 5);
  assert.deepEqual(
    view.rows.map((r) => [r.n, r.state]),
    [
      [5, "queued"],
      [6, "dependent"],
    ]
  );
});

test("regenerationView marks active take as generating", () => {
  const view = regenerationView(project, { active: true, currentTake: 5, estimate: { project_id: "p1", take: 5, pct: 42 } });
  assert.equal(view.rows[0].state, "generating");
  assert.equal(view.rows[0].percent, 42);
  assert.equal(view.rows[1].state, "dependent");
});
