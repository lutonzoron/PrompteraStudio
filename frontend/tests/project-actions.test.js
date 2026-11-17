import test from "node:test";
import assert from "node:assert/strict";
import { runProjectAction } from "../src/projectActions.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("three rapid clicks send only one action, including across different controls", async () => {
  const response = deferred();
  let requests = 0;
  const action = async () => { requests++; await response.promise; };
  const first = runProjectAction("same-video", "Enfileirando", action);
  const second = runProjectAction("same-video", "Menu da fila", action);
  const third = runProjectAction("same-video", "Página do vídeo", action);
  assert.equal(requests, 1);
  assert.equal(await second, false);
  assert.equal(await third, false);
  response.resolve();
  assert.equal(await first, true);
});

test("the lock remains until the screen refresh finishes", async () => {
  const response = deferred();
  const refresh = deferred();
  const refreshing = deferred();
  let duplicateRequests = 0;
  const first = runProjectAction("refresh-video", "Atualizando", async () => {
    await response.promise;
    refreshing.resolve();
    await refresh.promise;
  });
  response.resolve();
  await refreshing.promise;
  assert.equal(await runProjectAction("refresh-video", "Repetido", () => { duplicateRequests++; }), false);
  assert.equal(duplicateRequests, 0);
  refresh.resolve();
  await first;
  assert.equal(await runProjectAction("refresh-video", "Próxima ação", async () => {}), true);
});

test("a failed action releases its lock for a deliberate retry", async () => {
  await assert.rejects(runProjectAction("failed-video", "Falhando", async () => {
    throw new Error("Network failure");
  }), /Network failure/);
  let requests = 0;
  assert.equal(await runProjectAction("failed-video", "Tentar novamente", async () => { requests++; }), true);
  assert.equal(requests, 1);
});

test("actions on independent videos can proceed without duplicating either", async () => {
  const response = deferred();
  let requests = 0;
  const action = async () => { requests++; await response.promise; };
  const first = runProjectAction("video-a", "Primeiro", action);
  const second = runProjectAction("video-b", "Segundo", action);
  assert.equal(requests, 2);
  response.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});
