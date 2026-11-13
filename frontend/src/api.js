async function req(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.detail || data?.error || data?.message || res.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

export const api = {
  health: () => req("/api/health"),
  onboarding: () => req("/api/onboarding"),
  hardware: () => req("/api/hardware"),
  machine: () => req("/api/machine"),
  patchMachine: (body) => req("/api/machine", { method: "PATCH", body: JSON.stringify(body) }),
  getLlm: () => req("/api/llm"),
  putLlm: (body) => req("/api/llm", { method: "PUT", body: JSON.stringify(body) }),
  testLlm: (body) => req("/api/llm/test", { method: "POST", body: JSON.stringify(body || {}) }),
  comfyStatus: () => req("/api/comfy/status"),
  comfyStart: () => req("/api/comfy/start", { method: "POST" }),
  comfyClone: () => req("/api/comfy/clone", { method: "POST" }),
  dasiwa: () => req("/api/comfy/dasiwa", { method: "POST" }),
  workflows: () => req("/api/comfy/workflows", { method: "POST" }),
  comfyDeps: () => req("/api/comfy/deps"),
  comfyEnsure: (download_sfw = false) =>
    req(`/api/comfy/ensure?download_sfw=${download_sfw ? "true" : "false"}`, {
      method: "POST",
    }),
  downloadModel: (key) => req(`/api/comfy/models/${encodeURIComponent(key)}/download`, { method: "POST" }),
  setComfyRoot: (path) =>
    req("/api/settings/comfyui_root", { method: "PUT", body: JSON.stringify({ path }) }),

  styles: () => req("/api/styles"),
  adaptStyle: (body) => req("/api/styles/adapt", { method: "POST", body: JSON.stringify(body) }),
  patchStyle: (id, body) =>
    req(`/api/styles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  dupStyle: (id) => req(`/api/styles/${id}/duplicate`, { method: "POST" }),
  archiveStyle: (id) => req(`/api/styles/${id}`, { method: "DELETE" }),

  projects: (includeArchived = false) =>
    req(`/api/projects?include_archived=${includeArchived ? "true" : "false"}`),
  project: (id) => req(`/api/projects/${id}`),
  createProject: (body) => req("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  patchProject: (id, body) =>
    req(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteProject: (id, hard = false) =>
    req(`/api/projects/${id}?hard=${hard ? "true" : "false"}`, { method: "DELETE" }),
  restoreProject: (id) => req(`/api/projects/${id}/restore`, { method: "POST" }),
  dice: (model_pack = "sfw") => req(`/api/projects/dice?model_pack=${model_pack}`, { method: "POST" }),
  generateStory: (id, body) =>
    req(`/api/projects/${id}/generate-story`, { method: "POST", body: JSON.stringify(body) }),
  enqueue: (id) => req(`/api/projects/${id}/enqueue`, { method: "POST" }),
  dequeue: (id) => req(`/api/projects/${id}/dequeue`, { method: "POST" }),
  comfyInterrupt: () => req("/api/comfy/interrupt", { method: "POST" }),
  buildMaster: (id, force = true) =>
    req(`/api/projects/${id}/build-master?force=${force ? "true" : "false"}`, {
      method: "POST",
    }),
  review: (id, decision) =>
    req(`/api/projects/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),

  queue: () => req("/api/queue"),
  reorder: (project_ids) =>
    req("/api/queue/reorder", { method: "POST", body: JSON.stringify({ project_ids }) }),
  pause: () => req("/api/worker/pause", { method: "POST" }),
  resume: () => req("/api/worker/resume", { method: "POST" }),
  externalSync: () => req("/api/external/sync", { method: "POST" }),
  estimate: (takes) => req(`/api/estimate?takes=${takes}`),

  inbox: () => req("/api/inbox"),
  inboxScan: () => req("/api/inbox/scan", { method: "POST" }),
  importPath: (body) =>
    req("/api/inbox/import-path", { method: "POST", body: JSON.stringify(body) }),

  mediaUrl: (absPath) => `/api/media?path=${encodeURIComponent(absPath)}`,
  posterUrl: (id) => `/api/projects/${id}/poster`,
};
