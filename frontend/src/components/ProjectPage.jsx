import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useConfirm } from "./ConfirmDialog.jsx";
import { cleanTitle, fmtDate, isNsfw, posterSrc, statusLabel } from "../utils.js";

function reviewLabel(mode) {
  return mode === "com_revisao" ? "Com revisão" : "Automático";
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
    takes.map((t) => Number(t.n)).find((n) => n && !done.has(n)) ||
    null;
  const isGenerating = ["generating", "queued", "paused"].includes(project.status);

  async function enqueue() {
    setBusy(true);
    try {
      await api.enqueue(project.id);
      setToast("Na fila de geração");
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
      setToast("Roteiro regenerado");
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
      setToast("Nome atualizado");
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
          <span aria-hidden>←</span> Studio
        </button>
        <span className="pp-crumb-sep" aria-hidden>
          /
        </span>
        <span className="pp-crumb-title">{cleanTitle(project.title)}</span>
        <div className="pp-crumb-pills">
          <span className={`status-pill ${project.status}`}>{statusLabel(project.status)}</span>
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
            <p>Master ainda não gerado</p>
            <p className="muted">
              Monte o master a partir dos takes já renderizados, ou enfileire a geração.
            </p>
            <div className="row" style={{ justifyContent: "center", marginTop: 8 }}>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.buildMaster(project.id, true);
                    setMasterOk(true);
                    setProject({ ...project, has_master: true, master_url: r.master_url });
                    setToast(
                      r.built
                        ? `Master montado (${r.clip_count} clipes)`
                        : "Master já existia"
                    );
                    onRefresh();
                  } catch (e) {
                    setToast(String(e.message || e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Gerar master
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
                Salvar
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
                Cancelar
              </button>
            </div>
          ) : (
            <div className="pp-title-row">
              <h1 className="project-title">{cleanTitle(project.title)}</h1>
              <button
                type="button"
                className="pp-edit-title"
                title="Editar nome"
                aria-label="Editar nome do vídeo"
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
            <span>{fmtDate(project.updated_at || project.created_at)}</span>
            <span>·</span>
            <span>{project.slug}</span>
            {masterOk ? (
              <>
                <span>·</span>
                <span className="pp-meta-ok">master pronto</span>
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
              Baixar master
            </a>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.buildMaster(project.id, true);
                  setMasterOk(true);
                  setProject({ ...project, has_master: true, master_url: r.master_url });
                  setToast(
                    r.built
                      ? `Master montado (${r.clip_count} clipes)`
                      : "Master já existia"
                  );
                  onRefresh();
                } catch (e) {
                  setToast(String(e.message || e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Gerar master
            </button>
          )}
          <button
            type="button"
            className="primary pp-cta"
            disabled={busy || !takes.length || project.status === "archived"}
            onClick={enqueue}
          >
            {isDone ? "Gerar de novo" : "Enfileirar geração"}
          </button>
        </div>
      </header>

      <div className="pp-stats">
        <div className="pp-stat">
          <span className="pp-stat-label">Progresso</span>
          <strong>
            {done.size}/{takes.length || "—"} takes
          </strong>
          <div className="progress pp-progress">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="pp-stat">
          <span className="pp-stat-label">Tempo restante</span>
          <strong>{estimate ? `~${estimate.total_min} min` : "—"}</strong>
          <span className="muted">
            {estimate?.finish_at
              ? `termina ~${estimate.finish_at}`
              : remaining
                ? `${remaining} takes restantes`
                : "completo"}
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
          <span className="pp-stat-label">Custo est.</span>
          <strong>{estimate ? `R$ ${estimate.cost_brl}` : "—"}</strong>
          <span className="muted">{estimate?.source || "energia H3"}</span>
        </div>
        <div className="pp-stat">
          <span className="pp-stat-label">Revisão</span>
          <div className="pp-seg">
            <button
              type="button"
              className={project.review_mode !== "com_revisao" ? "on" : ""}
              onClick={() => setReviewMode("automatico")}
            >
              Auto
            </button>
            <button
              type="button"
              className={project.review_mode === "com_revisao" ? "on" : ""}
              onClick={() => setReviewMode("com_revisao")}
            >
              Take a take
            </button>
          </div>
        </div>
      </div>

      <div className="pp-body">
        <aside className="pp-side stack">
          <div className="pp-panel">
            <h2>Produção</h2>
            <dl className="pp-dl">
              <div>
                <dt>Pack</dt>
                <dd>{nsfw ? "NSFW" : "SFW"}</dd>
              </div>
              <div>
                <dt>Modo</dt>
                <dd>{reviewLabel(project.review_mode)}</dd>
              </div>
              <div>
                <dt>Estilo</dt>
                <dd>{project.style_name || project.style_id || "—"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{statusLabel(project.status)}</dd>
              </div>
            </dl>
            {isDone ? (
              <div className="alert good">Fluxo concluído — use o player acima.</div>
            ) : null}
            <div className="pp-side-actions">
              <button type="button" disabled={busy} onClick={regen}>
                Regenerar roteiro
              </button>
              {project.status === "archived" ? (
                <button
                  type="button"
                  onClick={async () => {
                    await api.restoreProject(project.id);
                    setToast("Restaurada");
                    onRefresh();
                  }}
                >
                  Restaurar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Arquivar história",
                      message: `Arquivar “${cleanTitle(project.title)}”? Você pode restaurar depois.`,
                      confirmLabel: "Arquivar",
                    });
                    if (!ok) return;
                    await api.deleteProject(project.id, false);
                    setToast("Arquivada");
                    onBack();
                    onRefresh();
                  }}
                >
                  Arquivar
                </button>
              )}
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: "Excluir permanentemente",
                    message: `Excluir “${cleanTitle(project.title)}”?\nApaga o projeto e os arquivos locais. Não dá para desfazer.`,
                    confirmLabel: "Excluir",
                    danger: true,
                  });
                  if (!ok) return;
                  await api.deleteProject(project.id, true);
                  setToast("Excluída");
                  onBack();
                  onRefresh();
                }}
              >
                Excluir
              </button>
            </div>
          </div>
        </aside>

        <section className="pp-shots">
          <div className="pp-shots-head">
            <h2>Shot list</h2>
            <span className="muted">
              {takes.length} takes · {done.size} prontos
            </span>
          </div>

          {takes.length === 0 ? (
            <div className="pp-shots-empty">
              <p>Sem takes ainda</p>
              <p className="muted">Gere o roteiro com IA para montar a lista.</p>
              <button type="button" className="primary" disabled={busy} onClick={regen}>
                Gerar roteiro
              </button>
            </div>
          ) : (
            <div className="pp-shot-list">
              {takes.map((t, idx) => {
                const n = Number(t.n);
                const ok = done.has(n);
                const open = focusTake === n;
                const live = isGenerating && currentTake === n;
                return (
                  <article
                    key={t.n || idx}
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
                        {ok ? "✓" : live ? "●" : t.n}
                      </span>
                      <div className="pp-shot-sum">
                        <strong>
                          Take {t.n}
                          <span className="pp-shot-kind">{t.kind}</span>
                          {live ? <span className="pp-shot-live">gerando</span> : null}
                        </strong>
                        <span className="muted">
                          {t.session} · {t.duration}s · seed {t.seed}
                          {ok ? " · pronto" : ""}
                        </span>
                      </div>
                      <span className="pp-shot-chev" aria-hidden>
                        {open ? "▾" : "▸"}
                      </span>
                    </button>
                    {open ? (
                      <textarea
                        className="pp-shot-prompt"
                        value={t.prompt}
                        onChange={(e) => {
                          const next = [...takes];
                          next[idx] = { ...t, prompt: e.target.value };
                          setProject({ ...project, takes: next });
                        }}
                        onBlur={async (e) => {
                          const next = [...takes];
                          next[idx] = { ...t, prompt: e.target.value };
                          await api.patchProject(project.id, { takes: next });
                        }}
                      />
                    ) : (
                      <p className="pp-shot-preview">{t.prompt}</p>
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
