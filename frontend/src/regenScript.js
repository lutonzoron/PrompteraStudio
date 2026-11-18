/** How many takes the regen modal may ask for. */
export function maxTakeCount(currentCount, maxDurationSec) {
  const seconds = Number(maxDurationSec);
  const durationCap = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds / 2) : 1;
  const cap = Math.min(40, Math.max(1, durationCap));
  return Math.max(cap, Number(currentCount) || 0, 1);
}

/** Body for POST /generate-story. take_count 0 means the form is not ready. */
export function scriptRegenPayload({ mode, notes, count, rows, additions, maxCount = 40 }) {
  const note = String(notes || "").trim();
  const ceiling = Math.max(1, Math.min(40, Number(maxCount) || 40));
  if (mode !== "revise") {
    const raw = Number(count);
    const take_count = Math.max(1, Math.min(ceiling, Number.isFinite(raw) ? raw : 1));
    return { revise: false, notes: note, take_count, drop_takes: [], add_takes: [] };
  }
  const drop_takes = (rows || []).filter((row) => !row.kept).map((row) => Number(row.n));
  const add_takes = (additions || []).map((item) => ({
    after: item.after == null || item.after === "" ? null : Number(item.after),
    note: String(item.note || "").trim(),
  }));
  const kept = (rows || []).filter((row) => row.kept).length;
  return {
    revise: true,
    notes: note,
    take_count: kept + add_takes.length,
    drop_takes,
    add_takes,
  };
}
