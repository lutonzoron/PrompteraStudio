import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useConfirm } from "./ConfirmDialog.jsx";
import { cleanTitle, fmtDate, isNsfw, posterSrc, statusLabel } from "../utils.js";
import { useLocale, useT } from "../i18n/index.jsx";

function reviewLabel(mode, t) {
  return mode === "com_revisao" ? t("project.modeReviewLong") : t("project.reviewModeShort");
}

export default function ProjectPage({
  project,
  setProject,
  busy,
  setBusy,
  setToast,
  onRefresh,
  onBack,
}) {
  const t = useT();
  const { dateLocale } = useLocale();
  const confirm = useConfirm();
  const [estimate, setEstimate] = useState(project?.estimate || null);
  const [masterOk, setMasterOk] = useState(!!project?.has_master || !!project?.master_url);
  const [focusTake, setFocusTake] = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  useEffect(() => {
    setEstimate(project?.estimate || null);
    setMasterOk(!!project?.has_master || !!project?.master_url);
    setFocusTake(null);
    setEditingTitle(false);
    setTitleDraft(cleanTitle(project?.title || ""));
    if (!project?.id) return;
    api
      .project(project.id)
      .then((p) => {
        setEstimate(p.estimate);
        setMasterOk(!!p.has_master || !!p.master_url);
        setProject(p);
      })
      .catch(() => {});
  }, [project?.id]);

  const takes = project?.takes || [];
  const done = useMemo(
    () =>
      new Set(
        (project?.runner_state?.completed || project?.progress?.completed_ns || []).map(Number)
      ),
    [project]
  );

  if (!project) return null;

  const masterUrl = `/api/projects/${project.id}/master`;
  const remaining = Math.max(0, takes.length - done.size);
  const pct = takes.length ? Math.round((done.size / takes.length) * 100) : 0;
  const isDone =
    project.status === "done" || (takes.length > 0 && remaining === 0 && masterOk);
  const nsfw = isNsfw(project);
  const synopsis = project.synopsis || project.brief || "";
  const currentTake =
    project.runner_state?.current_take ||
    takes.map((tk) => Number(tk.n)).find((n) => n && !done.has(n)) ||
    null;
  const isGenerating = ["generating", "queued", "paused"].includes(project.status);

  async function enqueue() {
    setBusy(true);
    try {
      await api.enqueue(project.id);
      setToast(t("project.queuedToast"));
      onRefresh();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function regen() {
    setBusy(true);
    try {
      const r = await api.generateStory(project.id, { brief: project.brief });
      setProject(r.project);
      setEstimate(r.estimate);
      setToast(t("project.scriptRegenerated"));
      onRefresh();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function setReviewMode(mode) {
    await api.patchProject(project.id, { review_mode: mode });
    const p = await api.project(project.id);
    setProject(p);
    onRefresh();
  }

  async function saveTitle() {
    const next = titleDraft.trim();
    if (!next || next === cleanTitle(project.title)) {
      setEditingTitle(false);
      setTitleDraft(cleanTitle(project.title));
      return;
    }
    setBusy(true);
    try {
      const p = await api.patchProject(project.id, { title: next });
      setProject(p);
      setEditingTitle(false);
      setToast(t("project.titleUpdated"));
      onRefresh();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function buildMasterClick() {
    setBusy(true);
    try {
      const r = await api.buildMaster(project.id, true);
      setMasterOk(true);
      setProject({ ...project, has_master: true, master_url: r.master_url });
      setToast(
        r.built ? t("project.masterBuilt", { n: r.clip_count }) : t("project.masterExists")
      );
      onRefresh();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="project-page">
      <nav className="pp-crumb">
        <button type="button" className="pp-back" onClick={onBack}>
          <span aria-hidden>←</span> {t("project.backStudio")}
        </button>
        <span className="pp-crumb-sep" aria-hidden>
          /
        </span>
        <span className="pp-crumb-title">{cleanTitle(project.title)}</span>
        <div className="pp-crumb-pills">
          <span className={`status-pill ${project.status}`}>{statusLabel(project.status, t)}</span>
          {nsfw ? (
            <span className="status-pill nsfw">NSFW</span>
          ) : (
            <span className="status-pill sfw">SFW</span>
          )}
        </div>
      </nav>

      <div className="pp-stage">
        {masterOk ? (
          <video
            className="pp-video"
            key={masterUrl}
            src={masterUrl}
            controls
            playsInline
            poster={nsfw ? undefined : posterSrc(project) || undefined}
            onError={() => setMasterOk(false)}
          />
        ) : (
          <div className={`pp-empty ${nsfw ? "nsfw-cover" : ""}`}>
            {nsfw ? (
              <span className="nsfw-tag">NSFW</span>
            ) : (
              <div className="pp-empty-mark">▶</div>
            )}
            <p>{t("project.masterNotReady")}</p>
            <p className="muted">{t("project.masterNotReadyHint")}</p>
            <div className="row" style={{ justifyContent: "center", marginTop: 8 }}>
              <button type="button" className="primary" disabled={busy} onClick={buildMasterClick}>
                {t("project.buildMaster")}
              </button>
            </div>
          </div>
        )}
      </div>

      <header className="pp-head">
        <div className="pp-head-text">
          {editingTitle ? (
            <div className="pp-title-edit">
              <input
                className="pp-title-input"
                value={titleDraft}
                autoFocus
                maxLength={120}
                disabled={busy}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveTitle();
                  }
                  if (e.key === "Escape") {
                    setEditingTitle(false);
                    setTitleDraft(cleanTitle(project.title));
                  }
                }}
              />
              <button type="button" className="primary" disabled={busy} onClick={saveTitle}>
                {t("common.save")}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => {
                  setEditingTitle(false);
                  setTitleDraft(cleanTitle(project.title));
                }}
              >
                {t("project.cancelEdit")}
              </button>
            </div>
          ) : (
            <div className="pp-title-row">
              <h1 className="project-title">{cleanTitle(project.title)}</h1>
              <button
                type="button"
                className="pp-edit-title"
                title={t("project.editTitle")}
                aria-label={t("project.editTitleAria")}
                onClick={() => {
                  setTitleDraft(cleanTitle(project.title));
                  setEditingTitle(true);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 20h4.5L19 9.5a2.1 2.1 0 0 0 0-3L17.5 5a2.1 2.1 0 0 0-3 0L4 15.5V20z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M13 7l4 4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          )}
          {synopsis ? <p className="pp-synopsis">{synopsis}</p> : null}
          <div className="pp-meta-line">
            <span>{fmtDate(project.updated_at || project.created_at, dateLocale)}</span>
            <span>·</span>
            <span>{project.slug}</span>
            {masterOk ? (
              <>
                <span>·</span>
                <span className="pp-meta-ok">{t("project.masterReady")}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="pp-head-actions">
          {masterOk ? (
            <a
              className="btn-link"
              href={masterUrl}
              download={`${project.slug || "video"}_master.mp4`}
            >
              {t("project.downloadMaster")}
            </a>
          ) : (
            <button type="button" disabled={busy} onClick={buildMasterClick}>
              {t("project.buildMaster")}
            </button>
          )}
          <button
            type="button"
            className="primary pp-cta"
            disabled={busy || !takes.length || project.status === "archived"}
            onClick={enqueue}
          >
            {isDone ? t("project.regenerate") : t("project.enqueue")}
          </button>
        </div>
      </header>

      <div className="pp-stats">
        <div className="pp-stat">
          <span className="pp-stat-label">{t("project.progress")}</span>
          <strong>{t("library.takesMeta", { done: done.size, total: takes.length || "—" })}</strong>
          <div className="progress pp-progress">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="pp-stat">
          <span className="pp-stat-label">{t("project.timeRemaining")}</span>
          <strong>{estimate ? `~${estimate.total_min} min` : "—"}</strong>
          <span className="muted">
            {estimate?.finish_at
              ? t("project.finishesAt", { at: estimate.finish_at })
              : remaining
                ? t("project.takesRemaining", { n: remaining })
                : t("project.complete")}
          </span>
          {estimate?.current_take && remaining ? (
            <span className="muted">
              take {estimate.current_take} ≈ {estimate.current_take_min} min
              {typeof estimate.current_take_pct === "number" && estimate.current_take_pct > 0
                ? ` (${Math.round(estimate.current_take_pct)}%)`
                : ""}
            </span>
          ) : null}
        </div>
        <div className="pp-stat">
          <span className="pp-stat-label">{t("project.estCost")}</span>
          <strong>{estimate ? `R$ ${estimate.cost_brl}` : "—"}</strong>
          <span className="muted">{estimate?.source || t("project.energyH3")}</span>
        </div>
        <div className="pp-stat">
          <span className="pp-stat-label">{t("project.reviewModeLabel")}</span>
          <div className="pp-seg">
            <button
              type="button"
              className={project.review_mode !== "com_revisao" ? "on" : ""}
              onClick={() => setReviewMode("automatico")}
            >
              {t("project.reviewAutoShort")}
            </button>
            <button
              type="button"
              className={project.review_mode === "com_revisao" ? "on" : ""}
              onClick={() => setReviewMode("com_revisao")}
            >
              {t("project.reviewPerTake")}
            </button>
          </div>
        </div>
      </div>

      <div className="pp-body">
        <aside className="pp-side stack">
          <div className="pp-panel">
            <h2>{t("project.production")}</h2>
            <dl className="pp-dl">
              <div>
                <dt>{t("project.pack")}</dt>
                <dd>{nsfw ? "NSFW" : "SFW"}</dd>
              </div>
              <div>
                <dt>{t("project.mode")}</dt>
                <dd>{reviewLabel(project.review_mode, t)}</dd>
              </div>
              <div>
                <dt>{t("project.style")}</dt>
                <dd>{project.style_name || project.style_id || "—"}</dd>
              </div>
              <div>
                <dt>{t("project.status")}</dt>
                <dd>{statusLabel(project.status, t)}</dd>
              </div>
            </dl>
            {isDone ? <div className="alert good">{t("project.flowDone")}</div> : null}
            <div className="pp-side-actions">
              <button type="button" disabled={busy} onClick={regen}>
                {t("project.regenScript")}
              </button>
              {project.status === "archived" ? (
                <button
                  type="button"
                  onClick={async () => {
                    await api.restoreProject(project.id);
                    setToast(t("library.restoredToast"));
                    onRefresh();
                  }}
                >
                  {t("library.restore")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      title: t("project.archiveTitle"),
                      message: t("library.archiveMsg", { title: cleanTitle(project.title) }),
                      confirmLabel: t("project.archive"),
                    });
                    if (!ok) return;
                    await api.deleteProject(project.id, false);
                    setToast(t("library.archivedToast"));
                    onBack();
                    onRefresh();
                  }}
                >
                  {t("project.archive")}
                </button>
              )}
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: t("project.deleteTitle"),
                    message: t("project.deleteMsg"),
                    confirmLabel: t("common.delete"),
                    danger: true,
                  });
                  if (!ok) return;
                  await api.deleteProject(project.id, true);
                  setToast(t("library.deletedToast"));
                  onBack();
                  onRefresh();
                }}
              >
                {t("project.delete")}
              </button>
            </div>
          </div>
        </aside>

        <section className="pp-shots">
          <div className="pp-shots-head">
            <h2>{t("project.shotList")}</h2>
            <span className="muted">
              {t("project.takesReady", { total: takes.length, done: done.size })}
            </span>
          </div>

          {takes.length === 0 ? (
            <div className="pp-shots-empty">
              <p>{t("project.noTakes")}</p>
              <p className="muted">{t("project.noTakesHint")}</p>
              <button type="button" className="primary" disabled={busy} onClick={regen}>
                {t("project.genScript")}
              </button>
            </div>
          ) : (
            <div className="pp-shot-list">
              {takes.map((tk, idx) => {
                const n = Number(tk.n);
                const ok = done.has(n);
                const open = focusTake === n;
                const live = isGenerating && currentTake === n;
                return (
                  <article
                    key={tk.n || idx}
                    className={`pp-shot ${ok ? "is-done" : ""} ${open ? "is-open" : ""} ${
                      live ? "is-live" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="pp-shot-toggle"
                      onClick={() => setFocusTake(open ? null : n)}
                    >
                      <span className={`pp-shot-num ${ok ? "ok" : ""} ${live ? "live" : ""}`}>
                        {ok ? "✓" : live ? "●" : tk.n}
                      </span>
                      <div className="pp-shot-sum">
                        <strong>
                          {t("project.takeLabel", { n: tk.n })}
                          <span className="pp-shot-kind">{tk.kind}</span>
                          {live ? (
                            <span className="pp-shot-live">{t("project.generatingShot")}</span>
                          ) : null}
                        </strong>
                        <span className="muted">
                          {tk.session} · {tk.duration}s · seed {tk.seed}
                          {ok ? t("project.shotReady") : ""}
                        </span>
                      </div>
                      <span className="pp-shot-chev" aria-hidden>
                        {open ? "▾" : "▸"}
                      </span>
                    </button>
                    {open ? (
                      <textarea
                        className="pp-shot-prompt"
                        value={tk.prompt}
                        onChange={(e) => {
                          const next = [...takes];
                          next[idx] = { ...tk, prompt: e.target.value };
                          setProject({ ...project, takes: next });
                        }}
                        onBlur={async (e) => {
                          const next = [...takes];
                          next[idx] = { ...tk, prompt: e.target.value };
                          await api.patchProject(project.id, { takes: next });
                        }}
                      />
                    ) : (
                      <p className="pp-shot-preview">{tk.prompt}</p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
