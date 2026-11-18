import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import { useLocale, useT } from "../i18n/index.jsx";
import { cleanTitle, initials, isNsfw, posterSrc } from "../utils.js";
import { generatedTimeline, groupTimelineDays } from "../timeline.js";
import MediaPlayer from "./MediaPlayer.jsx";

const PAGE_SIZE = 12;

function VideoPoster({ project, onPlay, label }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const src = posterSrc(project);
  return <button type="button" className="timeline-poster" onClick={onPlay} aria-label={label}>
    {src && src !== failedSrc
      ? <img src={src} loading="lazy" alt="" onError={() => setFailedSrc(src)} />
      : <span className="timeline-poster-fallback">{isNsfw(project) ? "NSFW" : initials(cleanTitle(project.title))}</span>}
    <span className="timeline-play-icon" aria-hidden="true">▶</span>
  </button>;
}

function FilterSeg({ label, value, options, onChange }) {
  return <div className="timeline-filter" role="tablist" aria-label={label}>
    <span className="timeline-filter-label">{label}</span>
    <div className="seg">
      {options.map(([id, text, count]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id}
          className={value === id ? "on" : ""} onClick={() => onChange(id)}>
          {text}
          {typeof count === "number" ? <em>{count}</em> : null}
        </button>
      ))}
    </div>
  </div>;
}

export default function Timeline({ projects, onOpenProject, onRefresh, setToast }) {
  const t = useT();
  const { dateLocale } = useLocale();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [reviewed, setReviewed] = useState("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [playingId, setPlayingId] = useState(null);
  const [mediaError, setMediaError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const filters = useMemo(() => ({ category, reviewed }), [category, reviewed]);
  const all = useMemo(() => generatedTimeline(projects), [projects]);
  const filtered = useMemo(() => generatedTimeline(projects, query, filters), [projects, query, filters]);
  const groups = useMemo(() => groupTimelineDays(filtered.slice(0, limit)), [filtered, limit]);

  const categoryCounts = useMemo(() => {
    const base = generatedTimeline(projects, query, { reviewed });
    const counts = { all: base.length, general: 0, footage: 0 };
    for (const project of base) {
      counts[project.category === "footage" ? "footage" : "general"] += 1;
    }
    return counts;
  }, [projects, query, reviewed]);

  const reviewedCounts = useMemo(() => {
    const base = generatedTimeline(projects, query, { category });
    const counts = { all: base.length, reviewed: 0, unreviewed: 0 };
    for (const project of base) {
      if (project.reviewed) counts.reviewed += 1;
      else counts.unreviewed += 1;
    }
    return counts;
  }, [projects, query, category]);

  const hasActiveFilters = Boolean(query.trim() || category !== "all" || reviewed !== "all");

  function resetPaging() {
    setLimit(PAGE_SIZE);
    setPlayingId(null);
    setMediaError(null);
  }

  function play(id) {
    setMediaError(null);
    setPlayingId((previous) => previous === id ? null : id);
  }

  function dayLabel(group) {
    if (group.key === "unknown") return t("timeline.unknownDate");
    return new Date(Number(group.timestamp) * 1000).toLocaleDateString(dateLocale, {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    });
  }

  async function toggleReviewed(project) {
    if (busyId) return;
    const next = !project.reviewed;
    setBusyId(project.id);
    try {
      await api.patchProject(project.id, { reviewed: next });
      await onRefresh?.();
    } catch (error) {
      setToast?.(error?.message || t("timeline.reviewError"));
    } finally {
      setBusyId(null);
    }
  }

  return <div className="video-timeline">
    <header className="timeline-header">
      <div>
        <h1>{t("timeline.title")}</h1>
        <p className="muted">{t("timeline.hint")}</p>
      </div>
      <button type="button" onClick={() => onRefresh?.()}>{t("common.refresh")}</button>
    </header>

    <div className="timeline-toolbar">
      <label className="timeline-search">
        <span>{t("timeline.search")}</span>
        <input type="search" value={query} placeholder={t("timeline.searchPlaceholder")}
          onChange={(event) => { setQuery(event.target.value); resetPaging(); }} />
      </label>
      <span className="muted" role="status">{t("timeline.count", { count: filtered.length, total: all.length })}</span>
    </div>

    <div className="timeline-filters">
      <FilterSeg
        label={t("category.label")}
        value={category}
        onChange={(value) => { setCategory(value); resetPaging(); }}
        options={[
          ["all", t("category.all"), categoryCounts.all],
          ["general", t("category.general"), categoryCounts.general],
          ["footage", t("category.footage"), categoryCounts.footage],
        ]}
      />
      <FilterSeg
        label={t("timeline.reviewedFilter")}
        value={reviewed}
        onChange={(value) => { setReviewed(value); resetPaging(); }}
        options={[
          ["all", t("timeline.reviewedAll"), reviewedCounts.all],
          ["reviewed", t("timeline.reviewedOnly"), reviewedCounts.reviewed],
          ["unreviewed", t("timeline.unreviewedOnly"), reviewedCounts.unreviewed],
        ]}
      />
    </div>

    {!filtered.length ? <div className="empty-hero timeline-empty">
      <h2>{t(hasActiveFilters ? "timeline.noMatches" : "timeline.empty")}</h2>
      <p className="muted">{t(hasActiveFilters ? "timeline.noMatchesHint" : "timeline.emptyHint")}</p>
    </div> : <div className="timeline-days">
      {groups.map((group) => <section className="timeline-day" key={group.key} aria-label={dayLabel(group)}>
        <h2 className="timeline-day-heading">{dayLabel(group)}</h2>
        <div className="timeline-entries">
          {group.projects.map((project) => {
            const title = cleanTitle(project.title) || project.slug;
            const isPlaying = playingId === project.id;
            const isReviewed = !!project.reviewed;
            const source = `/api/projects/${encodeURIComponent(project.id)}/master`;
            const created = new Date(Number(project.created_at) * 1000);
            return <article className={`timeline-entry ${isPlaying ? "is-playing" : ""} ${isReviewed ? "is-reviewed" : ""}`} key={project.id}>
              <div className="timeline-entry-top">
                <VideoPoster project={project} onPlay={() => play(project.id)} label={t("timeline.playTitle", { title })} />
                <div className="timeline-entry-info">
                  <div className="timeline-entry-meta">
                    <span>{isNsfw(project) ? "NSFW" : "SFW"}</span>
                    <span>{t(project.category === "footage" ? "category.footage" : "category.general")}</span>
                    {isReviewed && <span className="timeline-reviewed-badge">{t("timeline.reviewedBadge")}</span>}
                    {project.status === "archived" && <span>{t("timeline.archived")}</span>}
                  </div>
                  <h3><button type="button" onClick={() => onOpenProject(project.id)}>{title}</button></h3>
                  <div className="timeline-created">
                    {t("timeline.created")} {group.key === "unknown" ? t("timeline.unknownDate") : <time dateTime={created.toISOString()}>
                      {created.toLocaleString(dateLocale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </time>}
                    {project.width && project.height ? <span> · {project.width}×{project.height}</span> : null}
                  </div>
                  {project.brief && <p className="timeline-brief">{project.brief}</p>}
                  <div className="timeline-entry-actions">
                    <button type="button" className={isPlaying ? "" : "primary"} aria-expanded={isPlaying}
                      aria-controls={`timeline-player-${project.id}`} onClick={() => play(project.id)}>
                      {t(isPlaying ? "timeline.closePlayer" : "timeline.watch")}
                    </button>
                    <a className="timeline-download" href={source} download={`${project.slug || "video"}_master.mp4`}>{t("timeline.download")}</a>
                    <button type="button" className={isReviewed ? "timeline-reviewed-on" : ""}
                      aria-pressed={isReviewed} disabled={busyId === project.id}
                      onClick={() => toggleReviewed(project)}>
                      {t(isReviewed ? "timeline.unmarkReviewed" : "timeline.markReviewed")}
                    </button>
                    <button type="button" onClick={() => onOpenProject(project.id)}>{t("timeline.info")}</button>
                  </div>
                </div>
              </div>
              {isPlaying && <div className="timeline-player" id={`timeline-player-${project.id}`}>
                <MediaPlayer
                  autoPlay
                  playsInline
                  preload="metadata"
                  ariaLabel={title}
                  src={`${source}?v=${encodeURIComponent(project.updated_at || 0)}`}
                  onError={() => setMediaError(project.id)}
                />
                {mediaError === project.id && <p className="bad-text" role="alert">{t("timeline.playbackError")}</p>}
              </div>}
            </article>;
          })}
        </div>
      </section>)}
    </div>}
    {filtered.length > limit && <div className="timeline-more">
      <button type="button" onClick={() => setLimit((previous) => previous + PAGE_SIZE)}>{t("timeline.more")}</button>
      <span className="muted">{t("timeline.shown", { shown: Math.min(limit, filtered.length), total: filtered.length })}</span>
    </div>}
  </div>;
}
