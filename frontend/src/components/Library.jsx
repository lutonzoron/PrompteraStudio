import React, { useState } from "react";
import { api } from "../api.js";
import ContextMenu from "./ContextMenu.jsx";
import { cleanTitle, fmtDate, initials, isNsfw, posterSrc, statusLabel } from "../utils.js";

const FILTERS = [
  ["all", "Todas"],
  ["draft", "Rascunho"],
  ["queued", "Na fila"],
  ["active", "Gerando"],
  ["done", "Prontas"],
  ["failed", "Falhas"],
  ["nsfw", "NSFW"],
  ["sfw", "SFW"],
];

const SORTS = [
  ["updated_desc", "Mais recentes"],
  ["updated_asc", "Mais antigos"],
  ["title_asc", "Título A–Z"],
  ["title_desc", "Título Z–A"],
  ["status", "Por status"],
  ["progress_desc", "Mais avançados"],
  ["nsfw_first", "NSFW primeiro"],
];

const STATUS_RANK = {
  generating: 0,
  awaiting_review: 1,
  queued: 2,
  paused: 3,
  draft: 4,
  failed: 5,
  done: 6,
  archived: 7,
};

function sortProjects(list, sort) {
  const arr = [...list];
  const titleOf = (p) => cleanTitle(p.title || p.slug || "").toLowerCase();
  const progOf = (p) => {
    const total = p.progress?.total || (p.takes || []).length || 0;
    const done = p.progress?.completed || 0;
    return total ? done / total : 0;
  };
  arr.sort((a, b) => {
    switch (sort) {
      case "updated_asc":
        return (a.updated_at || 0) - (b.updated_at || 0);
      case "title_asc":
        return titleOf(a).localeCompare(titleOf(b), "pt");
      case "title_desc":
        return titleOf(b).localeCompare(titleOf(a), "pt");
      case "status": {
        const ra = STATUS_RANK[a.status] ?? 50;
        const rb = STATUS_RANK[b.status] ?? 50;
        if (ra !== rb) return ra - rb;
        return (b.updated_at || 0) - (a.updated_at || 0);
      }
      case "progress_desc": {
        const d = progOf(b) - progOf(a);
        if (d !== 0) return d;
        return (b.updated_at || 0) - (a.updated_at || 0);
      }
      case "nsfw_first": {
        const na = isNsfw(a) ? 0 : 1;
        const nb = isNsfw(b) ? 0 : 1;
        if (na !== nb) return na - nb;
        return (b.updated_at || 0) - (a.updated_at || 0);
      }
      case "updated_desc":
      default:
        return (b.updated_at || 0) - (a.updated_at || 0);
    }
  });
  return arr;
}

function menuItemsFor(p) {
  const archived = p.status === "archived";
  const hasTakes = (p.takes || []).length > 0;
  const items = [
    { id: "open", label: "Abrir" },
    {
      id: "enqueue",
      label: "Colocar na fila",
      disabled: archived || !hasTakes,
    },
  ];
  if (p.has_master) {
    items.push({ id: "download", label: "Baixar master" });
  }
  items.push({ sep: true });
  items.push({
    id: "review_auto",
    label: "Revisão: automático",
    disabled: archived,
  });
  items.push({
    id: "review_manual",
    label: "Revisão: take a take",
    disabled: archived,
  });
  items.push({ sep: true });
  items.push({ id: "copy_title", label: "Copiar título" });
  items.push({ id: "copy_slug", label: "Copiar slug" });
  items.push({ sep: true });
  if (archived) {
    items.push({ id: "restore", label: "Restaurar" });
  } else {
    items.push({ id: "archive", label: "Arquivar", danger: true });
  }
  return items;
}

function Poster({ project }) {
  const [err, setErr] = useState(false);
  if (isNsfw(project)) {
    return (
      <div className="thumb-fallback nsfw-cover">
        <span className="nsfw-tag">NSFW</span>
        <span className="nsfw-hint">sem capa</span>
      </div>
    );
  }
  if (err) {
    return <div className="thumb-fallback">{initials(project.title)}</div>;
  }
  return (
    <img
      className="thumb"
      src={posterSrc(project)}
      alt=""
      loading="lazy"
      onError={() => setErr(true)}
    />
  );
}

export default function Library({
  projects,
  selectedId,
  showArchived,
  setShowArchived,
  onSelect,
  onCreate,
  onRefresh,
  setToast,
}) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(null);
  const [sort, setSort] = useState(() => {
    try {
      return localStorage.getItem("promptera_library_sort") || "updated_desc";
    } catch {
      return "updated_desc";
    }
  });

  const filtered = sortProjects(
    projects.filter((p) => {
      if (filter === "draft" && p.status !== "draft") return false;
      if (filter === "queued" && p.status !== "queued") return false;
      if (
        filter === "active" &&
        !["generating", "awaiting_review", "paused"].includes(p.status)
      )
        return false;
      if (filter === "done" && p.status !== "done") return false;
      if (filter === "failed" && p.status !== "failed") return false;
      if (filter === "nsfw" && !isNsfw(p)) return false;
      if (filter === "sfw" && isNsfw(p)) return false;
      if (q.trim()) {
        const hay = `${p.title} ${p.slug} ${p.brief || ""} ${p.synopsis || ""}`.toLowerCase();
        if (!hay.includes(q.trim().toLowerCase())) return false;
      }
      return true;
    }),
    sort
  );

  async function runAction(actionId, p) {
    try {
      if (actionId === "open") {
        onSelect(p.id);
        return;
      }
      if (actionId === "enqueue") {
        await api.enqueue(p.id);
        setToast?.("Na fila de geração");
        onRefresh?.();
        return;
      }
      if (actionId === "download") {
        const a = document.createElement("a");
        a.href = `/api/projects/${p.id}/master`;
        a.download = `${p.slug || "video"}_master.mp4`;
        a.click();
        return;
      }
      if (actionId === "review_auto") {
        await api.patchProject(p.id, { review_mode: "automatico" });
        setToast?.("Revisão automática");
        onRefresh?.();
        return;
      }
      if (actionId === "review_manual") {
        await api.patchProject(p.id, { review_mode: "com_revisao" });
        setToast?.("Revisão take a take");
        onRefresh?.();
        return;
      }
      if (actionId === "copy_title") {
        await navigator.clipboard.writeText(cleanTitle(p.title));
        setToast?.("Título copiado");
        return;
      }
      if (actionId === "copy_slug") {
        await navigator.clipboard.writeText(p.slug || p.id);
        setToast?.("Slug copiado");
        return;
      }
      if (actionId === "archive") {
        if (!confirm(`Arquivar “${cleanTitle(p.title)}”?`)) return;
        await api.deleteProject(p.id, false);
        setToast?.("Arquivada");
        onRefresh?.();
        return;
      }
      if (actionId === "restore") {
        await api.restoreProject(p.id);
        setToast?.("Restaurada");
        onRefresh?.();
      }
    } catch (e) {
      setToast?.(String(e.message || e));
    }
  }

  return (
    <div onContextMenu={(e) => {
      // keep native menu only outside cards
      if (!e.target.closest?.(".proj-card")) return;
      e.preventDefault();
    }}>
      <div className="page-head">
        <div>
          <h1>Studio</h1>
          <p>{projects.length} histórias · Continuity H3 local</p>
        </div>
        <div className="row">
          <button type="button" className="primary" onClick={onCreate}>
            Nova história
          </button>
        </div>
      </div>

      <div className="filters">
        <input
          placeholder="Buscar…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`chip ${filter === id ? "active" : ""}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={`chip chip-archive ${showArchived ? "active" : ""}`}
          aria-pressed={showArchived}
          title={showArchived ? "Ocultar arquivadas" : "Mostrar arquivadas"}
          onClick={() => setShowArchived(!showArchived)}
        >
          {showArchived ? "Arquivadas · on" : "Arquivadas"}
        </button>
        <label className="sort-field">
          <span>Ordenar</span>
          <select
            value={sort}
            onChange={(e) => {
              const v = e.target.value;
              setSort(v);
              try {
                localStorage.setItem("promptera_library_sort", v);
              } catch {}
            }}
          >
            {SORTS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {showArchived ? (
        <div className="archive-banner">
          <span>
            Exibindo arquivadas junto com as ativas
            {projects.some((p) => p.status === "archived")
              ? ` · ${projects.filter((p) => p.status === "archived").length} arquivada(s)`
              : " · nenhuma arquivada ainda"}
          </span>
          <button type="button" className="ghost" onClick={() => setShowArchived(false)}>
            Ocultar
          </button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="empty-hero">
          <h2>Nada por aqui</h2>
          <p>
            {showArchived
              ? "Nenhuma história neste filtro (incluindo arquivadas)."
              : "Crie uma história para começar o fluxo Continuity."}
          </p>
          <div className="row" style={{ justifyContent: "center" }}>
            {showArchived ? (
              <button type="button" onClick={() => setShowArchived(false)}>
                Voltar às ativas
              </button>
            ) : (
              <button type="button" className="primary" onClick={onCreate}>
                Criar agora
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="library-grid">
          {filtered.map((p) => {
            const prog = p.progress || { completed: 0, total: (p.takes || []).length };
            const total = prog.total || (p.takes || []).length || 0;
            const pct = total ? Math.round((prog.completed / total) * 100) : 0;
            return (
              <button
                key={p.id}
                type="button"
                className={`proj-card ${selectedId === p.id ? "selected" : ""} ${
                  menu?.project?.id === p.id ? "ctx-open" : ""
                }`}
                onClick={() => onSelect(p.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ x: e.clientX, y: e.clientY, project: p });
                }}
              >
                <Poster project={p} />
                <div className="scrim" />
                <div className="top-badges">
                  <span className={`status-pill ${p.status}`}>{statusLabel(p.status)}</span>
                  {isNsfw(p) ? (
                    <span className="status-pill nsfw">NSFW</span>
                  ) : (
                    <span className="status-pill sfw">SFW</span>
                  )}
                </div>
                <div className="meta">
                  <strong>{cleanTitle(p.title)}</strong>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {prog.completed}/{total || "—"} takes
                    {p.has_master ? " · master" : ""}
                  </div>
                  <div className="progress">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="muted" style={{ fontSize: 10 }}>
                    {fmtDate(p.updated_at)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItemsFor(menu.project)}
          onClose={() => setMenu(null)}
          onPick={(id) => runAction(id, menu.project)}
        />
      ) : null}
    </div>
  );
}
