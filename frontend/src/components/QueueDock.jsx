import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import ContextMenu from "./ContextMenu.jsx";
import { useConfirm } from "./ConfirmDialog.jsx";
import { cleanTitle, initials, isNsfw, posterSrc, statusLabel } from "../utils.js";

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

function waitingStatusLine(p, comfyQ) {
  const pendingSlugs = (comfyQ?.pending_items || []).map((x) => x?.slug).filter(Boolean);
  const onComfy = pendingSlugs.includes(p.slug);
  if (onComfy) {
    return p.current_take ? `Na fila do Comfy · take ${p.current_take}` : "Na fila do Comfy";
  }
  if (p.external) {
    if (p.stats?.waiting_for) return `Espera ${p.stats.waiting_for}`;
    if (p.current_take) return `Aguardando · take ${p.current_take}`;
    return "Externo · aguardando";
  }
  return statusLabel(p.status);
}

export default function QueueDock({ queue, onOpenReview, onRefresh, setToast, onOpenProject }) {
  const confirm = useConfirm();
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
  const nowMsg =
    now?.message ||
    (nowTake ? `Take ${nowTake}${nowTotal ? `/${nowTotal}` : ""}` : "Gerando…");

  async function run(fn, okMsg) {
    setBusy(true);
    try {
      await fn();
      if (okMsg) setToast(okMsg);
      onRefresh();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function persistOrder(nextWaiting) {
    const ids = [
      ...(generating ? [generating.id] : []),
      ...nextWaiting.map((p) => p.id),
    ];
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
    setOrderedWaiting(next);
    setBusy(true);
    try {
      await persistOrder(next);
      setToast("Ordem da fila atualizada");
      onRefresh();
    } catch (e) {
      setToast(String(e.message || e));
      setOrderedWaiting(waitingFromServer);
    } finally {
      setBusy(false);
    }
  }

  async function runQueueAction(id, p) {
    try {
      if (id === "open" && onOpenProject) onOpenProject(p.id);
      if (id === "archive") {
        const ok = await confirm({
          title: "Arquivar história",
          message: `Arquivar “${cleanTitle(p.title)}”? Você pode restaurar depois.`,
          confirmLabel: "Arquivar",
        });
        if (!ok) return;
        await api.deleteProject(p.id, false);
        setToast("Arquivada");
        onRefresh();
      }
      if (id === "delete") {
        const ok = await confirm({
          title: "Excluir permanentemente",
          message: `Excluir “${cleanTitle(p.title)}”?\nApaga o projeto e os arquivos locais. Não dá para desfazer.`,
          confirmLabel: "Excluir",
          danger: true,
        });
        if (!ok) return;
        await api.deleteProject(p.id, true);
        setToast("Excluída");
        onRefresh();
      }
      if (id === "dequeue") {
        await api.dequeue(p.id);
        setToast("Removido da fila");
        onRefresh();
      }
      if (id === "resume") {
        await api.resume();
        setToast("Fila interna retomada");
        onRefresh();
      }
      if (id === "sync") {
        await api.externalSync();
        setToast("Sync externo");
        onRefresh();
      }
    } catch (e) {
      setToast(String(e.message || e));
    }
  }

  return (
    <div className={`queue-dock ${open ? "" : "collapsed"}`}>
      <div className="queue-dock-head" onClick={() => setOpen((v) => !v)}>
        <div className="row">
          <strong style={{ fontSize: 13 }}>Render queue</strong>
          {badgeCount > 0 ? <span className="badge">{badgeCount}</span> : null}
          {pending.length > 0 ? <span className="badge warn">{pending.length}</span> : null}
        </div>
        <span className="muted">{open ? "−" : "+"}</span>
      </div>
      {open ? (
        <div className="queue-dock-body stack">
          <div className="row q-meta-row">
            <div className="muted" style={{ fontSize: 11 }}>
              {comfyQ
                ? comfyQ.online
                  ? comfyQ.busy
                    ? `Comfy · ${comfyQ.running} run · ${comfyQ.pending} fila`
                    : "Comfy · ocioso"
                  : "Comfy · offline"
                : null}
            </div>
            <div className="q-toolbar">
              {externalOnly || hasExternal ? (
                <IconBtn
                  title="Sincronizar"
                  disabled={busy}
                  onClick={() => run(() => api.externalSync(), "Sync ok")}
                >
                  ↻
                </IconBtn>
              ) : null}
              {hasPaused || (!active && !external && !now && !externalOnly) ? (
                <IconBtn
                  title="Retomar fila interna"
                  disabled={busy}
                  onClick={() => run(() => api.resume(), "Retomado")}
                >
                  ▶
                </IconBtn>
              ) : (
                <IconBtn
                  title={externalOnly ? "Pausar Comfy (interrupt)" : "Pausar fila"}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (externalOnly || hasExternal) {
                        await api.comfyInterrupt();
                      } else {
                        await api.pause();
                      }
                    }, externalOnly || hasExternal ? "Comfy interrompido" : "Pausado")
                  }
                >
                  ❚❚
                </IconBtn>
              )}
            </div>
          </div>

          {generating || now ? (
            <section className="q-section">
              <div className="q-section-label">Geração atual</div>
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
                    <strong>{nowTitle || "Gerando"}</strong>
                    <span className="q-live-pill">AO VIVO</span>
                  </div>
                  <div className="q-now-msg">{nowMsg}</div>
                  <div className="q-now-progress-row">
                    <div className="progress q-now-progress">
                      <i style={{ width: `${Math.max(2, Math.min(100, nowPct))}%` }} />
                    </div>
                    <span className="q-now-pct">{nowPct}%</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {nowTotal
                      ? `${nowDone}/${nowTotal} takes`
                      : generating?.external
                        ? "Runner externo"
                        : "Worker interno"}
                    {now?.source === "external" || generating?.external
                      ? " · externo"
                      : now || generating
                        ? " · interno"
                        : ""}
                  </div>
                </div>
                {generating ? (
                  <div className="queue-item-actions">
                    {generating.external ? (
                      <IconBtn
                        title="Sincronizar"
                        disabled={busy}
                        onClick={() => run(() => api.externalSync(), "Sync ok")}
                      >
                        ↻
                      </IconBtn>
                    ) : null}
                    <IconBtn
                      title="Tirar da fila"
                      danger
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api.dequeue(generating.id);
                        }, "Removido da fila")
                      }
                    >
                      ✕
                    </IconBtn>
                  </div>
                ) : null}
              </div>
            </section>
          ) : hasPaused ? (
            <div className="muted">Fila pausada</div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              {items.length ? "Nada gerando agora — aguardando…" : "Nenhum job ativo"}
            </div>
          )}

          {estimate && estimate.take_count > 0 ? (
            <div className="q-eta stack">
              {estimate.current ? (
                <div className="q-eta-current">
                  Take {estimate.current.take || "—"} ≈{" "}
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
                Fila ≈ <strong>{estimate.total_min} min</strong>
                {estimate.finish_at ? (
                  <>
                    {" "}
                    · termina ~<strong>{estimate.finish_at}</strong>
                  </>
                ) : null}
                {" "}
                · R$ {estimate.cost_brl}
                <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                  {estimate.take_count} takes · {Math.round(estimate.sec_per_take / 60)} min/take ·{" "}
                  {estimate.source || "estimativa"}
                </div>
              </div>
            </div>
          ) : null}

          {pending.length > 0 ? (
            <section className="q-section">
              <div className="q-section-label">Revisão</div>
              {pending.map((p) => (
                <div key={`rev-${p.id}`} className="queue-item">
                  <QueueThumb project={p} />
                  <div>
                    <strong style={{ fontSize: 13 }}>{cleanTitle(p.title)}</strong>
                    <div className="muted">Take {p.review_take} aguardando</div>
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
                    Revisar
                  </button>
                </div>
              ))}
            </section>
          ) : null}

          {waiting.length > 0 ? (
            <section className="q-section">
              <div className="q-section-label">
                Na fila <span className="muted">· {waiting.length} · arraste para reordenar</span>
              </div>
              {waiting.map((p, idx) => (
                <div
                  key={p.id}
                  className={`queue-item is-waiting ${dragId === p.id ? "is-dragging" : ""} ${
                    overId === p.id && dragId !== p.id ? "drag-over" : ""
                  }`}
                  draggable={!busy}
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
                  <span className="q-drag-handle" title="Arrastar" aria-hidden>
                    ⋮⋮
                  </span>
                  <QueueThumb project={p} />
                  <div className="queue-item-main">
                    <strong style={{ fontSize: 13 }}>{cleanTitle(p.title)}</strong>
                    <div className="muted">
                      {waitingStatusLine(p, comfyQ)}
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
                    {p.external ? (
                      <IconBtn
                        title="Sincronizar"
                        disabled={busy}
                        onClick={() => run(() => api.externalSync(), "Sync ok")}
                      >
                        ↻
                      </IconBtn>
                    ) : null}
                    <IconBtn
                      title="Tirar da fila"
                      danger
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api.dequeue(p.id);
                        }, "Removido da fila")
                      }
                    >
                      ✕
                    </IconBtn>
                    <span className="q-pos">#{idx + 1}</span>
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {items.length === 0 && pending.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Fila vazia — enfileire uma história.
            </p>
          ) : null}
        </div>
      ) : null}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { id: "open", label: "Abrir projeto" },
            ...(menu.project?.external
              ? [{ id: "sync", label: "Sincronizar" }]
              : [{ id: "resume", label: "Retomar fila" }]),
            { id: "dequeue", label: "Tirar da fila" },
            { sep: true },
            { id: "archive", label: "Arquivar" },
            { id: "delete", label: "Excluir permanente", danger: true },
          ]}
          onClose={() => setMenu(null)}
          onPick={(id) => runQueueAction(id, menu.project)}
        />
      ) : null}
    </div>
  );
}
