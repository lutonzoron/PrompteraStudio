import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useT } from "../i18n/index.jsx";
import { useConfirm } from "./ConfirmDialog.jsx";
import VideoFormat, { VIDEO_FORMATS } from "./VideoFormat.jsx";

const STORAGE_KEY = "promptera.composingProjectId";
const SAVE_DEBOUNCE_MS = 450;
const DURATION_PRESETS = [3, 5, 8, 10, 12, 15];

function sceneDuration(scene) {
  return (scene?.takes || []).reduce((sum, tk) => sum + (Number(tk.duration) || 5), 0);
}

function scenesDuration(scenes) {
  return (scenes || []).reduce((sum, sc) => sum + sceneDuration(sc), 0);
}

function DiceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="3.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="8.2" cy="8.2" r="1.35" fill="currentColor" />
      <circle cx="15.8" cy="8.2" r="1.35" fill="currentColor" />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" />
      <circle cx="8.2" cy="15.8" r="1.35" fill="currentColor" />
      <circle cx="15.8" cy="15.8" r="1.35" fill="currentColor" />
    </svg>
  );
}

function emptyScene(index = 1) {
  return {
    id: `s_${Date.now()}_${index}`,
    session: `scene_${String(index).padStart(2, "0")}`,
    takes: [{ id: `t_${Date.now()}_${index}`, title: "", prompt: "", duration: 5 }],
  };
}

function takesToScenes(takes) {
  if (!Array.isArray(takes) || !takes.length) return [emptyScene(1)];
  const order = [];
  const map = new Map();
  for (const take of takes) {
    const session = String(take.session || "scene_01");
    if (!map.has(session)) {
      map.set(session, []);
      order.push(session);
    }
    map.get(session).push({
      id: `t_${take.n || map.get(session).length}`,
      title: take.title || "",
      prompt: take.prompt || "",
      duration: Number(take.duration) || 5,
    });
  }
  return order.map((session, i) => ({
    id: `s_${session}_${i}`,
    session,
    takes: map.get(session),
  }));
}

function scenesToTakes(scenes, slug, seedBase) {
  const takes = [];
  let n = 1;
  const safeSlug = String(slug || "story")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "story";
  scenes.forEach((scene, sceneIdx) => {
    const session =
      String(scene.session || `scene_${String(sceneIdx + 1).padStart(2, "0")}`)
        .trim()
        .replace(/\s+/g, "_") || `scene_${String(sceneIdx + 1).padStart(2, "0")}`;
    (scene.takes || []).forEach((take, takeIdx) => {
      takes.push({
        n,
        kind: takeIdx === 0 ? "new" : "continue",
        session,
        seed: Number(seedBase || 2000) + sceneIdx,
        duration: Math.min(15, Math.max(2, Number(take.duration) || 5)),
        prefix: `video/${safeSlug}/t${String(n).padStart(2, "0")}`,
        title: String(take.title || "").trim() || `Take ${n}`,
        prompt: String(take.prompt || "").trim(),
      });
      n += 1;
    });
  });
  return takes;
}

function defaultForm(styles) {
  return {
    title: "",
    brief: "",
    style_id: styles[0]?.id || "",
    max_duration_sec: 60,
    review_mode: "automatico",
    model_pack: "sfw",
    category: "general",
    width: VIDEO_FORMATS[0].width,
    height: VIDEO_FORMATS[0].height,
    seed_base: 2000,
  };
}

export default function CreateSheet({
  styles,
  busy,
  setBusy,
  setToast,
  onBack,
  onConfirmed,
  footageAvailable = false,
}) {
  const t = useT();
  const confirm = useConfirm();
  const [mode, setMode] = useState("automatic");
  const [form, setForm] = useState(() => defaultForm(styles));
  const [scenes, setScenes] = useState(() => [emptyScene(1)]);
  const [projectId, setProjectId] = useState(null);
  const [slug, setSlug] = useState("story");
  const [estimate, setEstimate] = useState(null);
  const [boot, setBoot] = useState(true);
  const [saveState, setSaveState] = useState("idle");
  const [expandedSceneId, setExpandedSceneId] = useState(null);
  const [setupOpen, setSetupOpen] = useState(true);
  const hydratedRef = useRef(false);
  const skipNextSaveRef = useRef(true);
  const formRef = useRef(form);
  const scenesRef = useRef(scenes);
  const modeRef = useRef(mode);
  const projectIdRef = useRef(projectId);
  const slugRef = useRef(slug);
  formRef.current = form;
  scenesRef.current = scenes;
  modeRef.current = mode;
  projectIdRef.current = projectId;
  slugRef.current = slug;

  const style = styles.find((s) => s.id === form.style_id);

  const takeCount = useMemo(
    () =>
      mode === "manual"
        ? scenes.reduce((n, s) => n + (s.takes?.length || 0), 0)
        : Math.max(1, Math.round(Number(form.max_duration_sec) / 5)),
    [mode, scenes, form.max_duration_sec]
  );

  const applyProject = useCallback((p) => {
    const stats = p.stats || {};
    setProjectId(p.id);
    setSlug(p.slug || "story");
    setMode(stats.creation_mode === "manual" ? "manual" : "automatic");
    setForm({
      title: p.title || "",
      brief: p.brief || "",
      style_id: p.style_id || styles[0]?.id || "",
      max_duration_sec: Number(p.max_duration_sec) || 60,
      review_mode: p.review_mode || "automatico",
      model_pack: p.model_pack || "sfw",
      category: p.category || "general",
      width: Number(p.width) || VIDEO_FORMATS[0].width,
      height: Number(p.height) || VIDEO_FORMATS[0].height,
      seed_base: Number(p.seed_base) || 2000,
    });
    const nextScenes = takesToScenes(p.takes || []);
    setScenes(nextScenes);
    setExpandedSceneId(nextScenes[0]?.id || null);
  }, [styles]);

  useEffect(() => {
    if (!form.style_id && styles[0]) {
      setForm((f) => ({ ...f, style_id: styles[0].id }));
    }
  }, [styles, form.style_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBoot(true);
      try {
        const existingId = localStorage.getItem(STORAGE_KEY);
        if (existingId) {
          try {
            const p = await api.project(existingId);
            if (!cancelled && p?.status === "composing") {
              skipNextSaveRef.current = true;
              applyProject(p);
              hydratedRef.current = true;
              setBoot(false);
              return;
            }
          } catch {
            /* rascunho sumiu */
          }
          localStorage.removeItem(STORAGE_KEY);
        }
        const base = defaultForm(styles);
        const p = await api.createProject({
          ...base,
          title: base.title || t("create.defaultTitle"),
          style_id: base.style_id || null,
          status: "composing",
          stats: { creation_mode: "automatic" },
        });
        if (cancelled) return;
        localStorage.setItem(STORAGE_KEY, p.id);
        skipNextSaveRef.current = true;
        applyProject(p);
        hydratedRef.current = true;
      } catch (e) {
        if (!cancelled) setToast(String(e.message || e));
      } finally {
        if (!cancelled) setBoot(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.estimate(takeCount).then(setEstimate).catch(() => {});
  }, [takeCount]);

  useEffect(() => {
    if (mode !== "manual" || !scenes.length) return;
    if (!expandedSceneId || !scenes.some((s) => s.id === expandedSceneId)) {
      setExpandedSceneId(scenes[0].id);
    }
  }, [mode, scenes, expandedSceneId]);

  const buildPatch = useCallback(() => {
    const f = formRef.current;
    const m = modeRef.current;
    const s = scenesRef.current;
    const patch = {
      title: f.title || t("create.defaultTitle"),
      brief: f.brief,
      style_id: f.style_id || null,
      max_duration_sec: Number(f.max_duration_sec) || 60,
      review_mode: f.review_mode,
      model_pack: f.model_pack,
      category: f.category,
      width: Number(f.width),
      height: Number(f.height),
      seed_base: Number(f.seed_base) || 2000,
      stats: { creation_mode: m === "manual" ? "manual" : "automatic" },
    };
    if (m === "manual") {
      patch.takes = scenesToTakes(s, slugRef.current, f.seed_base);
    }
    return patch;
  }, [t]);

  const persist = useCallback(async () => {
    const id = projectIdRef.current;
    if (!id || !hydratedRef.current) return;
    setSaveState("saving");
    try {
      const updated = await api.patchProject(id, buildPatch());
      if (updated?.slug) setSlug(updated.slug);
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setToast(String(e.message || e));
    }
  }, [buildPatch, setToast]);

  useEffect(() => {
    if (boot || !projectId || !hydratedRef.current) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    setSaveState("pending");
    const timer = setTimeout(() => {
      persist();
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [boot, projectId, form, scenes, mode, persist]);

  async function rollDice() {
    setBusy(true);
    try {
      const d = await api.dice(form.model_pack);
      setForm((f) => ({
        ...f,
        brief: d.brief,
        title: d.title || f.title,
      }));
      setToast(t("create.diceToast"));
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    const ok = await confirm({
      title: t("create.discardTitle"),
      message: t("create.discardMsg"),
      confirmLabel: t("create.discardConfirm"),
      danger: true,
    });
    if (!ok || !projectId) return;
    setBusy(true);
    try {
      await api.deleteProject(projectId, true);
      localStorage.removeItem(STORAGE_KEY);
      setToast(t("create.discardedToast"));
      onBack();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function submitAutomatic() {
    if (!projectId) return;
    setBusy(true);
    try {
      await persist();
      const result = await api.generateStory(projectId, {
        brief: form.brief,
        use_dice: !form.brief.trim(),
      });
      localStorage.removeItem(STORAGE_KEY);
      setToast(t("create.readyToast"));
      onConfirmed(result.project);
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function submitManual() {
    if (!projectId) return;
    const takes = scenesToTakes(scenes, slug, form.seed_base);
    if (!takes.length) {
      setToast(t("create.manualNeedTakes"));
      return;
    }
    const emptyPrompt = takes.find((tk) => !tk.prompt);
    if (emptyPrompt) {
      setToast(t("create.manualNeedPrompt", { n: emptyPrompt.n }));
      return;
    }
    setBusy(true);
    try {
      const updated = await api.patchProject(projectId, {
        ...buildPatch(),
        takes,
        status: "draft",
        synopsis: form.brief || "",
      });
      localStorage.removeItem(STORAGE_KEY);
      setToast(t("create.manualReadyToast"));
      onConfirmed(updated);
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  function updateScene(sceneId, patch) {
    setScenes((list) => list.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)));
  }

  function updateTake(sceneId, takeId, patch) {
    setScenes((list) =>
      list.map((s) => {
        if (s.id !== sceneId) return s;
        return {
          ...s,
          takes: s.takes.map((tk) => (tk.id === takeId ? { ...tk, ...patch } : tk)),
        };
      })
    );
  }

  function removeTake(sceneId, takeId) {
    setScenes((list) =>
      list.map((s) => {
        if (s.id !== sceneId) return s;
        if ((s.takes?.length || 0) <= 1) return s;
        return { ...s, takes: s.takes.filter((tk) => tk.id !== takeId) };
      })
    );
  }

  function addScene() {
    const next = emptyScene(scenes.length + 1);
    setScenes((list) => [...list, next]);
    setExpandedSceneId(next.id);
  }

  function removeScene(sceneId) {
    setScenes((list) => {
      if (list.length <= 1) return list;
      const next = list.filter((s) => s.id !== sceneId);
      if (expandedSceneId === sceneId) setExpandedSceneId(next[0]?.id || null);
      return next;
    });
  }

  function addTake(sceneId) {
    setScenes((list) =>
      list.map((s) => {
        if (s.id !== sceneId) return s;
        if ((s.takes?.length || 0) >= 4) return s;
        return {
          ...s,
          takes: [
            ...s.takes,
            { id: `t_${Date.now()}`, title: "", prompt: "", duration: 5 },
          ],
        };
      })
    );
    setExpandedSceneId(sceneId);
  }

  const manualTotalSec = useMemo(() => scenesDuration(scenes), [scenes]);
  const maxSec = Number(form.max_duration_sec) || 60;
  const overBudget = mode === "manual" && manualTotalSec > maxSec + 0.05;
  const budgetPct = Math.min(100, Math.round((manualTotalSec / Math.max(1, maxSec)) * 100));
  const missingPrompts = useMemo(() => {
    if (mode !== "manual") return 0;
    return scenes.reduce(
      (n, sc) => n + (sc.takes || []).filter((tk) => !String(tk.prompt || "").trim()).length,
      0
    );
  }, [mode, scenes]);

  const saveLabel =
    saveState === "saving" || saveState === "pending"
      ? t("create.saving")
      : saveState === "saved"
        ? t("create.saved")
        : saveState === "error"
          ? t("create.saveError")
          : "";

  const takeOffsets = useMemo(() => {
    const offsets = [];
    let cursor = 0;
    for (const sc of scenes) {
      offsets.push(cursor);
      cursor += sc.takes?.length || 0;
    }
    return offsets;
  }, [scenes]);

  return (
    <div className="create-page">
      <header className="create-page-head">
        <div>
          <h1>{t("create.title")}</h1>
          <p className="muted">{t("create.pageSubtitle")}</p>
        </div>
        <div className="create-page-actions">
          {saveLabel ? <span className="create-save-state muted">{saveLabel}</span> : null}
          <button type="button" className="ghost" disabled={busy || boot} onClick={onBack}>
            {t("common.close")}
          </button>
          <button type="button" className="ghost create-discard" disabled={busy || boot || !projectId} onClick={discard}>
            {t("create.discard")}
          </button>
        </div>
      </header>

      {boot ? (
        <div className="empty-hero">
          <p className="muted">{t("create.loadingDraft")}</p>
        </div>
      ) : (
        <>
          <div className="create-mode-switch" role="tablist" aria-label={t("create.modeSwitch")}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "automatic"}
              className={`create-mode-tab ${mode === "automatic" ? "is-on" : ""}`}
              onClick={() => setMode("automatic")}
              disabled={busy}
            >
              <strong>{t("create.modeAuto")}</strong>
              <span>{t("create.modeAutoHint")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "manual"}
              className={`create-mode-tab ${mode === "manual" ? "is-on" : ""}`}
              onClick={() => setMode("manual")}
              disabled={busy}
            >
              <strong>{t("create.modeManual")}</strong>
              <span>{t("create.modeManualHint")}</span>
            </button>
          </div>

          <div className="create-page-body stack">
            {mode === "automatic" ? (
              <section className="create-hero-card">
                <div className="create-brief-label">
                  <label>{t("create.briefLabel")}</label>
                  <button
                    type="button"
                    className="dice-btn"
                    disabled={busy}
                    title={t("create.diceTitle")}
                    aria-label={t("create.diceTitle")}
                    onClick={rollDice}
                  >
                    <DiceIcon />
                  </button>
                </div>
                <textarea
                  value={form.brief}
                  onChange={(e) => setForm({ ...form, brief: e.target.value })}
                  placeholder={t("create.briefPh")}
                  className="create-brief"
                  disabled={busy}
                />
                <p className="create-inline-hint muted">
                  {t("create.diceHint", { pack: form.model_pack.toUpperCase() })}
                </p>
              </section>
            ) : null}

            <section className={`create-setup ${setupOpen ? "is-open" : "is-collapsed"}`}>
              <button
                type="button"
                className="create-setup-toggle"
                onClick={() => setSetupOpen((v) => !v)}
                aria-expanded={setupOpen}
              >
                <span>
                  <strong>{t("create.setupTitle")}</strong>
                  <span className="muted create-setup-summary">
                    {(form.title || t("create.defaultTitle")) +
                      " · " +
                      (style?.label || t("create.noStyle")) +
                      " · " +
                      `${form.width}×${form.height}` +
                      " · " +
                      form.model_pack.toUpperCase() +
                      " · " +
                      (form.review_mode === "com_revisao"
                        ? t("create.withReview")
                        : t("create.noReview"))}
                  </span>
                </span>
                <span className="create-chevron" aria-hidden>
                  {setupOpen ? "▾" : "▸"}
                </span>
              </button>

              {setupOpen ? (
                <div className="create-setup-body">
                  <div className="create-setup-grid">
                    <div className="field">
                      <label>{t("create.titleLabel")}</label>
                      <input
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        placeholder={t("create.titlePh")}
                        disabled={busy}
                      />
                    </div>
                    <div className="field">
                      <label>{t("create.style")}</label>
                      <select
                        value={form.style_id}
                        onChange={(e) => setForm({ ...form, style_id: e.target.value })}
                        disabled={busy}
                      >
                        <option value="">{t("create.noStyle")}</option>
                        {styles.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      {style?.bible_hint_pt ? (
                        <p className="create-style-hint">{style.bible_hint_pt}</p>
                      ) : null}
                    </div>
                  </div>

                  {mode === "manual" ? (
                    <div className="field">
                      <label>{t("create.briefOptional")}</label>
                      <textarea
                        value={form.brief}
                        onChange={(e) => setForm({ ...form, brief: e.target.value })}
                        placeholder={t("create.briefOptionalPh")}
                        className="create-brief create-brief-short"
                        disabled={busy}
                      />
                    </div>
                  ) : null}

                  <div className="create-setup-grid">
                    <VideoFormat
                      width={form.width}
                      height={form.height}
                      disabled={busy}
                      onChange={(dimensions) => setForm((prev) => ({ ...prev, ...dimensions }))}
                    />
                    <div className="field">
                      <label>{t("category.label")}</label>
                      <select
                        value={form.category}
                        disabled={busy || !footageAvailable}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                      >
                        <option value="general">{t("category.general")}</option>
                        <option value="footage">Footage</option>
                      </select>
                    </div>
                  </div>

                  <div className="create-chip-groups">
                    <div className="create-chip-group">
                      <span className="create-chip-label">{t("create.packLabel")}</span>
                      <div className="chip-row">
                        <button
                          type="button"
                          className={`chip ${form.model_pack === "sfw" ? "active" : ""}`}
                          onClick={() => setForm({ ...form, model_pack: "sfw" })}
                          disabled={busy}
                        >
                          SFW
                        </button>
                        <button
                          type="button"
                          className={`chip ${form.model_pack === "nsfw" ? "active" : ""}`}
                          onClick={() => setForm({ ...form, model_pack: "nsfw" })}
                          disabled={busy}
                        >
                          NSFW
                        </button>
                      </div>
                    </div>
                    <div className="create-chip-group">
                      <span className="create-chip-label">{t("create.reviewLabel")}</span>
                      <div className="chip-row">
                        <button
                          type="button"
                          className={`chip ${form.review_mode === "automatico" ? "active" : ""}`}
                          onClick={() => setForm({ ...form, review_mode: "automatico" })}
                          disabled={busy}
                        >
                          {t("create.noReview")}
                        </button>
                        <button
                          type="button"
                          className={`chip ${form.review_mode === "com_revisao" ? "active" : ""}`}
                          onClick={() => setForm({ ...form, review_mode: "com_revisao" })}
                          disabled={busy}
                        >
                          {t("create.withReview")}
                        </button>
                      </div>
                    </div>
                    <div className="create-chip-group create-max-time">
                      <span className="create-chip-label">{t("create.maxTime")}</span>
                      <input
                        type="number"
                        min={10}
                        max={600}
                        value={form.max_duration_sec}
                        onChange={(e) =>
                          setForm({ ...form, max_duration_sec: Number(e.target.value) })
                        }
                        disabled={busy}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </section>

            {mode === "manual" ? (
              <section className="create-manual">
                <div className="create-manual-head">
                  <div>
                    <h2>{t("create.manualTitle")}</h2>
                    <p className="muted">{t("create.manualHint")}</p>
                  </div>
                  <div className={`create-budget ${overBudget ? "is-over" : ""}`}>
                    <div className="create-budget-meta">
                      <strong>
                        {t("create.budgetUsed", {
                          used: Math.round(manualTotalSec),
                          max: Math.round(maxSec),
                        })}
                      </strong>
                      <span className="muted">
                        {t("create.budgetTakes", {
                          takes: takeCount,
                          scenes: scenes.length,
                        })}
                      </span>
                    </div>
                    <div className="create-budget-bar" aria-hidden>
                      <i style={{ width: `${budgetPct}%` }} />
                    </div>
                    {overBudget ? (
                      <p className="create-budget-warn">{t("create.budgetOver")}</p>
                    ) : null}
                    {missingPrompts > 0 ? (
                      <p className="create-budget-warn">
                        {t("create.missingPrompts", { n: missingPrompts })}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="create-scene-list">
                  {scenes.map((scene, sceneIdx) => {
                    const open = expandedSceneId === scene.id;
                    const scDur = sceneDuration(scene);
                    const takeStart = takeOffsets[sceneIdx] || 0;
                    return (
                      <article
                        key={scene.id}
                        className={`create-scene ${open ? "is-open" : ""}`}
                      >
                        <header className="create-scene-head">
                          <button
                            type="button"
                            className="create-scene-toggle"
                            onClick={() =>
                              setExpandedSceneId(open ? null : scene.id)
                            }
                            aria-expanded={open}
                          >
                            <span className="create-scene-index">{sceneIdx + 1}</span>
                            <span className="create-scene-title-wrap">
                              <span className="create-scene-title">
                                {scene.session || t("create.sceneUntitled", { n: sceneIdx + 1 })}
                              </span>
                              <span className="muted">
                                {t("create.sceneMeta", {
                                  takes: scene.takes?.length || 0,
                                  sec: Math.round(scDur),
                                })}
                              </span>
                            </span>
                            <span className="create-chevron" aria-hidden>
                              {open ? "▾" : "▸"}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="ghost create-icon-btn"
                            disabled={busy || scenes.length <= 1}
                            title={t("create.removeScene")}
                            aria-label={t("create.removeScene")}
                            onClick={() => removeScene(scene.id)}
                          >
                            ×
                          </button>
                        </header>

                        {open ? (
                          <div className="create-scene-body">
                            <div className="field">
                              <label>{t("create.sceneName")}</label>
                              <input
                                value={scene.session}
                                onChange={(e) =>
                                  updateScene(scene.id, { session: e.target.value })
                                }
                                placeholder={t("create.scenePh")}
                                disabled={busy}
                              />
                              <p className="create-inline-hint muted">
                                {t("create.sceneSessionHint")}
                              </p>
                            </div>

                            <div className="create-take-list">
                              {scene.takes.map((take, takeIdx) => {
                                const n = takeStart + takeIdx + 1;
                                const kind = takeIdx === 0 ? "NEW" : "CONTINUE";
                                const empty = !String(take.prompt || "").trim();
                                return (
                                  <div
                                    key={take.id}
                                    className={`create-take ${empty ? "is-empty" : ""}`}
                                  >
                                    <div className="create-take-rail" aria-hidden>
                                      <span className="create-take-n">
                                        t{String(n).padStart(2, "0")}
                                      </span>
                                      <span
                                        className={`create-take-kind ${
                                          takeIdx === 0 ? "is-new" : "is-cont"
                                        }`}
                                      >
                                        {kind}
                                      </span>
                                    </div>
                                    <div className="create-take-main">
                                      <div className="create-take-head">
                                        <input
                                          className="create-take-title-input"
                                          value={take.title}
                                          onChange={(e) =>
                                            updateTake(scene.id, take.id, {
                                              title: e.target.value,
                                            })
                                          }
                                          placeholder={t("create.takeTitlePh")}
                                          disabled={busy}
                                        />
                                        <button
                                          type="button"
                                          className="ghost create-icon-btn"
                                          disabled={busy || scene.takes.length <= 1}
                                          title={t("create.removeTake")}
                                          aria-label={t("create.removeTake")}
                                          onClick={() => removeTake(scene.id, take.id)}
                                        >
                                          ×
                                        </button>
                                      </div>

                                      <div className="create-dur-row">
                                        <span className="create-chip-label">
                                          {t("create.takeDuration")}
                                        </span>
                                        <div className="chip-row create-dur-chips">
                                          {DURATION_PRESETS.map((sec) => (
                                            <button
                                              key={sec}
                                              type="button"
                                              className={`chip ${
                                                Number(take.duration) === sec ? "active" : ""
                                              }`}
                                              disabled={busy}
                                              onClick={() =>
                                                updateTake(scene.id, take.id, {
                                                  duration: sec,
                                                })
                                              }
                                            >
                                              {sec}s
                                            </button>
                                          ))}
                                        </div>
                                      </div>

                                      <div className="field">
                                        <label>{t("create.takePrompt")}</label>
                                        <textarea
                                          value={take.prompt}
                                          onChange={(e) =>
                                            updateTake(scene.id, take.id, {
                                              prompt: e.target.value,
                                            })
                                          }
                                          placeholder={t("create.takePromptPh")}
                                          className="create-take-prompt"
                                          disabled={busy}
                                        />
                                        {empty ? (
                                          <p className="create-inline-hint create-warn-hint">
                                            {t("create.takePromptNeeded")}
                                          </p>
                                        ) : (
                                          <p className="create-inline-hint muted">
                                            {t("create.takePromptHint")}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <button
                              type="button"
                              className="create-add-btn"
                              disabled={busy || (scene.takes?.length || 0) >= 4}
                              onClick={() => addTake(scene.id)}
                            >
                              {t("create.addTake")}
                              {(scene.takes?.length || 0) >= 4 ? (
                                <span className="muted"> · {t("create.takeLimit")}</span>
                              ) : null}
                            </button>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>

                <button type="button" className="create-add-btn is-scene" disabled={busy} onClick={addScene}>
                  {t("create.addScene")}
                </button>
              </section>
            ) : null}
          </div>

          <footer className="create-page-foot">
            <div className="create-foot-meta">
              {estimate ? (
                <div className="cta-cost">
                  {t("create.estimate", {
                    min: estimate.total_min,
                    kwh: estimate.energy_kwh,
                    cost: estimate.cost_brl,
                  })}
                  <span className="muted">{t("create.estimateTakes", { n: takeCount })}</span>
                </div>
              ) : (
                <div className="cta-cost">{t("create.estimating")}</div>
              )}
              {mode === "manual" ? (
                <div className={`create-foot-budget muted ${overBudget ? "is-over" : ""}`}>
                  {t("create.budgetUsed", {
                    used: Math.round(manualTotalSec),
                    max: Math.round(maxSec),
                  })}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="primary create-submit"
              disabled={busy || !projectId || (mode === "manual" && (missingPrompts > 0 || overBudget))}
              onClick={mode === "manual" ? submitManual : submitAutomatic}
            >
              {mode === "manual" ? t("create.submitManual") : t("create.submit")}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
