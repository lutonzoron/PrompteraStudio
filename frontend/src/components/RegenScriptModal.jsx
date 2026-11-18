import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/index.jsx";
import { summarizeTakePrompt } from "../utils.js";
import { maxTakeCount, scriptRegenPayload } from "../regenScript.js";

function takeLabel(take) {
  const title = String(take?.title || "").trim();
  if (title) return title;
  const action = summarizeTakePrompt(take?.prompt).action;
  return action || "";
}

function snapshot(project) {
  const takes = Array.isArray(project?.takes) ? project.takes : [];
  const footage = project?.category === "footage";
  return {
    mode: takes.length ? "revise" : "rewrite",
    notes: "",
    count: Math.max(1, takes.length || (footage ? 1 : 4)),
    rows: takes.map((take) => ({
      n: Number(take.n),
      title: takeLabel(take),
      kind: take.kind === "continue" ? "continue" : "new",
      duration: Number(take.duration) || (footage ? 9 : 5),
      kept: true,
    })),
    additions: [],
  };
}

export default function RegenScriptModal({
  open,
  project,
  busy = false,
  revisionAvailable = false,
  onClose,
  onSubmit,
}) {
  const t = useT();
  const [mode, setMode] = useState("revise");
  const [notes, setNotes] = useState("");
  const [count, setCount] = useState(1);
  const [rows, setRows] = useState([]);
  const [additions, setAdditions] = useState([]);
  const sessionKey = open ? String(project?.id || "") : "";
  const [loadedKey, setLoadedKey] = useState("");
  if (sessionKey !== loadedKey) {
    setLoadedKey(sessionKey);
    if (sessionKey) {
      const next = snapshot(project);
      setMode(next.mode);
      setNotes(next.notes);
      setCount(next.count);
      setRows(next.rows);
      setAdditions(next.additions);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const ceiling = maxTakeCount(rows.length, project?.max_duration_sec);
  const keptRows = rows.filter((row) => row.kept);
  const total = mode === "revise" ? keptRows.length + additions.length : count;
  const ready = total >= 1 && total <= ceiling;

  const durationWarn = useMemo(() => {
    const maxSec = Number(project?.max_duration_sec) || 60;
    const keptSec = keptRows.reduce((sum, row) => sum + (Number(row.duration) || 5), 0);
    const projected = mode === "revise" ? keptSec + additions.length * 5 : count * 5;
    return projected > maxSec + 0.05 ? Math.round(maxSec) : null;
  }, [project?.max_duration_sec, keptRows, additions.length, mode, count]);

  if (!open) return null;

  function switchMode(next) {
    setMode(next);
    if (next === "rewrite") {
      const planned = rows.filter((row) => row.kept).length + additions.length;
      setCount(Math.max(1, Math.min(ceiling, planned || rows.length || 1)));
    }
  }

  function toggleRow(n) {
    const row = rows.find((item) => item.n === n);
    const willKeep = row ? !row.kept : true;
    setRows((list) => list.map((item) => (item.n === n ? { ...item, kept: !item.kept } : item)));
    if (!willKeep) {
      setAdditions((list) => list.map((item) => (item.after === n ? { ...item, after: null } : item)));
    }
  }

  function addTake() {
    if (keptRows.length + additions.length >= ceiling) return;
    const anchor = keptRows.length ? keptRows[keptRows.length - 1].n : null;
    setAdditions((list) => [
      ...list,
      { id: `add_${Date.now()}_${list.length}`, after: anchor, note: "" },
    ]);
  }

  function submit() {
    if (!ready || busy) return;
    onSubmit(scriptRegenPayload({ mode, notes, count, rows, additions, maxCount: ceiling }));
  }

  const footageMulti = project?.category === "footage" && total > 1;
  const delta = count - rows.length;

  return createPortal(
    <div className="confirm-backdrop" onClick={() => { if (!busy) onClose(); }} role="presentation">
      <div
        className="confirm-dialog regen-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="regen-script-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="regen-modal-body">
          <h3 id="regen-script-title">{t("project.regenScriptTitle")}</h3>
          <p className="confirm-msg">{t("project.regenScriptHint")}</p>

          {rows.length ? (
            <div className="seg regen-mode" role="group" aria-label={t("project.regenScriptTitle")}>
              <button type="button" className={mode === "revise" ? "on" : ""} onClick={() => switchMode("revise")}>
                {t("project.regenModeRevise")}
              </button>
              <button type="button" className={mode === "rewrite" ? "on" : ""} onClick={() => switchMode("rewrite")}>
                {t("project.regenModeRewrite")}
              </button>
            </div>
          ) : null}

          {mode === "revise" && rows.length ? (
            <div className="regen-take-list">
              {rows.map((row) => (
                <div key={row.n} className={`regen-take-row ${row.kept ? "" : "is-dropped"}`}>
                  <span className="regen-take-n">{String(row.n).padStart(2, "0")}</span>
                  <span className="regen-take-name">
                    {row.title || t("project.takeLabel", { n: row.n })}
                    <small>
                      {row.kind === "continue" ? t("project.regenKindContinue") : t("project.regenKindNew")}
                      {" · "}
                      {Math.round(row.duration)}s
                    </small>
                  </span>
                  <button type="button" className="regen-take-toggle" onClick={() => toggleRow(row.n)} disabled={busy}>
                    {row.kept ? t("project.regenTakeDrop") : t("project.regenTakeKeep")}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="field">
              <label htmlFor="regen-take-count">{t("project.regenRewriteCount")}</label>
              <div className="regen-stepper">
                <button
                  type="button"
                  aria-label={t("project.regenTakeDrop")}
                  disabled={busy || count <= 1}
                  onClick={() => setCount((value) => Math.max(1, value - 1))}
                >
                  −
                </button>
                <input
                  id="regen-take-count"
                  type="number"
                  min={1}
                  max={ceiling}
                  value={count}
                  disabled={busy}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) return;
                    setCount(Math.max(1, Math.min(ceiling, next)));
                  }}
                />
                <button
                  type="button"
                  aria-label={t("project.regenAddTake")}
                  disabled={busy || count >= ceiling}
                  onClick={() => setCount((value) => Math.min(ceiling, value + 1))}
                >
                  +
                </button>
              </div>
              <p className="muted regen-hint">
                {rows.length
                  ? delta === 0
                    ? t("project.regenSameCount", { n: rows.length })
                    : delta > 0
                      ? t("project.regenAddCount", { n: delta })
                      : t("project.regenRemoveCount", { n: Math.abs(delta) })
                  : t("project.regenTargetCount", { n: count })}
              </p>
            </div>
          )}

          {mode === "revise" ? (
            <>
              {additions.map((item) => (
                <div key={item.id} className="regen-add">
                  <div className="regen-add-top">
                    <strong>{t("project.regenNewTake")}</strong>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setAdditions((list) => list.filter((row) => row.id !== item.id))}
                    >
                      {t("project.regenRemoveAdded")}
                    </button>
                  </div>
                  <div className="field">
                    <label htmlFor={`regen-after-${item.id}`}>{t("project.regenAfter")}</label>
                    <select
                      id={`regen-after-${item.id}`}
                      value={item.after == null ? "" : String(item.after)}
                      disabled={busy}
                      onChange={(event) => {
                        const value = event.target.value;
                        const after = value === "" ? null : Number(value);
                        setAdditions((list) => list.map((row) => (row.id === item.id ? { ...row, after } : row)));
                      }}
                    >
                      <option value="0">{t("project.regenAfterStart")}</option>
                      {keptRows.map((row) => (
                        <option key={row.n} value={row.n}>
                          {t("project.regenAfterTake", { n: row.n })}
                        </option>
                      ))}
                      <option value="">{t("project.regenAfterEnd")}</option>
                    </select>
                  </div>
                  <input
                    value={item.note}
                    disabled={busy}
                    placeholder={t("project.regenNewTakePlaceholder")}
                    onChange={(event) => {
                      const note = event.target.value;
                      setAdditions((list) => list.map((row) => (row.id === item.id ? { ...row, note } : row)));
                    }}
                  />
                </div>
              ))}
              <button type="button" disabled={busy || keptRows.length + additions.length >= ceiling} onClick={addTake}>
                {t("project.regenAddTake")}
              </button>
            </>
          ) : null}

          <div className="field">
            <label htmlFor="regen-notes">{t("project.regenNotesLabel")}</label>
            <textarea
              id="regen-notes"
              value={notes}
              disabled={busy}
              placeholder={t("project.regenNotesPlaceholder")}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {mode === "revise" ? (
            <p className="muted regen-hint">
              {t("project.regenCountSummary", {
                keep: keptRows.length,
                drop: rows.length - keptRows.length,
                add: additions.length,
                total,
              })}
            </p>
          ) : null}
          {footageMulti ? <p className="muted regen-hint">{t("project.regenFootageMulti")}</p> : null}
          {durationWarn != null ? (
            <p className="muted regen-hint">{t("project.regenDurationWarn", { max: durationWarn })}</p>
          ) : null}
          {!ready ? <p className="regen-warn">{t("project.regenNeedTake")}</p> : null}
          {!revisionAvailable ? <p className="regen-warn">{t("project.regenServerRestart")}</p> : null}
        </div>
        <div className="confirm-actions regen-modal-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>
            {t("project.cancelEdit")}
          </button>
          <button type="button" className="primary" disabled={busy || !ready || !revisionAvailable} onClick={submit}>
            {t("project.regenSubmit")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
