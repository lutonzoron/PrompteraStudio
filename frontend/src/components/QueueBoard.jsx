import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import { useConfirm } from "./ConfirmDialog.jsx";
import { cleanTitle, initials, isNsfw, posterSrc, statusLabel } from "../utils.js";
import { useT } from "../i18n/index.jsx";
import { runProjectAction, useProjectActions } from "../projectActions.js";
import { VIDEO_FORMATS } from "./VideoFormat.jsx";
import { RegenerationTakeCards } from "./RegenerationTakes.jsx";
import { regenerationView } from "../queueRegeneration.js";

function queueDuration(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < 0) return "—";
  const total = Math.round(value);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

function formatLabel(p) {
  const w = Number(p?.width);
  const h = Number(p?.height);
  if (!w || !h) return null;
  const preset = VIDEO_FORMATS.find((f) => f.width === w && f.height === h);
  return preset ? `${preset.ratio} · ${w}×${h}` : `${w}×${h}`;
}

function Thumb({ project, onOpen, openLabel }) {
  const [err, setErr] = useState(false);
  const src = posterSrc(project);
  const body = isNsfw(project) ? (
    <span className="qb-thumb nsfw-thumb">NSFW</span>
  ) : !src || err ? (
    <span className="qb-thumb qb-thumb-fallback" aria-hidden>
      {initials(cleanTitle(project.title))}
    </span>
  ) : (
    <img className="qb-thumb" src={src} alt="" onError={() => setErr(true)} />
  );
  if (!onOpen) return body;
  return (
    <button
      type="button"
      className="qb-thumb-btn"
      title={openLabel || cleanTitle(project.title)}
      aria-label={openLabel || cleanTitle(project.title)}
      onClick={onOpen}
    >
      {body}
    </button>
  );
}

function waitingLine(p, comfyQ, t) {
  const pendingSlugs = (comfyQ?.pending_items || []).map((x) => x?.slug).filter(Boolean);
  const onComfy = pendingSlugs.includes(p.slug);
  if (onComfy) {
    return p.current_take
      ? t("queue.comfyWaitingTake", { n: p.current_take })
      : t("queue.comfyWaiting");
  }
  if (p.external) {
    if (p.stats?.waiting_for) return t("queue.externalWait", { for: p.stats.waiting_for });
    if (p.current_take) return t("queue.waitingTake", { take: p.current_take });
    return t("queue.externalWaiting");
  }
  return statusLabel(p.status, t);
}

export default function QueueBoard({
  queue,
  currentProjectId = null,
  prioritizeAvailable = false,
  onRefresh,
  setToast,
  onOpenProject,
  onOpenReview,
}) {
  const t = useT();
  const confirm = useConfirm();
  const pendingActions = useProjectActions();
  const [busy, setBusy] = useState(false);

  const items = queue?.items || [];
  const pending = queue?.pending_reviews || [];
  const active = queue?.active_job;
  const now = queue?.now;
  const estimate = queue?.estimate;
  const comfyQ = queue?.comfy_queue;
  const hasPaused = items.some((p) => p.status === "paused");
  const hasExternal = items.some((p) => p.external);
  const externalOnly =
    !!queue?.external_only || (hasExternal && !active && items.every((p) => p.external));

  const generating =
    items.find((p) => p.is_active) ||
    (now ? items.find((p) => p.id === now.project_id) : null) ||
    null;

  const waiting = useMemo(
    () =>
      items.filter(
        (p) => p.status !== "awaiting_review" && (!generating || p.id !== generating.id)
      ),
    [items, generating]
  );

  const nowPct = Math.round(
    now?.progress ??
      (generating?.progress?.total
        ? (100 * (generating.progress.completed || 0)) / generating.progress.total
        : 0)
  );
  const nowTake = now?.current_take || generating?.current_take || null;
  const nowDone = now?.completed ?? generating?.progress?.completed ?? 0;
  const nowTotal = now?.total ?? generating?.progress?.total ?? 0;
  const nowTitle = cleanTitle(now?.title || generating?.title || "");
  const displayNowMsg =
    now?.message ||
    (nowTake
      ? nowTotal
        ? t("queue.takeOf", { n: nowTake, total: nowTotal })
        : t("queue.takeOnly", { n: nowTake })
      : t("queue.generatingEllipsis"));

  let comfyLine = t("queue.comfyOffline");
  if (comfyQ) {
    comfyLine = comfyQ.online
      ? comfyQ.busy
        ? t("queue.comfyRun", { running: comfyQ.running, pending: comfyQ.pending })
        : t("queue.comfyIdle")
      : t("queue.comfyOffline");
  }

  const badge = (generating ? 1 : 0) + waiting.length + pending.length;

  async function run(fn, okMsg) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (okMsg) setToast(okMsg);
      await onRefresh();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function act(p, id, label) {
    return runProjectAction(p.id, t("actions.pending", { action: label, title: cleanTitle(p.title) }), async () => {
      setBusy(true);
      try {
        if (id === "open") await onOpenProject?.(p.id);
        if (id === "dequeue") {
          await api.dequeue(p.id);
          setToast(t("queue.dequeueToast"));
          await onRefresh();
        }
        if (id === "prioritize") {
          const result = await api.prioritize(p.id);
          setToast(t(result.interrupted_project_id ? "queue.prioritizedWithResume" : "queue.prioritized"));
          await onRefresh();
        }
        if (id === "sync") {
          await api.externalSync();
          setToast(t("queue.syncExternalToast"));
          await onRefresh();
        }
        if (id === "resume") {
          await api.resume();
          setToast(t("queue.resumeInternalToast"));
          await onRefresh();
        }
        if (id === "archive") {
          const ok = await confirm({
            title: t("queue.archiveTitle"),
            message: t("queue.archiveMsg", { title: cleanTitle(p.title) }),
            confirmLabel: t("queue.archive"),
          });
          if (!ok) return;
          await api.deleteProject(p.id, false);
          setToast(t("queue.archivedToast"));
          await onRefresh();
        }
      } catch (e) {
        setToast(String(e.message || e));
      } finally {
        setBusy(false);
      }
    });
  }

  function cardActions(p, { isLive, isCurrent }) {
    return (
      <>
        {onOpenProject && !isCurrent ? (
          <button type="button" disabled={busy || pendingActions.size > 0} onClick={() => act(p, "open", t("queue.openProject"))}>
            {t("queue.openProject")}
          </button>
        ) : null}
        {!p.external && !isLive ? (
          <button
            type="button"
            disabled={busy || pendingActions.size > 0 || !prioritizeAvailable}
            title={t(prioritizeAvailable ? "queue.prioritizeHint" : "queue.prioritizeNeedsRestart")}
            onClick={() => act(p, "prioritize", t("queue.prioritize"))}
          >
            {t("queue.prioritize")}
          </button>
        ) : null}
        {p.external ? (
          <button type="button" disabled={busy || pendingActions.size > 0} onClick={() => act(p, "sync", t("queue.sync"))}>
            {t("queue.sync")}
          </button>
        ) : null}
        <button
          type="button"
          className="danger"
          disabled={busy || pendingActions.size > 0}
          onClick={() => act(p, "dequeue", t("queue.dequeue"))}
        >
          {t("queue.dequeue")}
        </button>
      </>
    );
  }

  function card(p, { role, position } = {}) {
    const isCurrent = p.id === currentProjectId;
    const isLive = role === "generating";
    const done = p.progress?.completed ?? 0;
    const total = p.progress?.total ?? (p.takes || []).length ?? 0;
    const pct = total ? Math.round((100 * done) / total) : 0;
    const fmt = formatLabel(p);
    const pack = isNsfw(p) ? "NSFW" : "SFW";
    const regeneration = regenerationView(p);
    const thumb = (
      <Thumb
        project={p}
        openLabel={t("queue.openProject")}
        onOpen={onOpenProject ? () => onOpenProject(p.id) : undefined}
      />
    );

    if (regeneration) {
      return (
        <RegenerationTakeCards
          key={p.id}
          project={p}
          active={isLive}
          currentTake={isLive ? nowTake : null}
          estimate={estimate?.current}
          position={position}
          isCurrent={isCurrent}
          thumb={thumb}
          actions={cardActions(p, { isLive, isCurrent })}
        />
      );
    }

    return (
      <article
        key={p.id}
        className={`qb-card ${isLive ? "is-live" : ""} ${isCurrent ? "is-here" : ""} ${
          p.status === "paused" ? "is-paused" : ""
        }`}
      >
        <div className="qb-card-main">
          {position != null ? <div className="qb-pos">#{position}</div> : null}
          {thumb}
          <div className="qb-card-body">
            <div className="qb-card-top">
              <strong>{cleanTitle(p.title)}</strong>
              {isLive ? <span className="qb-pill live">{t("queue.live")}</span> : null}
              {isCurrent ? <span className="qb-pill here">{t("queueBoard.thisVideo")}</span> : null}
              {p.external ? <span className="qb-pill">{t("queue.externalRunner")}</span> : null}
              {p.status === "paused" ? <span className="qb-pill warn">{statusLabel("paused", t)}</span> : null}
            </div>
            <div className="qb-card-meta">
              <span>{p.slug || "—"}</span>
              <span>·</span>
              <span>{pack}</span>
              {fmt ? (
                <>
                  <span>·</span>
                  <span>{fmt}</span>
                </>
              ) : null}
              <span>·</span>
              <span>{statusLabel(p.status, t)}</span>
            </div>
            <div className="qb-card-status">
              {isLive ? displayNowMsg : waitingLine(p, comfyQ, t)}
              {p.current_take ? (
                <span className="muted">
                  {" "}
                  · {t("queue.takeOnly", { n: p.current_take })}
                  {total ? ` / ${total}` : ""}
                </span>
              ) : null}
            </div>
            {total ? (
              <div className="qb-card-progress">
                <div className="progress">
                  <i style={{ width: `${Math.max(2, Math.min(100, isLive ? nowPct || pct : pct))}%` }} />
                </div>
                <span>
                  {t("library.takesMeta", { done: isLive ? nowDone || done : done, total })}
                  {isLive ? ` · ${nowPct || pct}%` : ""}
                </span>
              </div>
            ) : null}
            {p.stats?.waiting_for || p.runner_state?.last_ok || p.error ? (
              <div className="qb-card-extra muted">
                {p.error ? <span className="bad-text">{p.error}</span> : null}
                {!p.error && p.stats?.waiting_for ? <span>{t("queue.externalWait", { for: p.stats.waiting_for })}</span> : null}
                {!p.error && p.runner_state?.last_ok ? (
                  <span>
                    {t("queueBoard.lastOk")} · take{" "}
                    {typeof p.runner_state.last_ok === "object"
                      ? p.runner_state.last_ok.n ?? "—"
                      : p.runner_state.last_ok}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="qb-card-actions">{cardActions(p, { isLive, isCurrent })}</div>
      </article>
    );
  }

  return (
    <div className="queue-board">
      <div className="qb-summary">
        <div className="qb-summary-item">
          <span className="qb-label">{t("queueBoard.inQueue")}</span>
          <strong>{badge}</strong>
          <span className="muted">
            {(generating ? 1 : 0)} {t("queueBoard.liveCount")} · {waiting.length} {t("queue.waiting")} · {pending.length}{" "}
            {t("queue.reviewSection")}
          </span>
        </div>
        <div className="qb-summary-item">
          <span className="qb-label">Comfy</span>
          <strong className={comfyQ?.online ? (comfyQ?.busy ? "warn-text" : "ok-text") : "bad-text"}>
            {comfyQ?.online ? (comfyQ?.busy ? t("queueBoard.comfyBusy") : t("queueBoard.comfyIdleShort")) : t("queueBoard.comfyOff")}
          </strong>
          <span className="muted">{comfyLine}</span>
        </div>
        <div className="qb-summary-item">
          <span className="qb-label">{t("queue.queueEta")}</span>
          <strong>{estimate?.take_count ? queueDuration(estimate.total_min) : "—"}</strong>
          <span className="muted">
            {estimate?.finish_at ? `~${estimate.finish_at}` : t("queueBoard.noEta")}
            {estimate?.cost_brl != null ? ` · R$ ${estimate.cost_brl}` : ""}
          </span>
        </div>
        <div className="qb-summary-item qb-summary-actions">
          <span className="qb-label">{t("queueBoard.controls")}</span>
          <div className="qb-toolbar">
            {(externalOnly || hasExternal) && (
              <button type="button" disabled={busy || pendingActions.size > 0} onClick={() => run(() => api.externalSync(), t("queue.syncOk"))}>
                {t("queue.sync")}
              </button>
            )}
            {hasPaused || (!active && !now && !externalOnly) ? (
              <button type="button" className="primary" disabled={busy || pendingActions.size > 0} onClick={() => run(() => api.resume(), t("queue.resumed"))}>
                {t("queue.resumeInternal")}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || pendingActions.size > 0}
                onClick={() =>
                  run(async () => {
                    if (externalOnly || hasExternal) await api.comfyInterrupt();
                    else await api.pause();
                  }, externalOnly || hasExternal ? t("queue.comfyInterrupted") : t("queue.pausedToast"))
                }
              >
                {externalOnly ? t("queue.pauseComfy") : t("queue.pauseQueue")}
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => onRefresh?.()}>
              {t("common.refresh")}
            </button>
          </div>
        </div>
      </div>

      {estimate?.current ? (
        <div className="qb-eta-banner">
          <span>
            {t("queue.takeEta", { take: estimate.current.take || "—" })}{" "}
            <strong>{estimate.current.min} min</strong>
            {estimate.current.finish_at ? <span className="muted"> · ~{estimate.current.finish_at}</span> : null}
          </span>
          {typeof estimate.current.pct === "number" && estimate.current.pct > 0 ? (
            <div className="progress qb-eta-progress">
              <i style={{ width: `${Math.max(2, Math.min(99, estimate.current.pct))}%` }} />
            </div>
          ) : null}
          <span className="muted">
            {estimate.take_count} takes · {Math.round((estimate.sec_per_take || 0) / 60)} {t("queue.takeMin")} ·{" "}
            {estimate.source || t("queue.estimateSource")}
          </span>
        </div>
      ) : null}

      <section className="qb-section">
        <div className="qb-section-head">
          <h3>{t("queue.currentGen")}</h3>
        </div>
        {generating || now ? (
          card(generating || { id: now.project_id, title: now.title, slug: now.slug, progress: { completed: nowDone, total: nowTotal }, current_take: nowTake, status: "generating", is_active: true }, { role: "generating" })
        ) : hasPaused ? (
          <p className="muted qb-empty">{t("queue.queuePaused")}</p>
        ) : (
          <p className="muted qb-empty">{items.length ? t("queue.idleWaiting") : t("queue.noActiveJob")}</p>
        )}
      </section>

      <section className="qb-section">
        <div className="qb-section-head">
          <h3>{t("queue.waiting")}</h3>
          <span className="muted">{waiting.length ? t("queueBoard.waitingHint", { n: waiting.length }) : t("queue.empty")}</span>
        </div>
        {waiting.length ? (
          <div className="qb-list">
            {waiting.map((p, idx) => card(p, { role: "waiting", position: idx + 1 }))}
          </div>
        ) : (
          <p className="muted qb-empty">{t("queue.emptyHintEnqueue")}</p>
        )}
      </section>

      {pending.length > 0 ? (
        <section className="qb-section">
          <div className="qb-section-head">
            <h3>{t("queue.reviewSection")}</h3>
            <span className="muted">{pending.length}</span>
          </div>
          <div className="qb-list">
            {pending.map((p) => (
              <article key={`rev-${p.id}`} className={`qb-card qb-review ${p.id === currentProjectId ? "is-here" : ""}`}>
                <div className="qb-card-main">
                  <Thumb
                    project={p}
                    openLabel={t("queue.openProject")}
                    onOpen={onOpenProject ? () => onOpenProject(p.id) : undefined}
                  />
                  <div className="qb-card-body">
                    <div className="qb-card-top">
                      <strong>{cleanTitle(p.title)}</strong>
                      <span className="qb-pill warn">{t("status.awaiting_review")}</span>
                    </div>
                    <div className="qb-card-status">
                      {t("queue.takeWaiting", { take: p.review_take || "?" })}
                    </div>
                  </div>
                </div>
                <div className="qb-card-actions">
                  {onOpenReview ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() =>
                        onOpenReview({
                          project_id: p.id,
                          take: p.review_take,
                          total: (p.takes || []).length,
                          full_path: p.review_full_path,
                          current_path: p.review_current_path,
                          title: cleanTitle(p.title),
                        })
                      }
                    >
                      {t("queue.reviewBtn")}
                    </button>
                  ) : null}
                  {onOpenProject && p.id !== currentProjectId ? (
                    <button type="button" onClick={() => onOpenProject(p.id)}>
                      {t("queue.openProject")}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
