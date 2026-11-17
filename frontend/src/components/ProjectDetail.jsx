import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useConfirm } from "./ConfirmDialog.jsx";
import { initials, isNsfw, isProjectComplete, posterSrc, statusLabel } from "../utils.js";
import { useT } from "../i18n/index.jsx";

export default function ProjectDetail({
  project,
  setProject,
  busy,
  setBusy,
  setToast,
  onRefresh,
  onClose,
}) {
  const t = useT();
  const confirm = useConfirm();
  const [estimate, setEstimate] = useState(project?.estimate || null);
  const [posterErr, setPosterErr] = useState(false);
  const [masterOk, setMasterOk] = useState(!!project?.has_master || !!project?.master_url);

  useEffect(() => {
    setPosterErr(false);
    setEstimate(project?.estimate || null);
    setMasterOk(!!project?.has_master || !!project?.master_url);
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

  if (!project) return null;

  const takes = project.takes || [];
  const done = new Set(project.runner_state?.completed || project.progress?.completed_ns || []);
  const masterUrl = `/api/projects/${project.id}/master`;
  const remaining = Math.max(0, takes.length - done.size);
  const isDone = isProjectComplete({ ...project, has_master: masterOk });
  const nsfw = isNsfw(project);

  return (
    <aside className="detail-panel stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <span className={`status-pill ${project.status}`}>{statusLabel(project.status, t)}</span>
          {nsfw ? (
            <span className="status-pill nsfw">NSFW</span>
          ) : (
            <span className="status-pill sfw">SFW</span>
          )}
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>

      {masterOk ? (
        <div className="stack">
          <video
            className="detail-video"
            key={masterUrl}
            src={masterUrl}
            controls
            playsInline
            poster={nsfw ? undefined : posterSrc(project) || undefined}
            onError={() => setMasterOk(false)}
          />
          <div className="row">
            <a className="btn-link" href={masterUrl} download={`${project.slug || "video"}_master.mp4`}>
              {t("project.downloadMaster")}
            </a>
            <span className="muted">
              {t("project.finalVideoNote")}
              {nsfw ? t("project.noNsfwCover") : ""}
            </span>
          </div>
        </div>
      ) : nsfw ? (
        <div className="detail-poster thumb-fallback nsfw-cover" style={{ position: "relative" }}>
          <span className="nsfw-tag">NSFW</span>
          <span className="nsfw-hint">{t("project.coverHidden")}</span>
        </div>
      ) : !posterErr ? (
        <img
          className="detail-poster"
          src={posterSrc(project)}
          alt=""
          onError={() => setPosterErr(true)}
        />
      ) : (
        <div className="detail-poster thumb-fallback" style={{ position: "relative" }}>
          {initials(project.title)}
        </div>
      )}

      <h2 style={{ fontFamily: "var(--display)", margin: 0, fontSize: 22, letterSpacing: "-0.03em" }}>
        {project.title}
      </h2>
      <p className="muted">{project.synopsis || project.brief || t("project.noSynopsis")}</p>
      <div className="muted">
        {done.size}/{takes.length} takes · {nsfw ? "NSFW" : "SFW"} · {project.review_mode}
        {masterOk ? ` · ${t("project.masterReady")}` : ""}
      </div>

      <div className="field">
        <label>{t("project.reviewModeLabel")}</label>
        <select
          value={project.review_mode}
          onChange={async (e) => {
            await api.patchProject(project.id, { review_mode: e.target.value });
            onRefresh();
            const p = await api.project(project.id);
            setProject(p);
          }}
        >
          <option value="automatico">{t("project.modeAutomatic")}</option>
          <option value="com_revisao">{t("project.modeReviewOption")}</option>
        </select>
      </div>

      <h3 style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>{t("project.shotList")}</h3>
      <div className="shot-list">
        {takes.map((tk, idx) => (
          <div key={tk.n || idx} className="shot">
            <header>
              <span>
                #{tk.n} · {tk.kind} · {tk.session} · {tk.duration}s
                {done.has(Number(tk.n)) || done.has(tk.n) ? " ✓" : ""}
              </span>
              <span>seed {tk.seed}</span>
            </header>
            <textarea
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
          </div>
        ))}
        {takes.length === 0 ? <p className="muted">{t("project.noTakesInbox")}</p> : null}
      </div>

      <div className="cta-bar">
        {isDone ? (
          <div className="alert good">{t("project.flowDoneDetail")}</div>
        ) : estimate ? (
          <div className="cta-cost">
            {t("project.costRemaining", { n: remaining || takes.length })}{" "}
            <strong>~{estimate.total_min} min</strong> · <strong>R$ {estimate.cost_brl}</strong>
          </div>
        ) : (
          <div className="cta-cost">{t("project.calculatingCost")}</div>
        )}
        {!isDone && <button
          type="button"
          className="primary"
          disabled={busy || !takes.length || project.status === "archived"}
          onClick={async () => {
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
          }}
        >
          {t("project.enqueue")}
        </button>}
        <div className="row">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
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
            }}
          >
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
                  message: t("project.archiveMsg"),
                  confirmLabel: t("project.archive"),
                });
                if (!ok) return;
                await api.deleteProject(project.id, false);
                setToast(t("library.archivedToast"));
                onClose();
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
              onClose();
              onRefresh();
            }}
          >
            {t("project.delete")}
          </button>
        </div>
      </div>
    </aside>
  );
}
