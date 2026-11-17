import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import ContextMenu from "./ContextMenu.jsx";
import { useConfirm } from "./ConfirmDialog.jsx";
import { cleanTitle, fmtDate, formatElapsed, initials, isNsfw, isProjectComplete, posterSrc, statusLabel } from "../utils.js";
import { useLocale, useT } from "../i18n/index.jsx";
import { runProjectAction, useProjectActions } from "../projectActions.js";

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

function sortProjects(list, sort, collatorLocale) {
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
        return titleOf(a).localeCompare(titleOf(b), collatorLocale);
      case "title_desc":
        return titleOf(b).localeCompare(titleOf(a), collatorLocale);
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

function menuItemsFor(p, t, regenerateAvailable = false) {
  const archived = p.status === "archived";
  const hasTakes = (p.takes || []).length > 0;
  const inQueue = ["queued", "generating", "paused", "awaiting_review"].includes(p.status);
  const items = [
    { id: "open", label: t("library.open") },
  ];
  if (!isProjectComplete(p)) {
    items.push({
      id: "enqueue",
      label: t(inQueue ? "actions.alreadyQueued" : "library.enqueue"),
      disabled: archived || !hasTakes || inQueue,
    });
  }
  if (p.has_master) {
    items.push({ id: "download", label: t("library.downloadMaster") });
  }
  if (p.status === 'done' && hasTakes) {
    items.push({ id: 'regenerate_video', label: t('library.regenerateVideo'), danger: true,
                 disabled: !regenerateAvailable, title: regenerateAvailable ? undefined : t('library.regenerateNeedsRestart') });
  }
  items.push({ sep: true });
  items.push({
    id: "review_auto",
    label: t("library.reviewAuto"),
    disabled: archived,
  });
  items.push({
    id: "review_manual",
    label: t("library.reviewManual"),
    disabled: archived,
  });
  items.push({ sep: true });
  items.push({ id: "copy_title", label: t("library.copyTitle") });
  items.push({ id: "copy_slug", label: t("library.copySlug") });
  items.push({ sep: true });
  if (archived) {
    items.push({ id: "restore", label: t("library.restore") });
  } else {
    items.push({ id: "archive", label: t("common.archive") });
  }
  items.push({ id: "delete", label: t("library.deletePermanent"), danger: true });
  return items;
}

function Poster({ project, t }) {
  const [err, setErr] = useState(false);
  if (isNsfw(project)) {
    return (
      <div className="thumb-fallback nsfw-cover">
        <span className="nsfw-tag">NSFW</span>
        <span className="nsfw-hint">{t("library.noCover")}</span>
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
  regenerateAvailable = false,
  projects,
  selectedId,
  showArchived,
  setShowArchived,
  onSelect,
  onCreate,
  onRefresh,
  setToast,
}) {
  const t = useT();
  const { locale, dateLocale } = useLocale();
  const confirm = useConfirm();
  const pendingActions = useProjectActions();
  const [filter, setFilter] = useState("all");
  const [category, setCategory] = useState('all');
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(null);
  const [sort, setSort] = useState(() => {
    try {
      return localStorage.getItem("promptera_library_sort") || "updated_desc";
    } catch {
      return "updated_desc";
    }
  });

  const collatorLocale = locale === "pt" ? "pt" : "en";

  const filters = useMemo(
    () => [
      ["all", t("library.filterAll")],
      ["draft", t("library.filterDraft")],
      ["queued", t("library.filterQueued")],
      ["active", t("library.filterActive")],
      ["done", t("library.filterDone")],
      ["failed", t("library.filterFailed")],
      ["nsfw", t("library.filterNsfw")],
      ["sfw", t("library.filterSfw")],
    ],
    [t]
  );

  const sorts = useMemo(
    () => [
      ["updated_desc", t("library.sortRecent")],
      ["updated_asc", t("library.sortOldest")],
      ["title_asc", t("library.sortTitleAsc")],
      ["title_desc", t("library.sortTitleDesc")],
      ["status", t("library.sortStatus")],
      ["progress_desc", t("library.sortProgress")],
      ["nsfw_first", t("library.sortNsfwFirst")],
    ],
    [t]
  );

  const archivedCount = projects.filter((p) => p.status === "archived").length;

  const filtered = sortProjects(
    projects.filter((p) => {
      if (category !== 'all' && (p.category || 'general') !== category) return false;
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
    sort,
    collatorLocale
  );

  async function runAction(actionId, p) {
    const actionLabel = menuItemsFor(p, t, regenerateAvailable).find((item) => item.id === actionId)?.label || actionId;
    return runProjectAction(p.id, t("actions.pending", { action: actionLabel, title: cleanTitle(p.title) }), async () => {
      try {
        if (actionId === "open") {
          await onSelect(p.id);
          return;
        }
        if (actionId === "enqueue") {
          if (isProjectComplete(p) || ["queued", "generating", "paused", "awaiting_review"].includes(p.status)) return;
          await api.enqueue(p.id);
          setToast?.(t("library.queuedToast"));
          await onRefresh?.();
          return;
        }
        if (actionId === "download") {
          const a = document.createElement("a");
          a.href = `/api/projects/${p.id}/master`;
          a.download = `${p.slug || "video"}_master.mp4`;
          a.click();
          return;
        }
        if (actionId === 'regenerate_video') {
          if (!regenerateAvailable || p.status !== 'done') return;
          const ok = await confirm({
            title: t('library.regenerateTitle'),
            message: t('library.regenerateWarning', { title: cleanTitle(p.title) }),
            confirmLabel: t('library.regenerateConfirm'), danger: true,
          });
          if (!ok) return;
          await api.regenerateVideo(p.id);
          setToast?.(t('library.regenerateQueued'));
          await onRefresh?.();
          return;
        }
        if (actionId === "review_auto") {
          await api.patchProject(p.id, { review_mode: "automatico" });
          setToast?.(t("library.reviewAutoToast"));
          await onRefresh?.();
          return;
        }
        if (actionId === "review_manual") {
          await api.patchProject(p.id, { review_mode: "com_revisao" });
          setToast?.(t("library.reviewManualToast"));
          await onRefresh?.();
          return;
        }
        if (actionId === "copy_title") {
          await navigator.clipboard.writeText(cleanTitle(p.title));
          setToast?.(t("library.titleCopied"));
          return;
        }
        if (actionId === "copy_slug") {
          await navigator.clipboard.writeText(p.slug || p.id);
          setToast?.(t("library.slugCopied"));
          return;
        }
        if (actionId === "archive") {
          const ok = await confirm({
            title: t("library.archiveTitle"),
            message: t("library.archiveMsg", { title: cleanTitle(p.title) }),
            confirmLabel: t("common.archive"),
          });
          if (!ok) return;
          await api.deleteProject(p.id, false);
          setToast?.(t("library.archivedToast"));
          await onRefresh?.();
          return;
        }
        if (actionId === "delete") {
          const ok = await confirm({
            title: t("library.deleteTitle"),
            message: t("library.deleteMsg", { title: cleanTitle(p.title) }),
            confirmLabel: t("common.delete"),
            danger: true,
          });
          if (!ok) return;
          await api.deleteProject(p.id, true);
          setToast?.(t("library.deletedToast"));
          await onRefresh?.();
          return;
        }
        if (actionId === "restore") {
          await api.restoreProject(p.id);
          setToast?.(t("library.restoredToast"));
          await onRefresh?.();
        }
      } catch (e) {
        setToast?.(String(e.message || e));
      }
    });
  }

  const menuProject = menu ? projects.find((p) => p.id === menu.project.id) || menu.project : null;

  return (
    <div
      onContextMenu={(e) => {
        if (!e.target.closest?.(".proj-card")) return;
        e.preventDefault();
      }}
    >
      <div className="page-head">
        <div>
          <h1>{t("library.title")}</h1>
          <p>{t("library.subtitle", { count: projects.length })}</p>
        </div>
        <div className="row">
          <button type="button" className="primary" onClick={onCreate}>
            {t("nav.newStory")}
          </button>
        </div>
      </div>

      <div className="filters">
        <select aria-label={t('category.label')} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">{t('category.all')}</option><option value="general">{t('category.general')}</option>
          <option value="footage">Footage</option>
        </select>
        <input placeholder={t("library.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} />
        {filters.map(([id, label]) => (
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
          title={showArchived ? t("library.hideArchived") : t("library.showArchived")}
          onClick={() => setShowArchived(!showArchived)}
        >
          {showArchived ? t("library.archivedOn") : t("library.filterArchived")}
        </button>
        <label className="sort-field">
          <span>{t("library.sortLabel")}</span>
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
            {sorts.map(([id, label]) => (
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
            {t("library.archiveBanner")}
            {archivedCount > 0
              ? t("library.archiveBannerCount", { n: archivedCount })
              : t("library.archiveBannerNone")}
          </span>
          <button type="button" className="ghost" onClick={() => setShowArchived(false)}>
            {t("library.hide")}
          </button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="empty-hero">
          <h2>{t("library.emptyTitle")}</h2>
          <p>
            {showArchived ? t("library.emptyFilterArchived") : t("library.emptyStart")}
          </p>
          <div className="row" style={{ justifyContent: "center" }}>
            {showArchived ? (
              <button type="button" onClick={() => setShowArchived(false)}>
                {t("library.backActive")}
              </button>
            ) : (
              <button type="button" className="primary" onClick={onCreate}>
                {t("library.createNow")}
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
                aria-busy={pendingActions.has(p.id)}
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
                <Poster project={p} t={t} />
                <div className="scrim" />
                <div className="top-badges">
                  <span className={`status-pill ${p.status}`}>{statusLabel(p.status, t)}</span>
                  {isNsfw(p) ? (
                    <span className="status-pill nsfw">NSFW</span>
                  ) : (
                    <span className="status-pill sfw">SFW</span>
                  )}
                </div>
                <div className="meta">
                  {pendingActions.has(p.id) && <span className="project-action-pending">
                    <span className="request-spinner" aria-hidden="true" /> {pendingActions.get(p.id)}
                  </span>}
                  <strong>{cleanTitle(p.title)}</strong>
                  {p.category === 'footage' && <span className="footage-badge">Footage</span>}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {t("library.takesMeta", { done: prog.completed, total: total || "—" })}
                    {p.has_master ? t("library.masterBadge") : ""}
                  </div>
                  <div className="progress">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="muted" style={{ fontSize: 10 }}>
                    {fmtDate(p.updated_at, dateLocale)}
                  </div>
                  {(p.status === 'done' || p.stats?.videos_sec != null) && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      {t('history.elapsed')}: {formatElapsed(p.stats?.videos_sec)} · {t('history.cost')}: {p.stats?.cost_brl != null ? `R$ ${Number(p.stats.cost_brl).toFixed(2)}` : '—'}
                    </div>
                  )}
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
          items={menuItemsFor(menuProject, t, regenerateAvailable)}
          pendingLabel={pendingActions.get(menuProject.id)}
          onClose={() => setMenu(null)}
          onPick={(id) => runAction(id, menuProject)}
        />
      ) : null}
    </div>
  );
}
