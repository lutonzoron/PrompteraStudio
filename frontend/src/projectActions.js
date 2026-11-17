import { useSyncExternalStore } from "react";

let pending = new Map();
const listeners = new Set();
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => pending;
const publish = () => listeners.forEach((listener) => listener());

export async function runProjectAction(projectId, label, action) {
  // Synchronous acquisition also blocks clicks arriving before React renders again.
  if (pending.has(projectId)) return false;
  pending = new Map(pending).set(projectId, label);
  publish();
  try {
    await action();
    return true;
  } finally {
    pending = new Map(pending);
    pending.delete(projectId);
    publish();
  }
}

export function useProjectActions() {
  return useSyncExternalStore(subscribe, snapshot);
}
