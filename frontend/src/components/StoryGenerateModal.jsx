import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/index.jsx";
import { groupTakesBySession, summarizeTakePrompt } from "../utils.js";

const STEPS = ["genSave", "genWrite", "genAssemble"];

export default function StoryGenerateModal({ state, onAccept, onDiscard, onCloseError }) {
  const t = useT();
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [state?.phase]);

  if (!state) return null;

  const working = state.phase === "working";
  const discarding = state.phase === "discarding";
  const ready = state.phase === "ready" || discarding;
  const project = state.result?.project;
  const takes = Array.isArray(project?.takes) ? project.takes : [];
  const totalSec = Math.round(takes.reduce((sum, take) => sum + (Number(take.duration) || 0), 0));
  const currentLabel = working
    ? state.step === 1
      ? state.details?.[state.detail] || t("create.genWrite")
      : t(`create.${STEPS[state.step] || "genWrite"}`)
    : "";

  return createPortal(
    <div className="gen-backdrop" role="presentation">
      <div
        className="gen-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gen-title"
        aria-busy={working || discarding}
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="gen-head">
          <h3 id="gen-title">{ready ? t("create.genReadyTitle") : state.phase === "error" ? t("create.genErrorTitle") : t("create.genTitle")}</h3>
          {working ? <p className="gen-hint">{t("create.genHint")}</p> : null}
        </header>

        {working ? (
          <div className="gen-working">
            <div
              className="gen-bar is-busy"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(state.progress || 0)}
              aria-label={currentLabel}
            >
              <span style={{ width: `${Math.max(6, Math.min(100, state.progress || 0))}%` }} />
            </div>
            <p className="gen-current" aria-live="polite">{currentLabel}</p>
            <ol className="gen-steps">
              {STEPS.map((key, index) => {
                const status = index < state.step ? "done" : index === state.step ? "active" : "pending";
                return (
                  <li key={key} className={`gen-step is-${status}`}>
                    <span className="gen-mark" aria-hidden="true" />
                    <span>{t(`create.${key}`)}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        {state.phase === "error" ? (
          <div className="gen-error">
            <p>{state.error}</p>
            <div className="gen-actions">
              <button type="button" className="primary" onClick={onCloseError}>
                {t("create.genClose")}
              </button>
            </div>
          </div>
        ) : null}

        {ready && project ? (
          <div className="gen-ready">
            <h4>{project.title}</h4>
            {project.synopsis ? <p className="gen-synopsis">{project.synopsis}</p> : null}
            <p className="gen-meta">{t("create.genMeta", { n: takes.length, sec: totalSec })}</p>
            <div className="gen-takes">
              {groupTakesBySession(takes).map((scene) => (
                <section key={scene.session}>
                  <h5>{t("create.genSession", { name: scene.session })}</h5>
                  {scene.items.map((take) => {
                    const summary = summarizeTakePrompt(take.prompt);
                    return (
                      <article key={take.n} className="gen-take">
                        <div className="gen-take-top">
                          <span className={`gen-kind is-${take.kind}`}>{String(take.kind || "").toUpperCase()}</span>
                          <strong>{take.title || `${t("create.takeLabel", { n: take.n })}`}</strong>
                          <span className="muted">{Math.round(Number(take.duration) || 0)}s</span>
                        </div>
                        {summary.preview ? <p>{summary.preview}</p> : null}
                      </article>
                    );
                  })}
                </section>
              ))}
            </div>
            {state.result?.warnings?.length ? (
              <ul className="gen-warnings">
                {state.result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <div className="gen-actions">
              <button type="button" onClick={onDiscard} disabled={discarding}>
                {t("create.genDiscard")}
              </button>
              <button type="button" className="primary" onClick={onAccept} disabled={discarding}>
                {t("create.genAccept")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
