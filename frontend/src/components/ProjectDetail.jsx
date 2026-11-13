import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useConfirm } from "./ConfirmDialog.jsx";
import { initials, isNsfw, posterSrc, statusLabel } from "../utils.js";

export default function ProjectDetail({
  project,
  setProject,
  busy,
  setBusy,
  setToast,
  onRefresh,
  onClose,
}) {
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
  const isDone = project.status === "done" || (takes.length > 0 && remaining === 0 && masterOk);
  const nsfw = isNsfw(project);

  return (
    <aside className="detail-panel stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <span className={`status-pill ${project.status}`}>{statusLabel(project.status)}</span>
          {nsfw ? <span className="status-pill nsfw">NSFW</span> : <span className="status-pill sfw">SFW</span>}
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          Fechar
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
              Baixar master
            </a>
            <span className="muted">Vídeo final{nsfw ? " · sem capa NSFW" : ""}</span>
          </div>
        </div>
      ) : nsfw ? (
        <div className="detail-poster thumb-fallback nsfw-cover" style={{ position: "relative" }}>
          <span className="nsfw-tag">NSFW</span>
          <span className="nsfw-hint">capa ocultada</span>
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
      <p className="muted">{project.synopsis || project.brief || "Sem sinopse"}</p>
      <div className="muted">
        {done.size}/{takes.length} takes · {nsfw ? "NSFW" : "SFW"} · {project.review_mode}
        {masterOk ? " · master pronto" : ""}
      </div>

      <div className="field">
        <label>Modo de revisão</label>
        <select
          value={project.review_mode}
          onChange={async (e) => {
            await api.patchProject(project.id, { review_mode: e.target.value });
            onRefresh();
            const p = await api.project(project.id);
            setProject(p);
          }}
        >
          <option value="automatico">Automático</option>
          <option value="com_revisao">Com revisão take a take</option>
        </select>
      </div>

      <h3 style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>Shot list</h3>
      <div className="shot-list">
        {takes.map((t, idx) => (
          <div key={t.n || idx} className="shot">
            <header>
              <span>
                #{t.n} · {t.kind} · {t.session} · {t.duration}s
                {done.has(Number(t.n)) || done.has(t.n) ? " ✓" : ""}
              </span>
              <span>seed {t.seed}</span>
            </header>
            <textarea
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
          </div>
        ))}
        {takes.length === 0 ? (
          <p className="muted">Sem takes — gere o roteiro com IA ou via Cursor (pasta inbox).</p>
        ) : null}
      </div>

      <div className="cta-bar">
        {isDone ? (
          <div className="alert good">Fluxo concluído — use o player acima para ver o resultado.</div>
        ) : estimate ? (
          <div className="cta-cost">
            Faltam ~{remaining || takes.length} takes ·{" "}
            <strong>~{estimate.total_min} min</strong> · <strong>R$ {estimate.cost_brl}</strong>
          </div>
        ) : (
          <div className="cta-cost">Calculando custo…</div>
        )}
        <button
          type="button"
          className="primary"
          disabled={busy || !takes.length || project.status === "archived"}
          onClick={async () => {
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
          }}
        >
          {isDone ? "Gerar de novo" : "Enfileirar geração"}
        </button>
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
                setToast("Roteiro regenerado");
                onRefresh();
              } catch (e) {
                setToast(String(e.message || e));
              } finally {
                setBusy(false);
              }
            }}
          >
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
                  message: "Arquivar esta história? Você pode restaurar depois.",
                  confirmLabel: "Arquivar",
                });
                if (!ok) return;
                await api.deleteProject(project.id, false);
                setToast("Arquivada");
                onClose();
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
                message:
                  "Excluir esta história?\nApaga o projeto e os arquivos locais. Não dá para desfazer.",
                confirmLabel: "Excluir",
                danger: true,
              });
              if (!ok) return;
              await api.deleteProject(project.id, true);
              setToast("Excluída");
              onClose();
              onRefresh();
            }}
          >
            Excluir
          </button>
        </div>
      </div>
    </aside>
  );
}
