import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import ContextMenu from "./ContextMenu.jsx";
import { useConfirm } from "./ConfirmDialog.jsx";
import { VIDEO_FORMATS } from "./VideoFormat.jsx";
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

const ATTENTION_RANK = {
  awaiting_review: 0,
  failed: 1,
  generating: 2,
  paused: 3,
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

function projectProgress(p) {
  const prog = p.progress || { completed: 0, total: (p.takes || []).length };
  const total = prog.total || (p.takes || []).length || 0;
  const done = prog.completed || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

function formatMeta(p) {
  const w = Number(p.width) || 576;
  const h = Number(p.height) || 1024;
  const known = VIDEO_FORMATS.find((f) => f.width === w && f.height === h);
  const ratio = known?.ratio || `${w}×${h}`;
  const ratioClass =
    ratio === "9:16"
      ? "ratio-9x16"
      : ratio === "16:9"
        ? "ratio-16x9"
        : ratio === "1:1"
          ? "ratio-1x1"
          : ratio === "4:5"
            ? "ratio-4x5"
            : "ratio-9x16";
  return { width: w, height: h, ratio, ratioClass };
}

function menuItemsFor(p, t, regenerateAvailable = false) {
  const archived = p.status === "archived";
  const hasTakes = (p.takes || []).length > 0;
  const inQueue = ["queued", "generating", "paused", "awaiting_review"].includes(p.status);
  const items = [{ id: "open", label: t("library.open") }];
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
  if (p.status === "done" && hasTakes) {
    items.push({
      id: "regenerate_video",
      label: t("library.regenerateVideo"),
      danger: true,
      disabled: !regenerateAvailable,
      title: regenerateAvailable ? undefined : t("library.regenerateNeedsRestart"),
    });
  }
  items.push({ sep: true });
  items.push({ id: "review_auto", label: t("library.reviewAuto"), disabled: archived });
  items.push({ id: "review_manual", label: t("library.reviewManual"), disabled: archived });
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

function primaryQuickAction(p, t) {
  const hasTakes = (p.takes || []).length > 0;
  const inQueue = ["queued", "generating", "paused", "awaiting_review"].includes(p.status);
  if (p.status === "awaiting_review") {
    return { id: "open", label: t("library.reviewNow") };
  }
  if (p.status === "failed" && hasTakes && !isProjectComplete(p)) {
    return { id: "enqueue", label: t("library.resume") };
  }
  if (!isProjectComplete(p) && hasTakes && !inQueue && p.status !== "archived") {
    return { id: "enqueue", label: t("library.enqueue") };
  }
  if (p.has_master) {
    return { id: "download", label: t("library.masterShort") };
  }
  return { id: "open", label: t("library.open") };
}

function attentionWhy(p, t) {
  const { done, total, pct } = projectProgress(p);
  if (p.status === "awaiting_review") {
    return t("library.attentionReview", { done, total: total || "—" });
  }
  if (p.status === "generating") {
    return t("library.attentionGenerating", { pct });
  }
  if (p.status === "failed") {
    return t("library.attentionFailed", { done, total: total || "—" });
  }
  if (p.status === "paused") {
    return t("library.attentionPaused", { done, total: total || "—" });
  }
  return statusLabel(p.status, t);
}

function PosterThumb({ project, t }) {
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
  onOpenQueue,
  setToast,
}) {
  const t = useT();
  const { locale, dateLocale } = useLocale();
  const confirm = useConfirm();
  const pendingActions = useProjectActions();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [formatFilter, setFormatFilter] = useState(null);
  const [masterOnly, setMasterOnly] = useState(false);
  const [sort, setSort] = useState(() => {
    try {
      return localStorage.getItem("promptera_library_sort") || "updated_desc";
    } catch {
      return "updated_desc";
    }
  });
  const [density, setDensity] = useState(() => {
    try {
      return localStorage.getItem("promptera_library_density") || "comfortable";
    } catch {
      return "comfortable";
    }
  });

  const collatorLocale = locale === "pt" ? "pt" : "en";

  const primaryFilters = useMemo(
    () => [
      ["all", t("library.filterAll")],
      ["active", t("library.filterActive")],
      ["draft", t("library.filterDraft")],
      ["done", t("library.filterDone")],
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

  const counts = useMemo(() => {
    const c = { all: projects.length, review: 0, generating: 0, done: 0, draft: 0, active: 0 };
    for (const p of projects) {
      if (p.status === "awaiting_review") c.review += 1;
      if (p.status === "generating") c.generating += 1;
      if (p.status === "done") c.done += 1;
      if (p.status === "draft") c.draft += 1;
      if (["generating", "awaiting_review", "paused"].includes(p.status)) c.active += 1;
    }
    return c;
  }, [projects]);

  const filterCounts = useMemo(() => {
    const c = { all: projects.length, active: 0, draft: 0, done: 0 };
    for (const p of projects) {
      if (["generating", "awaiting_review", "paused"].includes(p.status)) c.active += 1;
      if (p.status === "draft") c.draft += 1;
      if (p.status === "done") c.done += 1;
    }
    return c;
  }, [projects]);

  const archivedCount = projects.filter((p) => p.status === "archived").length;

  const attention = useMemo(() => {
    return [...projects]
      .filter((p) => ["awaiting_review", "generating", "failed", "paused"].includes(p.status))
      .sort((a, b) => {
        const ra = ATTENTION_RANK[a.status] ?? 50;
        const rb = ATTENTION_RANK[b.status] ?? 50;
        if (ra !== rb) return ra - rb;
        return (b.updated_at || 0) - (a.updated_at || 0);
      })
      .slice(0, 8);
  }, [projects]);

  const filtered = sortProjects(
    projects.filter((p) => {
      if (filter === "draft" && p.status !== "draft") return false;
      if (filter === "queued" && p.status !== "queued") return false;
      if (filter === "active" && !["generating", "awaiting_review", "paused"].includes(p.status)) return false;
      if (filter === "done" && p.status !== "done") return false;
      if (filter === "failed" && p.status !== "failed") return false;
      if (filter === "nsfw" && !isNsfw(p)) return false;
      if (filter === "sfw" && isNsfw(p)) return false;
      if (masterOnly && !p.has_master) return false;
      if (formatFilter) {
        const { ratio } = formatMeta(p);
        if (ratio !== formatFilter) return false;
      }
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
    const actionLabel =
      menuItemsFor(p, t, regenerateAvailable).find((item) => item.id === actionId)?.label || actionId;
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
        if (actionId === "regenerate_video") {
          if (!regenerateAvailable || p.status !== "done") return;
          const ok = await confirm({
            title: t("library.regenerateTitle"),
            message: t("library.regenerateWarning", { title: cleanTitle(p.title) }),
            confirmLabel: t("library.regenerateConfirm"),
            danger: true,
          });
          if (!ok) return;
          await api.regenerateVideo(p.id);
          setToast?.(t("library.regenerateQueued"));
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

  function openMenuAt(e, p) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, project: p });
  }

  function setDensityPref(next) {
    setDensity(next);
    try {
      localStorage.setItem("promptera_library_density", next);
    } catch {}
  }

  const menuProject = menu ? projects.find((p) => p.id === menu.project.id) || menu.project : null;

  return (
    <div
      className={`library-page density-${density}`}
      onContextMenu={(e) => {
        if (!e.target.closest?.(".proj-card")) return;
        e.preventDefault();
      }}
    >
      <div className="page-head">
        <div>
          <h1>{t("library.title")}</h1>
          <p>{t("library.subtitleFocus", { count: projects.length })}</p>
        </div>
        <div className="stat-row">
          {counts.review > 0 ? (
            <div className="stat-chip warn">
              <b>{counts.review}</b> {t("library.statReview")}
            </div>
          ) : null}
          {counts.generating > 0 ? (
            <div className="stat-chip">
              <b>{counts.generating}</b> {t("library.statGenerating")}
            </div>
          ) : null}
          <div className="stat-chip ok">
            <b>{counts.done}</b> {t("library.statDone")}
          </div>
          <div className="stat-chip">
            <b>{counts.draft}</b> {t("library.statDraft")}
          </div>
        </div>
      </div>

      {attention.length > 0 ? (
        <section className="attention" aria-label={t("library.attentionAria")}>
          <div className="attention-head">
            <h2>{t("library.attentionTitle")}</h2>
            {onOpenQueue ? (
              <button type="button" className="ghost attention-queue" onClick={onOpenQueue}>
                {t("library.attentionQueue")}
              </button>
            ) : null}
          </div>
          <div className="attention-rail">
            {attention.map((p) => {
              const quick = primaryQuickAction(p, t);
              return (
                <article key={p.id} className="rail-card">
                  <button
                    type="button"
                    className="rail-main"
                    onClick={() => onSelect(p.id)}
                  >
                    <div className="rail-thumb-wrap">
                      {isNsfw(p) ? (
                        <div className="rail-thumb nsfw">{initials(p.title)}</div>
                      ) : (
                        <img
                          className="rail-thumb"
                          src={posterSrc(p)}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                    </div>
                    <div className="rail-copy">
                      <strong>{cleanTitle(p.title)}</strong>
                      <span className="why">{attentionWhy(p, t)}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`cta ${quick.id !== "open" || p.status === "awaiting_review" ? "primary" : ""}`}
                    onClick={() => runAction(quick.id, p)}
                  >
                    {quick.label}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="library-toolbar">
        <div className="toolbar-row">
          <div className="library-search">
            <input
              placeholder={t("library.searchPh")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="seg" role="tablist" aria-label={t("library.filterAll")}>
            {primaryFilters.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                className={filter === id ? "on" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
                <em>{filterCounts[id] ?? ""}</em>
              </button>
            ))}
          </div>
          <div className="toolbar-aside">
            <div className="density" role="group" aria-label={t("library.densityLabel")}>
              {[
                ["compact", "▣", t("library.densityCompact")],
                ["comfortable", "▦", t("library.densityComfortable")],
                ["cinema", "▥", t("library.densityCinema")],
              ].map(([id, icon, title]) => (
                <button
                  key={id}
                  type="button"
                  title={title}
                  className={density === id ? "on" : ""}
                  onClick={() => setDensityPref(id)}
                >
                  {icon}
                </button>
              ))}
            </div>
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
            <button
              type="button"
              className="ghost"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              {moreOpen ? t("library.lessFilters") : t("library.moreFilters")}
            </button>
          </div>
        </div>

        {moreOpen ? (
          <div className="more-panel">
            <button
              type="button"
              className={`chip ${filter === "queued" ? "active" : ""}`}
              onClick={() => setFilter(filter === "queued" ? "all" : "queued")}
            >
              {t("library.filterQueued")}
            </button>
            <button
              type="button"
              className={`chip ${filter === "failed" ? "active" : ""}`}
              onClick={() => setFilter(filter === "failed" ? "all" : "failed")}
            >
              {t("library.filterFailed")}
            </button>
            <button
              type="button"
              className={`chip ${filter === "nsfw" ? "active" : ""}`}
              onClick={() => setFilter(filter === "nsfw" ? "all" : "nsfw")}
            >
              {t("library.filterNsfw")}
            </button>
            <button
              type="button"
              className={`chip ${filter === "sfw" ? "active" : ""}`}
              onClick={() => setFilter(filter === "sfw" ? "all" : "sfw")}
            >
              {t("library.filterSfw")}
            </button>
            <button
              type="button"
              className={`chip chip-archive ${showArchived ? "active" : ""}`}
              aria-pressed={showArchived}
              onClick={() => setShowArchived(!showArchived)}
            >
              {showArchived ? t("library.archivedOn") : t("library.filterArchived")}
            </button>
            <button
              type="button"
              className={`chip ${masterOnly ? "active" : ""}`}
              onClick={() => setMasterOnly((v) => !v)}
            >
              {t("library.filterMaster")}
            </button>
            {["9:16", "16:9", "1:1", "4:5"].map((ratio) => (
              <button
                key={ratio}
                type="button"
                className={`chip ${formatFilter === ratio ? "active" : ""}`}
                onClick={() => setFormatFilter((v) => (v === ratio ? null : ratio))}
              >
                {ratio}
              </button>
            ))}
          </div>
        ) : null}
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
          <p>{showArchived ? t("library.emptyFilterArchived") : t("library.emptyStart")}</p>
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
        <>
          <div className="section-label">
            <h2>{t("library.libraryHeading")}</h2>
            <span className="muted">{t("library.libraryHint")}</span>
          </div>
          <div className="library-grid">
            {filtered.map((p) => {
              const { done, total, pct } = projectProgress(p);
              const fmt = formatMeta(p);
              return (
                <article
                  key={p.id}
                  aria-busy={pendingActions.has(p.id)}
                  className={`proj-card ${selectedId === p.id ? "selected" : ""} ${
                    menu?.project?.id === p.id ? "ctx-open" : ""
                  }`}
                  tabIndex={0}
                  onClick={() => onSelect(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(p.id);
                    }
                  }}
                  onContextMenu={(e) => openMenuAt(e, p)}
                >
                  <div className="stage">
                    <div className={`poster ${fmt.ratioClass}`}>
                      <PosterThumb project={p} t={t} />
                      <div className="scrim" />
                      <div className="top-badges">
                        <span className={`status-pill ${p.status}`}>{statusLabel(p.status, t)}</span>
                        <span className="badge-right">
                          {isNsfw(p) ? <span className="status-pill nsfw">NSFW</span> : null}
                          <span className="format-pill">{fmt.ratio}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="meta">
                    {pendingActions.has(p.id) ? (
                      <span className="project-action-pending">
                        <span className="request-spinner" aria-hidden="true" /> {pendingActions.get(p.id)}
                      </span>
                    ) : null}
                    <strong>{cleanTitle(p.title)}</strong>
                    {p.category === "footage" ? <span className="footage-badge">Footage</span> : null}
                    <div className="sub">
                      <span>
                        {t("library.takesMeta", { done, total: total || "—" })}
                        {p.has_master ? t("library.masterBadge") : ""}
                      </span>
                      <span>·</span>
                      <span>{fmtDate(p.updated_at, dateLocale)}</span>
                    </div>
                    <div className="progress">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    {(p.status === "done" || p.stats?.videos_sec != null) && (
                      <div className="sub cost">
                        {t("history.elapsed")}: {formatElapsed(p.stats?.videos_sec)} · {t("history.cost")}:{" "}
                        {p.stats?.cost_brl != null ? `R$ ${Number(p.stats.cost_brl).toFixed(2)}` : "—"}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
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
