import React from "react";
import { useT } from "../i18n/index.jsx";
import { cleanTitle } from "../utils.js";
import { regenerationView } from "../queueRegeneration.js";

/** Compact list used in the floating dock when space is tight. */
export default function RegenerationTakes({ project, active = false, currentTake, estimate }) {
  const t = useT();
  const view = regenerationView(project, { active, currentTake, estimate });
  if (!view) return null;
  return (
    <div className="regen-takes">
      <div className="regen-summary">
        {t("regeneration.individual", { total: view.total })}
        <span className="muted"> · {t("regeneration.summary", { done: view.completed, total: view.total })}</span>
      </div>
      <div className="regen-take-list">
        {view.rows.map((row) => (
          <div key={row.n} className={`regen-take is-${row.state}`}>
            <div className="regen-take-heading">
              <strong>
                {cleanTitle(project.title)} · {t("queue.takeOnly", { n: row.n })}
              </strong>
              <span className={`regen-state is-${row.state}`}>{t(`regeneration.${row.state}`)}</span>
            </div>
            {row.title ? <div className="regen-take-title">{row.title}</div> : null}
            {row.state === "generating" || row.state === "done" || row.state === "queued" ? (
              <div
                className={`progress ${row.state === "generating" && row.percent == null ? "is-indeterminate" : ""}`}
                role="progressbar"
                aria-label={t("queue.takeOnly", { n: row.n })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={row.percent ?? (row.state === "done" ? 100 : 0)}
              >
                <i style={{ width: `${row.state === "done" ? 100 : row.percent ?? (row.state === "generating" ? 35 : 2)}%` }} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function dependentLabel(t, view, row) {
  const idx = view.rows.findIndex((r) => r.n === row.n);
  const prev = idx > 0 ? view.rows[idx - 1].n : null;
  return prev != null ? t("regeneration.dependentOf", { n: prev }) : t("regeneration.dependent");
}

function statusText(t, view, row) {
  if (row.state === "dependent") return dependentLabel(t, view, row);
  if (row.state === "queued") return `${t("regeneration.badge")} · ${t("regeneration.queued")}`;
  if (row.state === "generating") return `${t("regeneration.badge")} · ${t("regeneration.generating")}`;
  return t(`regeneration.${row.state}`);
}

/**
 * One full queue card per cascade take — visually separate entries for take 5, take 6, …
 */
export function RegenerationTakeCards({
  project,
  active = false,
  currentTake,
  estimate,
  position,
  isCurrent = false,
  formatLabel = null,
  packLabel = null,
  thumb = null,
  renderThumb = null,
  actions = null,
}) {
  const t = useT();
  const view = regenerationView(project, { active, currentTake, estimate });
  if (!view) return null;
  const pack = packLabel || "SFW";
  const fmt = formatLabel || null;

  return (
    <div className={`qb-regen-stack ${active ? "is-live" : ""}`} role="group" aria-label={t("regeneration.individual", { total: view.total })}>
      <div className="qb-regen-stack-banner">
        {position != null ? <span className="qb-pos">#{position}</span> : null}
        <span className="qb-pill regen">{t("regeneration.individual", { total: view.total })}</span>
        <span className="muted">{cleanTitle(project.title)}</span>
        <span className="muted">· {t("regeneration.chain", { from: view.from, total: view.total })}</span>
      </div>

      {view.rows.map((row, idx) => {
        const thumbNode = typeof renderThumb === "function" ? renderThumb(row) : thumb;
        const liveTake = active && row.state === "generating";
        return (
          <article
            key={`${project.id}-regen-t${row.n}`}
            className={`qb-card qb-regen-card is-${row.state} ${liveTake ? "is-live" : ""} ${isCurrent ? "is-here" : ""}`}
          >
            <div className="qb-card-main">
              <div className="qb-pos qb-pos-take">t{String(row.n).padStart(2, "0")}</div>
              {thumbNode}
              <div className="qb-card-body">
                <div className="qb-card-top">
                  <strong>
                    {cleanTitle(project.title)} · {t("queue.takeOnly", { n: row.n })}
                  </strong>
                  <span className="qb-pill regen">{t("regeneration.badge")}</span>
                  {liveTake ? <span className="qb-pill live">{t("queue.live")}</span> : null}
                  <span className={`qb-pill regen-state is-${row.state}`}>{t(`regeneration.${row.state}`)}</span>
                </div>
                <div className="qb-card-meta">
                  <span>{project.slug || "—"}</span>
                  <span>·</span>
                  <span>{pack}</span>
                  {fmt ? (
                    <>
                      <span>·</span>
                      <span>{fmt}</span>
                    </>
                  ) : null}
                  <span>·</span>
                  <span>{t("regeneration.onlyTake", { n: row.n })}</span>
                </div>
                <div className="qb-card-status">{statusText(t, view, row)}</div>
                {(row.state === "generating" || row.state === "done" || row.state === "queued") && (
                  <div className="qb-card-progress">
                    <div
                      className={`progress ${row.state === "generating" && row.percent == null ? "is-indeterminate" : ""}`}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={row.percent ?? (row.state === "done" ? 100 : 0)}
                    >
                      <i
                        style={{
                          width: `${row.state === "done" ? 100 : row.percent ?? (row.state === "generating" ? 35 : 2)}%`,
                        }}
                      />
                    </div>
                    <span>
                      {row.state === "done"
                        ? t("regeneration.done")
                        : row.percent != null
                          ? `${Math.round(row.percent)}%`
                          : t(`regeneration.${row.state}`)}
                      {" · "}
                      {idx + 1}/{view.total}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      })}

      {actions ? <div className="qb-card-actions qb-regen-actions">{actions}</div> : null}
    </div>
  );
}
