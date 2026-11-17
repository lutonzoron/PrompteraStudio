import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useConfirm } from "./ConfirmDialog.jsx";
import {
  cleanTitle,
  fmtDate,
  formatElapsed,
  groupTakesBySession,
  isNsfw,
  isProjectComplete,
  posterSrc,
  statusLabel,
  summarizeTakePrompt,
} from "../utils.js";
import { useLocale, useT } from "../i18n/index.jsx";
import VideoFormat, { VIDEO_FORMATS } from "./VideoFormat.jsx";
import LogsPanel from "./LogsPanel.jsx";
import FootagePanel from "./FootagePanel.jsx";
import { runProjectAction, useProjectActions } from "../projectActions.js";

function reviewLabel(mode, t) {
  return mode === "com_revisao" ? t("project.modeReviewLong") : t("project.reviewModeShort");
}

function formatMeta(width, height) {
  const w = Number(width) || 576;
  const h = Number(height) || 1024;
  const preset = VIDEO_FORMATS.find((f) => f.width === w && f.height === h);
  return {
    width: w,
    height: h,
    ratio: preset?.ratio || `${w}:${h}`,
    label: preset ? `${preset.ratio} · ${w}×${h}` : `${w}×${h}`,
    aspect: `${w} / ${h}`,
  };
}

const TABS = ["takes", "overview", "production", "cctv", "logs"];

export default function ProjectPage({
  footageAvailable = false,
  project,
  setProject,
  busy,
  setBusy,
  setToast,
  onRefresh,
  onBack,
  onOpenEditor,
}) {
  const t = useT();
  const { dateLocale } = useLocale();
  const confirm = useConfirm();
  const pendingActions = useProjectActions();
  const [estimate, setEstimate] = useState(project?.estimate || null);
  const [masterOk, setMasterOk] = useState(!!project?.has_master || !!project?.master_url);
  const [focusTake, setFocusTake] = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [tab, setTab] = useState("takes");

  useEffect(() => {
    setMasterOk(!!project?.has_master);
  }, [project?.has_master, project?.master_url]);

  useEffect(() => {
    setEstimate(project?.estimate || null);
    setMasterOk(!!project?.has_master || !!project?.master_url);
    setFocusTake(null);
    setEditingTitle(false);
    setTitleDraft(cleanTitle(project?.title || ""));
    setTab("takes");
    const id = project?.id;
    if (!id) return undefined;
    let cancelled = false;
    api
      .project(id)
      .then((p) => {
        if (cancelled || !p || p.id !== id) return;
        setEstimate(p.estimate);
        setMasterOk(!!p.has_master || !!p.master_url);
        setProject(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project?.id, setProject]);

  useEffect(() => {
    if (tab === "cctv" && project?.category !== "footage") setTab("takes");
  }, [tab, project?.category]);

  const takes = project?.takes || [];
  const done = useMemo(
    () =>
      new Set(
        (project?.runner_state?.completed || project?.progress?.completed_ns || []).map(Number)
      ),
    [project]
  );
  const scenes = useMemo(() => groupTakesBySession(takes), [takes]);

  if (!project) return null;

  const masterUrl = project.master_url || `/api/projects/${project.id}/master`;
  const playbackUrl = masterOk ? masterUrl : project.preview_url;
  const canOpenEditor =
    typeof onOpenEditor === "function" &&
    takes.length > 0 &&
    (isProjectComplete({ ...project, has_master: masterOk }) ||
      ["done", "failed"].includes(project.status) ||
      done.size > 0);
  const remaining = Math.max(0, takes.length - done.size);
  const pct = takes.length ? Math.round((done.size / takes.length) * 100) : 0;
  const isDone = isProjectComplete({ ...project, has_master: masterOk });
  const nsfw = isNsfw(project);
  const history = project.stats || {};
  const showHistory =
    isDone ||
    (history.videos_sec != null &&
      !["generating", "queued", "paused", "awaiting_review"].includes(project.status));
  const synopsis = project.synopsis || project.brief || "";
  const currentTake =
    project.runner_state?.current_take ||
    takes.map((tk) => Number(tk.n)).find((n) => n && !done.has(n)) ||
    null;
  const isGenerating = ["generating", "queued", "paused"].includes(project.status);
  const format = formatMeta(project.width, project.height);
  const formatLocked =
    isGenerating ||
    ["awaiting_review", "done"].includes(project.status) ||
    done.size > 0 ||
    masterOk ||
    !!project.runner_state?.last_ok;

  async function enqueue() {
    if (isDone || isGenerating || project.status === "awaiting_review") return;
    return runProjectAction(
      project.id,
      t("actions.pending", { action: t("project.enqueue"), title: cleanTitle(project.title) }),
      async () => {
        setBusy(true);
        try {
          await api.enqueue(project.id);
          setToast(t("project.queuedToast"));
          await onRefresh();
        } catch (e) {
          setToast(String(e.message || e));
        } finally {
          setBusy(false);
        }
      }
    );
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
      setToast(r.built ? t("project.masterBuilt", { n: r.clip_count }) : t("project.masterExists"));
      onRefresh();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function archiveProject() {
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
  }

  async function deleteProject() {
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
  }

  const visibleTabs = TABS.filter((id) => id !== "cctv" || project.category === "footage");

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
          {nsfw ? <span className="status-pill nsfw">NSFW</span> : <span className="status-pill sfw">SFW</span>}
          <span className="status-pill">{format.label}</span>
        </div>
      </nav>

      <div className="pp-desk">
        <div className="pp-stage-col">
          <div className="pp-stage-slot">
            <div
              className="pp-frame"
              style={{
                "--pp-aw": format.width,
                "--pp-ah": format.height,
                aspectRatio: format.aspect,
              }}
            >
              {playbackUrl ? (
                <video
                  className="pp-video"
                  key={`${project.id}:${playbackUrl}`}
                  src={playbackUrl}
                  controls
                  playsInline
                  poster={nsfw ? undefined : posterSrc(project) || undefined}
                  onError={() => {
                    if (masterOk) setMasterOk(false);
                  }}
                />
              ) : (
                <div className={`pp-empty ${nsfw ? "nsfw-cover" : ""}`}>
                  {nsfw ? <span className="nsfw-tag">NSFW</span> : <div className="pp-empty-mark">▶</div>}
                  <p>{t("project.masterNotReady")}</p>
                  <p className="muted">{t("project.masterNotReadyHint")}</p>
                  <div className="row" style={{ justifyContent: "center", marginTop: 8 }}>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || remaining > 0}
                      onClick={buildMasterClick}
                    >
                      {t("project.buildMaster")}
                    </button>
                  </div>
                </div>
              )}
              <div className="pp-frame-badge">
                {masterOk ? <span className="ok">{t("project.masterReady")}</span> : null}
                <span>{format.ratio}</span>
                {takes.length ? <span>{t("library.takesMeta", { done: done.size, total: takes.length })}</span> : null}
              </div>
            </div>
          </div>

          {!masterOk && project.has_preview ? (
            <p className="muted pp-partial">{t("project.partialPreview", { done: done.size, total: takes.length })}</p>
          ) : null}

          <div className="pp-stage-actions">
            {masterOk ? (
              <a className="btn-link" href={masterUrl} download={`${project.slug || "video"}_master.mp4`}>
                {t("project.downloadMaster")}
              </a>
            ) : (
              <button type="button" disabled={busy || remaining > 0} onClick={buildMasterClick}>
                {t("project.buildMaster")}
              </button>
            )}
            {canOpenEditor ? (
              <button type="button" className="primary" onClick={onOpenEditor}>
                {t("editor.open")}
              </button>
            ) : null}
            {!isDone ? (
              <button
                type="button"
                className="primary"
                disabled={
                  busy ||
                  pendingActions.has(project.id) ||
                  isGenerating ||
                  project.status === "awaiting_review" ||
                  !takes.length ||
                  project.status === "archived"
                }
                onClick={enqueue}
              >
                {t("project.enqueue")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="pp-inspector">
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
                      <path d="M13 7l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
              <button type="button" className="ghost" onClick={() => setTab("takes")}>
                {t("project.tabTakes")}
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
              <span className="pp-stat-label">{showHistory ? t("history.elapsed") : t("project.timeRemaining")}</span>
              <strong>
                {showHistory
                  ? formatElapsed(history.videos_sec)
                  : estimate
                    ? `~${estimate.total_min} min`
                    : "—"}
              </strong>
              <span className="muted">
                {showHistory
                  ? history.initial_estimate
                    ? t("history.initialTime", { time: formatElapsed(history.initial_estimate.total_sec) })
                    : t(history.videos_sec != null ? "history.recorded" : "history.unavailable")
                  : estimate?.finish_at
                    ? t("project.finishesAt", { at: estimate.finish_at })
                    : remaining
                      ? t("project.takesRemaining", { n: remaining })
                      : t("project.complete")}
              </span>
              {!showHistory && estimate?.current_take && remaining ? (
                <span className="muted">
                  take {estimate.current_take} ≈ {estimate.current_take_min} min
                  {typeof estimate.current_take_pct === "number" && estimate.current_take_pct > 0
                    ? ` (${Math.round(estimate.current_take_pct)}%)`
                    : ""}
                </span>
              ) : null}
            </div>
            <div className="pp-stat">
              <span className="pp-stat-label">{showHistory ? t("history.cost") : t("project.estCost")}</span>
              <strong>
                {showHistory
                  ? history.cost_brl != null
                    ? `R$ ${Number(history.cost_brl).toFixed(2)}`
                    : "—"
                  : estimate
                    ? `R$ ${estimate.cost_brl}`
                    : "—"}
              </strong>
              <span className="muted">
                {showHistory
                  ? history.cost_brl != null
                    ? t("history.energy", { kwh: history.energy_kwh ?? "—" })
                    : t("history.unavailable")
                  : estimate?.source || t("project.energyH3")}
              </span>
              {showHistory && history.initial_estimate ? (
                <span className="muted">
                  {t("history.initialCost", { cost: Number(history.initial_estimate.cost_brl).toFixed(2) })}
                </span>
              ) : null}
            </div>
            <div className="pp-stat">
              <span className="pp-stat-label">{t("videoFormat.label")}</span>
              <strong>{format.ratio}</strong>
              <span className="muted">
                {format.width}×{format.height}
              </span>
            </div>
          </div>

          <div className="pp-tabs-shell">
            <div className="pp-tabs" role="tablist" aria-label={t("project.tabsLabel")}>
              {visibleTabs.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className="pp-tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                >
                  {t(`project.tab${id[0].toUpperCase()}${id.slice(1)}`)}
                  {id === "takes" && takes.length ? <span className="pp-tab-count">{takes.length}</span> : null}
                </button>
              ))}
            </div>

            {tab === "takes" ? (
              <section className="pp-tab-panel" role="tabpanel">
                <div className="pp-panel-toolbar">
                  <h2>{t("project.shotList")}</h2>
                  <span className="muted">{t("project.takesReady", { total: takes.length, done: done.size })}</span>
                </div>
                <div className="pp-tab-scroll">
                  {takes.length ? (
                    <div className="pp-timeline pp-timeline-scenes" aria-hidden>
                      {scenes.map((scene, si) => (
                        <div key={`tl-${scene.session}-${si}`} className="pp-timeline-scene">
                          {scene.items.map((tk) => (
                            <i
                              key={tk.n}
                              className={`pp-tick ${done.has(Number(tk.n)) ? "done" : ""} ${
                                isGenerating && currentTake === Number(tk.n) ? "live" : ""
                              }`}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : null}

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
                      {scenes.map((scene, si) => {
                        const sceneDone = scene.items.filter((tk) => done.has(Number(tk.n))).length;
                        const sceneSec = scene.items.reduce(
                          (sum, tk) => sum + (Number(tk.duration) || 0),
                          0
                        );
                        return (
                          <section key={`${scene.session}-${si}`} className="pp-scene">
                            <header className="pp-scene-head">
                              <div className="pp-scene-title">
                                <strong>{t("project.sceneLabel", { n: si + 1 })}</strong>
                                <span className="pp-scene-session" title={scene.session}>
                                  {scene.session}
                                </span>
                              </div>
                              <span className="muted">
                                {t("project.sceneMeta", {
                                  takes: scene.items.length,
                                  sec: Math.round(sceneSec),
                                })}
                                {" · "}
                                {t("project.sceneReady", {
                                  done: sceneDone,
                                  total: scene.items.length,
                                })}
                              </span>
                            </header>

                            <div className="pp-scene-strip" role="list">
                              {scene.items.map((tk) => {
                                const n = Number(tk.n);
                                const ok = done.has(n);
                                const live = isGenerating && currentTake === n;
                                const beat = summarizeTakePrompt(tk.prompt);
                                const kind = String(tk.kind || "").toUpperCase();
                                return (
                                  <button
                                    key={`bead-${n}`}
                                    type="button"
                                    role="listitem"
                                    className={`pp-scene-bead ${ok ? "is-done" : ""} ${
                                      live ? "is-live" : ""
                                    } ${focusTake === n ? "is-focus" : ""} ${
                                      kind === "NEW" ? "is-new" : "is-continue"
                                    }`}
                                    title={`${t("project.takeLabel", { n })} · ${
                                      beat.action || beat.preview || t("project.beatFallback")
                                    }`}
                                    onClick={() => setFocusTake(focusTake === n ? null : n)}
                                  >
                                    <span className="pp-scene-bead-n">{ok ? "✓" : n}</span>
                                    <span className="pp-scene-bead-label">
                                      {beat.action || beat.preview || t("project.beatFallback")}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>

                            <div className="pp-scene-takes">
                              {scene.items.map((tk) => {
                                const n = Number(tk.n);
                                const idx = takes.findIndex((x) => Number(x.n) === n);
                                const ok = done.has(n);
                                const open = focusTake === n;
                                const live = isGenerating && currentTake === n;
                                const kind = String(tk.kind || "").toUpperCase();
                                const isContinue = kind === "CONTINUE";
                                const beat = summarizeTakePrompt(tk.prompt);
                                return (
                                  <article
                                    key={tk.n || idx}
                                    className={`pp-shot ${ok ? "is-done" : ""} ${
                                      open ? "is-open" : ""
                                    } ${live ? "is-live" : ""} ${
                                      isContinue ? "is-continue" : "is-new"
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      className="pp-shot-toggle"
                                      onClick={() => setFocusTake(open ? null : n)}
                                    >
                                      <span
                                        className={`pp-shot-num ${ok ? "ok" : ""} ${
                                          live ? "live" : ""
                                        }`}
                                      >
                                        {ok ? "✓" : live ? "●" : tk.n}
                                      </span>
                                      <div className="pp-shot-sum">
                                        <strong>
                                          {t("project.takeLabel", { n: tk.n })}
                                          <span
                                            className={`pp-shot-kind ${
                                              isContinue ? "cont" : "new"
                                            }`}
                                          >
                                            {tk.kind}
                                          </span>
                                          {beat.mute ? (
                                            <span className="pp-shot-tag">{t("project.takeMute")}</span>
                                          ) : null}
                                          {beat.dialogue ? (
                                            <span className="pp-shot-tag is-line">
                                              {t("project.takeDialogue")}
                                            </span>
                                          ) : null}
                                          {live ? (
                                            <span className="pp-shot-live">
                                              {t("project.generatingShot")}
                                            </span>
                                          ) : null}
                                        </strong>
                                        <span className="pp-shot-beat">
                                          {beat.action || beat.preview || t("project.beatFallback")}
                                        </span>
                                        <span className="muted pp-shot-meta">
                                          {tk.duration}s · seed {tk.seed}
                                          {ok ? t("project.shotReady") : ""}
                                        </span>
                                        {beat.dialogue && !open ? (
                                          <span className="pp-shot-line">“{beat.dialogue}”</span>
                                        ) : null}
                                      </div>
                                      <span className="pp-shot-chev" aria-hidden>
                                        {open ? "▾" : "▸"}
                                      </span>
                                    </button>
                                    {open ? (
                                      <div className="pp-shot-body">
                                        <label className="pp-shot-edit-label" htmlFor={`take-prompt-${n}`}>
                                          {t("project.editPrompt")}
                                        </label>
                                        <textarea
                                          id={`take-prompt-${n}`}
                                          className="pp-shot-prompt"
                                          value={tk.prompt}
                                          onChange={(e) => {
                                            if (idx < 0) return;
                                            const next = [...takes];
                                            next[idx] = { ...tk, prompt: e.target.value };
                                            setProject({ ...project, takes: next });
                                          }}
                                          onBlur={async (e) => {
                                            if (idx < 0) return;
                                            const next = [...takes];
                                            next[idx] = { ...tk, prompt: e.target.value };
                                            await api.patchProject(project.id, { takes: next });
                                          }}
                                        />
                                      </div>
                                    ) : null}
                                  </article>
                                );
                              })}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {tab === "overview" ? (
              <section className="pp-tab-panel" role="tabpanel">
                <div className="pp-panel-toolbar">
                  <h2>{t("project.tabOverview")}</h2>
                </div>
                <div className="pp-tab-scroll">
                  <div className="pp-overview-grid">
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
                      <div>
                        <dt>{t("category.label")}</dt>
                        <dd>{project.category === "footage" ? t("category.footage") : t("category.general")}</dd>
                      </div>
                      <div>
                        <dt>{t("videoFormat.label")}</dt>
                        <dd>{format.label}</dd>
                      </div>
                    </dl>
                    <div className="pp-side-actions">
                      <button type="button" className="primary" onClick={() => setTab("takes")}>
                        {t("project.tabTakes")}
                      </button>
                      {project.category === "footage" ? (
                        <button type="button" onClick={() => setTab("cctv")}>
                          {t("footage.apply")}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => setTab("logs")}>
                        {t("project.tabLogs")}
                      </button>
                      <button type="button" onClick={() => setTab("production")}>
                        {t("project.tabProduction")}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {tab === "production" ? (
              <section className="pp-tab-panel" role="tabpanel">
                <div className="pp-panel-toolbar">
                  <h2>{t("project.production")}</h2>
                </div>
                <div className="pp-tab-scroll">
                  <div className="pp-overview-grid">
                    <div className="stack">
                      <div className="field">
                        <label htmlFor="project-category">{t("category.label")}</label>
                        <select
                          id="project-category"
                          value={project.category || "general"}
                          disabled={busy || !footageAvailable}
                          onChange={async (e) => {
                            try {
                              const updated = await api.patchProject(project.id, { category: e.target.value });
                              setProject({ ...project, ...updated });
                              await onRefresh();
                            } catch (err) {
                              setToast(String(err.message || err));
                            }
                          }}
                        >
                          <option value="general">{t("category.general")}</option>
                          <option value="footage">{t("category.footage")}</option>
                        </select>
                      </div>
                      <div className="field">
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
                      <VideoFormat
                        width={project.width}
                        height={project.height}
                        disabled={busy}
                        locked={formatLocked}
                        onChange={async (dimensions) => {
                          setBusy(true);
                          try {
                            const updated = await api.patchProject(project.id, dimensions);
                            setProject({ ...project, ...updated });
                            setToast(t("videoFormat.saved"));
                            onRefresh();
                          } catch (e) {
                            setToast(String(e.message || e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      />
                      {isDone ? <div className="alert good">{t("project.flowDone")}</div> : null}
                    </div>
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
                        <button type="button" onClick={archiveProject}>
                          {t("project.archive")}
                        </button>
                      )}
                      <button type="button" className="danger" onClick={deleteProject}>
                        {t("project.delete")}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {tab === "cctv" && project.category === "footage" ? (
              <section className="pp-tab-panel" role="tabpanel">
                <div className="pp-tab-scroll">
                  <FootagePanel
                    embedded
                    key={`footage-${project.id}`}
                    project={project}
                    onProject={setProject}
                    onRefresh={onRefresh}
                    setToast={setToast}
                    available={footageAvailable}
                  />
                </div>
              </section>
            ) : null}

            {tab === "logs" ? (
              <section className="pp-tab-panel" role="tabpanel">
                <div className="pp-tab-scroll">
                  <LogsPanel embedded key={project.id} projectId={project.id} />
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
