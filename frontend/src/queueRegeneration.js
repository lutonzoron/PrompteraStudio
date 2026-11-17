// Only the affected Continuity chain contributes to regeneration progress.

export function regenerationCascade(project) {
  const raw = project?.stats?.partial_cascade || project?.runner_state?.partial_regen_cascade;
  if (!Array.isArray(raw) || !raw.length) return null;
  const ns = [...new Set(raw.map(Number))].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  return ns.length ? ns : null;
}

export function regenerationView(project, { active = false, currentTake, estimate } = {}) {
  const ns = regenerationCascade(project);
  if (!ns) return null;
  const takes = new Map((project.takes || []).map((take) => [Number(take.n), take]));
  const done = new Set((project.progress?.completed_ns || project.runner_state?.completed || []).map(Number));
  const next = ns.find((n) => !done.has(n));
  const candidate = Number(currentTake ?? project.current_take);
  const current = active ? (ns.includes(candidate) && !done.has(candidate) ? candidate : next) : null;
  return {
    completed: ns.filter((n) => done.has(n)).length,
    total: ns.length,
    from: Number(project?.stats?.partial_from_take || project?.runner_state?.partial_regen_from || ns[0]),
    rows: ns.map((n, index) => {
      const state = done.has(n)
        ? "done"
        : n === current
          ? project.status === "paused"
            ? "paused"
            : project.status === "awaiting_review"
              ? "review"
              : "generating"
          : index === 0 || done.has(ns[index - 1])
            ? "queued"
            : "dependent";
      const measured =
        estimate?.project_id === project.id &&
        Number(estimate.take) === n &&
        Number.isFinite(estimate.pct);
      return {
        n,
        title: takes.get(n)?.title || "",
        state,
        percent:
          state === "done"
            ? 100
            : state === "generating" && measured
              ? Math.max(0, Math.min(99, estimate.pct))
              : null,
      };
    }),
  };
}
