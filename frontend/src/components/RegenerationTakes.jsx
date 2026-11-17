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
        {t("regeneration.chain", { from: view.from, total: view.total })}
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
            {row.state === "generating" || row.state === "done" ? (
              <div
                className={`progress ${row.percent == null ? "is-indeterminate" : ""}`}
                role="progressbar"
                aria-label={t("queue.takeOnly", { n: row.n })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={row.percent ?? undefined}
              >
                <i style={{ width: `${row.percent ?? 35}%` }} />
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

/** One visual card per cascade take — used on the full Queue board. */
export function RegenerationTakeCards({
  project,
  active = false,
  currentTake,
  estimate,
  position,
  isCurrent = false,
  thumb,
  actions = null,
}) {
  const t = useT();
  const view = regenerationView(project, { active, currentTake, estimate });
  if (!view) return null;
  return (
    <div
      className={`qb-regen-group ${active ? "is-live" : ""}`}
      role="group"
      aria-label={t("regeneration.chain", { from: view.from, total: view.total })}
    >
      <div className="qb-regen-group-head">
        {position != null ? <div className="qb-pos">#{position}</div> : null}
        <div className="qb-regen-group-meta">
          <strong>{cleanTitle(project.title)}</strong>
          <span className="qb-pill regen">{t("regeneration.badge")}</span>
          {active ? <span className="qb-pill live">{t("queue.live")}</span> : null}
          {isCurrent ? <span className="qb-pill here">{t("queueBoard.thisVideo")}</span> : null}
          <span className="muted">{t("regeneration.chain", { from: view.from, total: view.total })}</span>
        </div>
      </div>
      <div className="qb-regen-take-list">
        {view.rows.map((row) => (
          <article
            key={`${project.id}-t${row.n}`}
            className={`qb-card qb-regen-take is-${row.state} ${row.state === "generating" ? "is-live" : ""}`}
          >
            <div className="qb-card-main">
              {thumb}
              <div className="qb-card-body">
                <div className="qb-card-top">
                  <strong>
                    {cleanTitle(project.title)} · {t("queue.takeOnly", { n: row.n })}
                  </strong>
                  <span className={`qb-pill regen-state is-${row.state}`}>{t(`regeneration.${row.state}`)}</span>
                </div>
                {row.title ? <div className="qb-card-meta">{row.title}</div> : null}
                <div className="qb-card-status">
                  {row.state === "dependent" ? dependentLabel(t, view, row) : t(`regeneration.${row.state}`)}
                </div>
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
                          width: `${
                            row.state === "done" ? 100 : row.percent ?? (row.state === "generating" ? 35 : 2)
                          }%`,
                        }}
                      />
                    </div>
                    <span>
                      {row.state === "done"
                        ? "100%"
                        : row.percent != null
                          ? `${Math.round(row.percent)}%`
                          : row.state === "generating"
                            ? t("regeneration.generating")
                            : t("regeneration.queued")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {actions ? <div className="qb-card-actions qb-regen-actions">{actions}</div> : null}
    </div>
  );
}
