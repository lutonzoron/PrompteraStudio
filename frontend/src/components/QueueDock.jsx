import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import ContextMenu from "./ContextMenu.jsx";
import { useConfirm } from "./ConfirmDialog.jsx";
import { cleanTitle, initials, isNsfw, posterSrc, statusLabel } from "../utils.js";
import { useT } from "../i18n/index.jsx";
import { runProjectAction, useProjectActions } from "../projectActions.js";

function queueDuration(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < 0) return "—";
  const total = Math.round(value);
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} min`;
}

function QueueThumb({ project }) {
  const [err, setErr] = useState(false);
  const src = posterSrc(project);

  if (isNsfw(project)) {
    return <div className="queue-thumb nsfw-thumb">NSFW</div>;
  }
  if (!src || err) {
    return (
      <div className="queue-thumb queue-thumb-fallback" aria-hidden>
        {initials(cleanTitle(project.title))}
      </div>
    );
  }
  return (
    <img
      className="queue-thumb"
      src={src}
      alt=""
      onError={() => setErr(true)}
    />
  );
}

function IconBtn({ title, onClick, danger, children, disabled }) {
  return (
    <button
      type="button"
      className={`q-icon-btn ${danger ? "danger" : ""}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}

function waitingStatusLine(p, comfyQ, t) {
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

export default function QueueDock({ queue, onOpenReview, onRefresh, setToast, onOpenProject, prioritizeAvailable = false }) {
  const t = useT();
  const confirm = useConfirm();
  const pendingActions = useProjectActions();
  const busyRef = useRef(false);
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState(null);
  const [busy, setBusy] = useState(false);
  const [orderedWaiting, setOrderedWaiting] = useState([]);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const draggingRef = useRef(false);

  const items = queue?.items || [];
  const pending = queue?.pending_reviews || [];
  const active = queue?.active_job;
  const now = queue?.now;
  const external = queue?.external_active;
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

  const waitingFromServer = useMemo(
    () =>
      items.filter(
        (p) => p.status !== "awaiting_review" && (!generating || p.id !== generating.id)
      ),
    [items, generating]
  );

  useEffect(() => {
    if (draggingRef.current) return;
    setOrderedWaiting(waitingFromServer);
  }, [waitingFromServer]);

  const waiting = orderedWaiting;
  const badgeCount = (generating ? 1 : 0) + waiting.length + pending.length;

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

  async function run(fn, okMsg) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
      if (okMsg) setToast(okMsg);
      await onRefresh();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function persistOrder(nextWaiting) {
    const ids = [...(generating ? [generating.id] : []), ...nextWaiting.map((p) => p.id)];
    await api.reorder(ids);
  }

  function moveItem(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return orderedWaiting;
    const list = [...orderedWaiting];
    const from = list.findIndex((p) => p.id === fromId);
    const to = list.findIndex((p) => p.id === toId);
    if (from < 0 || to < 0) return orderedWaiting;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    return list;
  }

  async function commitReorder(next) {
    if (busyRef.current) return;
    busyRef.current = true;
    setOrderedWaiting(next);
    setBusy(true);
    try {
      await persistOrder(next);
      setToast(t("queue.reorderToast"));
      await onRefresh();
    } catch (e) {
      setToast(String(e.message || e));
      setOrderedWaiting(waitingFromServer);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const menuItems = useMemo(
    () => (project) => [
      { id: "open", label: t("queue.openProject") },
      ...(!project?.external && !project?.is_active ? [{
        id: "prioritize", label: t("queue.prioritize"), disabled: !prioritizeAvailable,
        title: t(prioritizeAvailable ? "queue.prioritizeHint" : "queue.prioritizeNeedsRestart"),
      }] : []),
      ...(project?.external
        ? [{ id: "sync", label: t("queue.sync") }]
        : [{ id: "resume", label: t("queue.resumeQueue") }]),
      { id: "dequeue", label: t("queue.dequeue") },
      { sep: true },
      { id: "archive", label: t("queue.archive") },
      { id: "delete", label: t("queue.deletePermanent"), danger: true },
    ],
    [t, prioritizeAvailable]
  );

  async function runQueueAction(id, p) {
    if (busyRef.current) return;
    const actionLabel = menuItems(p).find((item) => item.id === id)?.label || id;
    return runProjectAction(p.id, t("actions.pending", { action: actionLabel, title: cleanTitle(p.title) }), async () => {
      busyRef.current = true;
      setBusy(true);
      try {
        if (id === "open" && onOpenProject) await onOpenProject(p.id);
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
        if (id === "delete") {
          const ok = await confirm({
            title: t("queue.deleteTitle"),
            message: t("queue.deleteMsg", { title: cleanTitle(p.title) }),
            confirmLabel: t("common.delete"),
            danger: true,
          });
          if (!ok) return;
          await api.deleteProject(p.id, true);
          setToast(t("queue.deletedToast"));
          await onRefresh();
        }
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
        if (id === "resume") {
          await api.resume();
          setToast(t("queue.resumeInternalToast"));
          await onRefresh();
        }
        if (id === "sync") {
          await api.externalSync();
          setToast(t("queue.syncExternalToast"));
          await onRefresh();
        }
      } catch (e) {
        setToast(String(e.message || e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    });
  }

  const menuProject = menu ? items.find((p) => p.id === menu.project.id) || menu.project : null;

  let comfyLine = null;
  if (comfyQ) {
    if (comfyQ.online) {
      comfyLine = comfyQ.busy
        ? t("queue.comfyRun", { running: comfyQ.running, pending: comfyQ.pending })
        : t("queue.comfyIdle");
    } else {
      comfyLine = t("queue.comfyOffline");
    }
  }

  return (
    <div className={`queue-dock ${open ? "" : "collapsed"}`}>
      <div className="queue-dock-head" onClick={() => setOpen((v) => !v)}>
        <div className="row">
          <strong style={{ fontSize: 13 }}>{t("queue.title")}</strong>
          {badgeCount > 0 ? <span className="badge">{badgeCount}</span> : null}
          {pending.length > 0 ? <span className="badge warn">{pending.length}</span> : null}
        </div>
        <span className="muted">{open ? "−" : "+"}</span>
      </div>
      {open ? (
        <div className="queue-dock-body stack">
          <div className="row q-meta-row">
            <div className="muted" style={{ fontSize: 11 }}>
              {comfyLine}
            </div>
            <div className="q-toolbar">
              {externalOnly || hasExternal ? (
                <IconBtn
                  title={t("queue.sync")}
                  disabled={busy || pendingActions.size > 0}
                  onClick={() => run(() => api.externalSync(), t("queue.syncOk"))}
                >
                  ↻
                </IconBtn>
              ) : null}
              {hasPaused || (!active && !external && !now && !externalOnly) ? (
                <IconBtn
                  title={t("queue.resumeInternal")}
                  disabled={busy || pendingActions.size > 0}
                  onClick={() => run(() => api.resume(), t("queue.resumed"))}
                >
                  ▶
                </IconBtn>
              ) : (
                <IconBtn
                  title={externalOnly ? t("queue.pauseComfy") : t("queue.pauseQueue")}
                  disabled={busy || pendingActions.size > 0}
                  onClick={() =>
                    run(
                      async () => {
                        if (externalOnly || hasExternal) {
                          await api.comfyInterrupt();
                        } else {
                          await api.pause();
                        }
                      },
                      externalOnly || hasExternal ? t("queue.comfyInterrupted") : t("queue.pausedToast")
                    )
                  }
                >
                  ❚❚
                </IconBtn>
              )}
            </div>
          </div>

          {generating || now ? (
            <section className="q-section">
              <div className="q-section-label">{t("queue.currentGen")}</div>
              <div
                className="q-now"
                onDoubleClick={() => generating && onOpenProject?.(generating.id)}
                onContextMenu={(e) => {
                  if (!generating) return;
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, project: generating });
                }}
              >
                {generating ? <QueueThumb project={generating} /> : <div className="queue-thumb" />}
                <div className="q-now-main">
                  <div className="q-now-top">
                    <strong>{nowTitle || t("queue.generating")}</strong>
                    <span className="q-live-pill">{t("queue.live")}</span>
                  </div>
                  <div className="q-now-msg">{displayNowMsg}</div>
                  <div className="q-now-progress-row">
                    <div className="progress q-now-progress">
                      <i style={{ width: `${Math.max(2, Math.min(100, nowPct))}%` }} />
                    </div>
                    <span className="q-now-pct">{nowPct}%</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {nowTotal
                      ? t("library.takesMeta", { done: nowDone, total: nowTotal })
                      : generating?.external
                        ? t("queue.externalRunner")
                        : t("queue.internalWorker")}
                    {now?.source === "external" || generating?.external
                      ? t("queue.tagExternal")
                      : now || generating
                        ? t("queue.tagInternal")
                        : ""}
                  </div>
                </div>
                {generating ? (
                  <div className="queue-item-actions">
                    {generating.external ? (
                      <IconBtn
                        title={t("queue.sync")}
                        disabled={busy || pendingActions.size > 0}
                        onClick={() => run(() => api.externalSync(), t("queue.syncOk"))}
                      >
                        ↻
                      </IconBtn>
                    ) : null}
                    <IconBtn
                      title={t("queue.dequeue")}
                      danger
                      disabled={busy || pendingActions.size > 0}
                      onClick={() =>
                        run(async () => {
                          await api.dequeue(generating.id);
                        }, t("queue.dequeueToast"))
                      }
                    >
                      ✕
                    </IconBtn>
                  </div>
                ) : null}
              </div>
            </section>
          ) : hasPaused ? (
            <div className="muted">{t("queue.queuePaused")}</div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              {items.length ? t("queue.idleWaiting") : t("queue.noActiveJob")}
            </div>
          )}

          {estimate && estimate.take_count > 0 ? (
            <div className="q-eta stack">
              {estimate.current ? (
                <div className="q-eta-current">
                  {t("queue.takeEta", { take: estimate.current.take || "—" })}{" "}
                  <strong>{estimate.current.min} min</strong>
                  {estimate.current.finish_at ? (
                    <span className="muted"> · ~{estimate.current.finish_at}</span>
                  ) : null}
                  {typeof estimate.current.pct === "number" && estimate.current.pct > 0 ? (
                    <div className="progress q-item-progress" style={{ marginTop: 6 }}>
                      <i style={{ width: `${Math.max(2, Math.min(99, estimate.current.pct))}%` }} />
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="cta-cost" style={{ margin: 0 }}>
                {t("queue.queueEta")} <strong>{queueDuration(estimate.total_min)}</strong>
                {estimate.finish_at ? (
                  <>
                    {" "}
                    · {t("queue.finishes")}
                    <strong>{estimate.finish_at}</strong>
                  </>
                ) : null}{" "}
                · R$ {estimate.cost_brl}
                <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                  {estimate.take_count} takes · {Math.round(estimate.sec_per_take / 60)}{" "}
                  {t("queue.takeMin")} · {estimate.source || t("queue.estimateSource")}
                </div>
              </div>
            </div>
          ) : null}

          {pending.length > 0 ? (
            <section className="q-section">
              <div className="q-section-label">{t("queue.reviewSection")}</div>
              <div className="q-review-list">
              {pending.map((p) => (
                <div key={`rev-${p.id}`} className="queue-item">
                  <QueueThumb project={p} />
                  <div>
                    <strong style={{ fontSize: 13 }}>{cleanTitle(p.title)}</strong>
                    <div className="muted">
                      {t("queue.takeWaiting", { take: p.review_take })}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="danger"
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
                </div>
              ))}
              </div>
            </section>
          ) : null}

          {waiting.length > 0 ? (
            <section className="q-section q-waiting-section">
              <div className="q-section-label">
                {t("queue.waiting")}{" "}
                <span className="muted">
                  {t("queue.waitingHint", { n: waiting.length })}
                </span>
              </div>
              <div className="q-waiting-list" role="region" aria-label={t("queue.waiting")} tabIndex={0}>
              {waiting.map((p, idx) => (
                <div
                  key={p.id}
                  className={`queue-item is-waiting ${dragId === p.id ? "is-dragging" : ""} ${
                    overId === p.id && dragId !== p.id ? "drag-over" : ""
                  }`}
                  draggable={!busy && !pendingActions.has(p.id)}
                  onDragStart={(e) => {
                    draggingRef.current = true;
                    setDragId(p.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", p.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overId !== p.id) setOverId(p.id);
                  }}
                  onDragLeave={() => {
                    if (overId === p.id) setOverId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const fromId = e.dataTransfer.getData("text/plain") || dragId;
                    const next = moveItem(fromId, p.id);
                    setOverId(null);
                    setDragId(null);
                    draggingRef.current = false;
                    if (next !== orderedWaiting) {
                      void commitReorder(next);
                    }
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                    draggingRef.current = false;
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, project: p });
                  }}
                  onDoubleClick={() => onOpenProject?.(p.id)}
                >
                  <span className="q-drag-handle" title={t("queue.dragHandle")} aria-hidden>
                    ⋮⋮
                  </span>
                  <QueueThumb project={p} />
                  <div className="queue-item-main">
                    <strong style={{ fontSize: 13 }}>{cleanTitle(p.title)}</strong>
                    {pendingActions.has(p.id) && <div className="project-action-pending">
                      <span className="request-spinner" aria-hidden="true" /> {pendingActions.get(p.id)}
                    </div>}
                    <div className="muted">
                      {waitingStatusLine(p, comfyQ, t)}
                      {" · "}
                      {p.progress
                        ? `${p.progress.completed}/${p.progress.total}`
                        : (p.takes || []).length}{" "}
                      takes
                    </div>
                    {p.progress?.total ? (
                      <div className="progress q-item-progress">
                        <i
                          style={{
                            width: `${Math.round(
                              (100 * (p.progress.completed || 0)) / p.progress.total
                            )}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="queue-item-actions">
                    {!p.external && <button type="button" className="q-prioritize"
                      title={t("queue.prioritize")}
                      aria-label={t("queue.prioritize")}
                      disabled={!prioritizeAvailable || busy || pendingActions.size > 0}
                      onClick={(e) => { e.stopPropagation(); void runQueueAction("prioritize", p); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>}
                    {p.external ? (
                      <IconBtn
                        title={t("queue.sync")}
                        disabled={busy || pendingActions.size > 0}
                        onClick={() => run(() => api.externalSync(), t("queue.syncOk"))}
                      >
                        ↻
                      </IconBtn>
                    ) : null}
                    <IconBtn
                      title={t("queue.dequeue")}
                      danger
                      disabled={busy || pendingActions.size > 0}
                      onClick={() =>
                        run(async () => {
                          await api.dequeue(p.id);
                        }, t("queue.dequeueToast"))
                      }
                    >
                      ✕
                    </IconBtn>
                    <span className="q-pos">#{idx + 1}</span>
                  </div>
                </div>
              ))}
              </div>
            </section>
          ) : null}

          {items.length === 0 && pending.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {t("queue.emptyHintEnqueue")}
            </p>
          ) : null}
        </div>
      ) : null}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menuProject).map((item) => ({ ...item, disabled: busy || item.disabled }))}
          pendingLabel={pendingActions.get(menuProject.id)}
          onClose={() => setMenu(null)}
          onPick={(id) => runQueueAction(id, menuProject)}
        />
      ) : null}
    </div>
  );
}
