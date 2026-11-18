import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useConfirm } from "./ConfirmDialog.jsx";
import { useLocale, useT } from "../i18n/index.jsx";
import { cleanTitle, fmtDate, initials, posterSrc } from "../utils.js";
import MediaPlayer from "./MediaPlayer.jsx";

function SceneThumb({ scene }) {
  const src = scene?.poster_url || (scene?.project_id ? posterSrc({ id: scene.project_id }) : null);
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className="films-thumb-fallback">{initials(cleanTitle(scene?.title || "?"))}</span>;
  }
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

function FilmCard({ film, onOpen, onDelete }) {
  const t = useT();
  const { dateLocale } = useLocale();
  const first = film.scenes?.[0];
  return (
    <article className="films-card">
      <button type="button" className="films-card-poster" onClick={() => onOpen(film.id)}>
        {first ? <SceneThumb scene={first} /> : <span className="films-thumb-fallback">+</span>}
        <span className="films-card-count">{t("films.sceneCount", { n: film.scene_count || 0 })}</span>
      </button>
      <div className="films-card-body">
        <h3>
          <button type="button" onClick={() => onOpen(film.id)}>
            {cleanTitle(film.title) || film.slug}
          </button>
        </h3>
        <p className="muted">
          {fmtDate(film.updated_at, dateLocale)}
          {film.has_output ? ` · ${t("films.ready")}` : ` · ${t("films.draft")}`}
        </p>
        <div className="films-card-actions">
          <button type="button" className="primary" onClick={() => onOpen(film.id)}>
            {t("films.open")}
          </button>
          <button type="button" className="ghost danger" onClick={() => onDelete(film)}>
            {t("common.delete")}
          </button>
        </div>
      </div>
    </article>
  );
}

function ScenePicker({ projects, selectedIds, onToggle, onClose, query, setQuery }) {
  const t = useT();
  const available = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (projects || [])
      .filter((p) => p?.has_master)
      .filter((p) => {
        if (!needle) return true;
        const hay = `${p.title || ""} ${p.slug || ""}`.toLowerCase();
        return hay.includes(needle);
      })
      .slice()
      .sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0));
  }, [projects, query]);

  return (
    <div className="films-picker-backdrop" role="dialog" aria-modal="true" aria-label={t("films.addScenes")}>
      <div className="films-picker">
        <header className="films-picker-head">
          <div>
            <h2>{t("films.addScenes")}</h2>
            <p className="muted">{t("films.addScenesHint")}</p>
          </div>
          <button type="button" onClick={onClose}>{t("common.close")}</button>
        </header>
        <label className="films-search">
          <span>{t("films.searchVideos")}</span>
          <input
            type="search"
            value={query}
            placeholder={t("films.searchPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="films-picker-list">
          {!available.length ? (
            <p className="muted">{t("films.noMasters")}</p>
          ) : (
            available.map((p) => {
              const checked = selectedIds.has(p.id);
              return (
                <label key={p.id} className={`films-picker-item ${checked ? "is-on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(p.id)}
                  />
                  <span className="films-picker-thumb">
                    <SceneThumb scene={{ project_id: p.id, title: p.title, poster_url: p.poster_url }} />
                  </span>
                  <span className="films-picker-meta">
                    <strong>{cleanTitle(p.title) || p.slug}</strong>
                    <span className="muted">
                      {p.width && p.height ? `${p.width}×${p.height}` : p.slug}
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </div>
        <footer className="films-picker-foot">
          <span className="muted">{t("films.selectedCount", { n: selectedIds.size })}</span>
          <button type="button" className="primary" onClick={onClose} disabled={!selectedIds.size}>
            {t("films.confirmAdd")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function Films({
  projects,
  busy,
  setBusy,
  setToast,
  selectedFilmId,
  onSelectFilm,
  onBack,
}) {
  const t = useT();
  const confirm = useConfirm();
  const [films, setFilms] = useState([]);
  const [film, setFilm] = useState(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refreshList() {
    const list = await api.films();
    setFilms(list || []);
    return list || [];
  }

  async function loadFilm(id) {
    if (!id) {
      setFilm(null);
      return null;
    }
    const f = await api.film(id);
    setFilm(f);
    setTitleDraft(cleanTitle(f.title) || "");
    setPlaying(false);
    return f;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refreshList()
      .catch((err) => {
        if (!cancelled) setToast(err.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!selectedFilmId) {
      setFilm(null);
      return undefined;
    }
    loadFilm(selectedFilmId).catch((err) => {
      if (!cancelled) {
        setToast(err.message || String(err));
        onBack?.();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedFilmId]);

  async function createFilm() {
    const title = newTitle.trim() || t("films.untitled");
    setBusy(true);
    try {
      const created = await api.createFilm({ title });
      setCreating(false);
      setNewTitle("");
      await refreshList();
      onSelectFilm(created.id);
      setToast(t("films.created"));
    } catch (err) {
      setToast(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveScenes(nextScenes) {
    if (!film?.id) return;
    setBusy(true);
    try {
      const updated = await api.patchFilm(film.id, { scenes: nextScenes });
      setFilm(updated);
      await refreshList();
    } catch (err) {
      setToast(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle() {
    if (!film?.id) return;
    const title = titleDraft.trim() || t("films.untitled");
    if (title === cleanTitle(film.title)) return;
    setBusy(true);
    try {
      const updated = await api.patchFilm(film.id, { title });
      setFilm(updated);
      setTitleDraft(cleanTitle(updated.title) || "");
      await refreshList();
      setToast(t("films.titleSaved"));
    } catch (err) {
      setToast(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function moveScene(index, delta) {
    const scenes = [...(film?.scenes || [])];
    const next = index + delta;
    if (next < 0 || next >= scenes.length) return;
    const tmp = scenes[index];
    scenes[index] = scenes[next];
    scenes[next] = tmp;
    saveScenes(scenes.map((s) => ({ id: s.id, project_id: s.project_id })));
  }

  function removeScene(index) {
    const scenes = (film?.scenes || [])
      .filter((_, i) => i !== index)
      .map((s) => ({ id: s.id, project_id: s.project_id }));
    saveScenes(scenes);
  }

  function openPicker() {
    setPicked(new Set((film?.scenes || []).map((s) => s.project_id)));
    setPickerQuery("");
    setPickerOpen(true);
  }

  function closePicker() {
    // Keep order of already-present scenes, append newly checked at the end.
    const ordered = [];
    const seen = new Set();
    for (const s of film?.scenes || []) {
      if (picked.has(s.project_id)) {
        ordered.push({ id: s.id, project_id: s.project_id });
        seen.add(s.project_id);
      }
    }
    for (const id of picked) {
      if (!seen.has(id)) ordered.push({ project_id: id });
    }
    setPickerOpen(false);
    const before = (film?.scenes || []).map((s) => s.project_id).join("|");
    const after = ordered.map((s) => s.project_id).join("|");
    if (before !== after) saveScenes(ordered);
  }

  async function build() {
    if (!film?.id) return;
    const ok = await confirm({
      title: t("films.buildTitle"),
      message: t("films.buildWarning", { n: film.scene_count || 0 }),
      confirmLabel: t("films.build"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const updated = await api.buildFilm(film.id);
      setFilm(updated);
      await refreshList();
      setPlaying(true);
      setToast(t("films.buildDone", { n: updated.clips || film.scene_count || 0 }));
    } catch (err) {
      setToast(err.message || String(err));
      try {
        await loadFilm(film.id);
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeFilm(target) {
    const ok = await confirm({
      title: t("films.deleteTitle"),
      message: t("films.deleteWarning", { title: cleanTitle(target.title) || target.slug }),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteFilm(target.id);
      await refreshList();
      if (selectedFilmId === target.id) onBack?.();
      setToast(t("films.deleted"));
    } catch (err) {
      setToast(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  if (selectedFilmId && !film) {
    return (
      <div className="films-page">
        <p className="muted">{t("films.loading")}</p>
      </div>
    );
  }

  if (selectedFilmId && film) {
    const outputSrc = film.has_output
      ? api.filmOutputUrl(film.id, film.updated_at)
      : null;
    return (
      <div className="films-page films-editor">
        <header className="films-header">
          <div>
            <button type="button" className="ghost" onClick={onBack}>{t("common.back")}</button>
            <div className="films-title-row">
              <input
                className="films-title-input"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                aria-label={t("films.title")}
              />
              <span className={`films-status ${film.has_output ? "ready" : "draft"}`}>
                {film.has_output ? t("films.ready") : t("films.draft")}
              </span>
            </div>
            <p className="muted">{t("films.editorHint")}</p>
          </div>
          <div className="films-header-actions">
            <button type="button" onClick={openPicker} disabled={busy}>{t("films.addScenes")}</button>
            <button
              type="button"
              className="primary"
              onClick={build}
              disabled={busy || !(film.scenes || []).length}
            >
              {t("films.build")}
            </button>
          </div>
        </header>

        <div className="films-editor-grid">
          <section className="films-scenes">
            <h2>{t("films.scenes")}</h2>
            {!(film.scenes || []).length ? (
              <div className="empty-hero films-empty">
                <h3>{t("films.emptyScenes")}</h3>
                <p className="muted">{t("films.emptyScenesHint")}</p>
                <button type="button" className="primary" onClick={openPicker}>{t("films.addScenes")}</button>
              </div>
            ) : (
              <ol className="films-scene-list">
                {(film.scenes || []).map((scene, index) => (
                  <li key={scene.id || scene.project_id} className={`films-scene ${scene.missing || !scene.has_master ? "is-bad" : ""}`}>
                    <span className="films-scene-index">{index + 1}</span>
                    <span className="films-scene-thumb"><SceneThumb scene={scene} /></span>
                    <div className="films-scene-info">
                      <strong>{cleanTitle(scene.title) || scene.slug || scene.project_id}</strong>
                      <span className="muted">
                        {scene.missing
                          ? t("films.missingVideo")
                          : !scene.has_master
                            ? t("films.missingMaster")
                            : scene.width && scene.height
                              ? `${scene.width}×${scene.height}`
                              : scene.slug}
                      </span>
                    </div>
                    <div className="films-scene-actions">
                      <button type="button" disabled={busy || index === 0} onClick={() => moveScene(index, -1)} aria-label={t("films.moveUp")}>↑</button>
                      <button type="button" disabled={busy || index === film.scenes.length - 1} onClick={() => moveScene(index, 1)} aria-label={t("films.moveDown")}>↓</button>
                      <button type="button" className="ghost danger" disabled={busy} onClick={() => removeScene(index)}>{t("common.delete")}</button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="films-preview">
            <h2>{t("films.preview")}</h2>
            {outputSrc ? (
              <>
                <MediaPlayer
                  key={outputSrc}
                  playsInline
                  preload="metadata"
                  src={outputSrc}
                  autoPlay={playing}
                />
                <div className="films-preview-actions">
                  <a className="timeline-download" href={outputSrc} download={`${film.slug || "filme"}_film.mp4`}>
                    {t("films.download")}
                  </a>
                </div>
              </>
            ) : (
              <div className="empty-hero films-empty">
                <h3>{t("films.noOutput")}</h3>
                <p className="muted">{t("films.noOutputHint")}</p>
              </div>
            )}
            {film.error ? <p className="bad-text" role="alert">{film.error}</p> : null}
          </section>
        </div>

        {pickerOpen ? (
          <ScenePicker
            projects={projects}
            selectedIds={picked}
            query={pickerQuery}
            setQuery={setPickerQuery}
            onToggle={(id) => {
              setPicked((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
            onClose={closePicker}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="films-page">
      <header className="films-header">
        <div>
          <h1>{t("films.title")}</h1>
          <p className="muted">{t("films.hint")}</p>
        </div>
        <div className="films-header-actions">
          <button type="button" onClick={() => refreshList().catch((e) => setToast(e.message))}>
            {t("common.refresh")}
          </button>
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            {t("films.new")}
          </button>
        </div>
      </header>

      {creating ? (
        <div className="films-create">
          <label>
            <span>{t("films.titleField")}</span>
            <input
              autoFocus
              value={newTitle}
              placeholder={t("films.titlePlaceholder")}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createFilm();
              }}
            />
          </label>
          <div className="films-create-actions">
            <button type="button" className="ghost" onClick={() => { setCreating(false); setNewTitle(""); }}>{t("common.cancel")}</button>
            <button type="button" className="primary" disabled={busy} onClick={createFilm}>{t("films.create")}</button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="muted">{t("films.loading")}</p>
      ) : !films.length ? (
        <div className="empty-hero films-empty">
          <h2>{t("films.empty")}</h2>
          <p className="muted">{t("films.emptyHint")}</p>
          <button type="button" className="primary" onClick={() => setCreating(true)}>{t("films.new")}</button>
        </div>
      ) : (
        <div className="films-grid">
          {films.map((f) => (
            <FilmCard key={f.id} film={f} onOpen={onSelectFilm} onDelete={removeFilm} />
          ))}
        </div>
      )}
    </div>
  );
}
