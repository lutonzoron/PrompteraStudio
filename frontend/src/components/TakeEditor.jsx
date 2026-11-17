import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useConfirm } from "./ConfirmDialog.jsx";
import {
  cleanTitle,
  fmtDate,
  groupTakesBySession,
  isNsfw,
  posterSrc,
  statusLabel,
  summarizeTakePrompt,
} from "../utils.js";
import { useLocale, useT } from "../i18n/index.jsx";
import { VIDEO_FORMATS } from "./VideoFormat.jsx";
import { takeSelectedFiles } from "../editorFiles.js";

const SESSION_HUES = [152, 210, 28, 280, 48, 330];
const PX_PER_SEC = 28;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function sessionHue(session, index) {
  let hash = 0;
  const s = String(session || "default");
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return SESSION_HUES[(index ?? hash) % SESSION_HUES.length];
}

function formatMeta(width, height) {
  const w = Number(width) || 576;
  const h = Number(height) || 1024;
  const preset = VIDEO_FORMATS.find((f) => f.width === w && f.height === h);
  return { width: w, height: h, ratio: preset?.ratio || `${w}:${h}`, aspect: `${w} / ${h}` };
}

function fmtClock(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}.${ms}`;
}

function listAudioClips(mix) {
  return Array.isArray(mix?.audio_clips) ? mix.audio_clips.filter((c) => c && c.id) : [];
}

function buildSegments(takes) {
  let cursor = 0;
  return takes
    .slice()
    .sort((a, b) => Number(a.n) - Number(b.n))
    .map((tk) => {
      const duration = Math.max(0.5, Number(tk.duration) || 5);
      const start = cursor;
      const end = cursor + duration;
      cursor = end;
      return {
        n: Number(tk.n),
        kind: String(tk.kind || "").toLowerCase(),
        session: String(tk.session || "default"),
        duration,
        start,
        end,
        prompt: tk.prompt || "",
        title: tk.title || "",
      };
    });
}

export default function TakeEditor({
  project,
  setProject,
  busy,
  setBusy,
  setToast,
  onRefresh,
  onBack,
}) {
  const t = useT();
  const { dateLocale } = useLocale();
  const confirm = useConfirm();
  const videoRef = useRef(null);
  const audioElsRef = useRef(new Map());
  const audioInputRef = useRef(null);
  const canvasRef = useRef(null);
  const scrollRef = useRef(null);
  const playheadElRef = useRef(null);
  const zoomRef = useRef(1);
  const selectedRef = useRef(null);
  const totalSecRef = useRef(1);
  const pxPerSecRef = useRef(PX_PER_SEC);
  const playheadRef = useRef(0);
  const rafRef = useRef(0);
  const mixRef = useRef({ muted_takes: [], audio_clips: [] });

  const [selectedTake, setSelectedTake] = useState(null);
  const [selectedAudioId, setSelectedAudioId] = useState(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inspectorTab, setInspectorTab] = useState("take"); // take | masters
  const [mix, setMix] = useState(() => ({
    muted_takes: [],
    audio_clips: [],
    ...(project?.editor_mix || {}),
  }));
  const [zoom, setZoom] = useState(1);
  const [versions, setVersions] = useState(() => project?.master_versions || []);
  const [mediaDuration, setMediaDuration] = useState(0);
  mixRef.current = mix;
  zoomRef.current = zoom;

  useEffect(() => {
    setVersions(project?.master_versions || []);
  }, [project?.id, project?.master_versions]);

  const takes = project?.takes || [];
  const editorTakes = project?.editor_takes || [];
  const byEditor = useMemo(() => {
    const map = new Map();
    for (const row of editorTakes) map.set(Number(row.n), row);
    return map;
  }, [editorTakes]);

  const done = useMemo(
    () =>
      new Set(
        (project?.runner_state?.completed || project?.progress?.completed_ns || []).map(Number)
      ),
    [project]
  );
  const scenes = useMemo(() => groupTakesBySession(takes), [takes]);
  const segments = useMemo(() => buildSegments(takes), [takes]);
  const declaredTotal = segments.length ? segments[segments.length - 1].end : 1;
  const totalSec = Math.max(declaredTotal, mediaDuration || 0, 1);
  const mutedSet = useMemo(
    () => new Set((mix.muted_takes || []).map(Number)),
    [mix.muted_takes]
  );

  const selected = segments.find((s) => s.n === Number(selectedTake)) || null;
  const selectedMeta = selected ? byEditor.get(selected.n) : null;

  selectedRef.current = selected;
  totalSecRef.current = totalSec;
  const cascade = useMemo(() => {
    if (selectedMeta?.cascade_ns?.length) return selectedMeta.cascade_ns.map(Number);
    if (!selected) return [];
    return segments
      .filter((s) => s.session === selected.session && s.n >= selected.n)
      .map((s) => s.n);
  }, [selected, selectedMeta, segments]);

  const activeSeg =
    segments.find((s) => playhead >= s.start && playhead < s.end) ||
    segments[segments.length - 1] ||
    null;

  const format = formatMeta(project?.width, project?.height);
  const nsfw = isNsfw(project);
  const masterUrl = useMemo(() => {
    const base =
      project?.master_url ||
      (project?.has_master ? `/api/projects/${project.id}/master` : null) ||
      project?.preview_url ||
      null;
    if (!base) return null;
    const join = base.includes("?") ? "&" : "?";
    return `${base}${join}v=${encodeURIComponent(project?.updated_at || Date.now())}`;
  }, [project?.master_url, project?.has_master, project?.preview_url, project?.id, project?.updated_at]);

  const monitorUrl = masterUrl;
  const pxPerSec = PX_PER_SEC * zoom;
  const trackWidth = Math.max(640, totalSec * pxPerSec + 40);
  pxPerSecRef.current = pxPerSec;

  useEffect(() => {
    if (playheadElRef.current) {
      playheadElRef.current.style.left = `${playheadRef.current * pxPerSec}px`;
      playheadElRef.current.style.transform = "none";
    }
  }, [pxPerSec]);

  const applyZoom = useCallback((nextZoom, anchorClientX = null) => {
    const z = clamp(Number(nextZoom) || 1, ZOOM_MIN, ZOOM_MAX);
    const scroll = scrollRef.current;
    const canvas = canvasRef.current;
    const prev = zoomRef.current || 1;
    if (Math.abs(z - prev) < 0.001) return;

    if (scroll && canvas && anchorClientX != null) {
      const rect = canvas.getBoundingClientRect();
      const xInCanvas = anchorClientX - rect.left;
      const timeAtCursor = xInCanvas / (PX_PER_SEC * prev);
      zoomRef.current = z;
      setZoom(z);
      requestAnimationFrame(() => {
        const sc = scrollRef.current;
        if (!sc) return;
        const newX = timeAtCursor * PX_PER_SEC * z;
        const viewX = anchorClientX - sc.getBoundingClientRect().left;
        sc.scrollLeft = Math.max(0, newX - viewX);
      });
      return;
    }

    zoomRef.current = z;
    setZoom(z);
  }, []);

  const onTimelineWheel = useCallback(
    (e) => {
      // Zoom with wheel (or pinch-trackpad). Shift+wheel keeps native horizontal scroll.
      if (e.shiftKey) return;
      e.preventDefault();
      const direction = e.deltaY > 0 ? -1 : 1;
      const factor = e.ctrlKey || e.metaKey ? 1.18 : 1.1;
      const next = direction > 0 ? zoomRef.current * factor : zoomRef.current / factor;
      applyZoom(next, e.clientX);
    },
    [applyZoom]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("wheel", onTimelineWheel, { passive: false });
    return () => el.removeEventListener("wheel", onTimelineWheel);
  }, [onTimelineWheel]);

  const setPlayheadUI = useCallback((time, { syncReact = true } = {}) => {
    const t = clamp(Number(time) || 0, 0, totalSecRef.current || 1);
    playheadRef.current = t;
    if (playheadElRef.current) {
      // left + width coordinate — avoid fighting React style attributes
      playheadElRef.current.style.left = `${t * pxPerSecRef.current}px`;
      playheadElRef.current.style.transform = "none";
    }
    if (syncReact) setPlayhead(t);
  }, []);

  const readVideoTimelineTime = useCallback(() => {
    const video = videoRef.current;
    if (!video) return playheadRef.current;
    // Master clock: 1s of video = 1s on the timeline.
    return clamp(Number(video.currentTime) || 0, 0, totalSecRef.current || 1);
  }, []);

  const seekVideoToTimeline = useCallback((time) => {
    const video = videoRef.current;
    if (!video) return;
    const t = clamp(Number(time) || 0, 0, totalSecRef.current || 1);
    try {
      const md = Number(video.duration);
      video.currentTime =
        Number.isFinite(md) && md > 0 ? clamp(t, 0, Math.max(0, md - 0.05)) : t;
    } catch {
      /* ignore */
    }
  }, []);

  const audioClips = useMemo(() => listAudioClips(mix), [mix]);
  const audioTracks = useMemo(() => {
    const maxTrack = audioClips.reduce((m, c) => Math.max(m, Number(c.track) || 0), -1);
    const count = Math.max(1, maxTrack + 1);
    return Array.from({ length: count }, (_, i) => i);
  }, [audioClips]);
  const selectedAudio = audioClips.find((c) => c.id === selectedAudioId) || null;

  useEffect(() => {
    const next = project?.editor_mix || {};
    setMix({
      muted_takes: next.muted_takes || [],
      audio_clips: next.audio_clips || [],
      ...next,
    });
  }, [project?.id, project?.editor_mix]);

  useEffect(() => {
    setPromptDraft(selected?.prompt || "");
  }, [selected?.n, selected?.prompt]);

  useEffect(() => {
    if (!segments.length) return;
    if (selectedTake != null && segments.some((s) => s.n === Number(selectedTake))) return;
    const first =
      segments.find((s) => byEditor.get(s.n)?.has_clip)?.n ||
      segments.find((s) => done.has(s.n))?.n ||
      segments[0]?.n;
    if (first != null) setSelectedTake(first);
  }, [segments, selectedTake, byEditor, done]);

  const syncAudioToPlayhead = useCallback((time, shouldPlay) => {
    const clips = listAudioClips(mixRef.current);
    for (const clip of clips) {
      const el = audioElsRef.current.get(clip.id);
      if (!el) continue;
      const offset = Number(clip.offset_sec) || 0;
      const dur = Number(clip.duration_sec);
      const local = time - offset;
      const inRange = local >= -0.05 && (!Number.isFinite(dur) || local <= dur + 0.05);
      el.volume = Math.max(0, Math.min(1, Number(clip.volume) ?? 0.7));
      if (!inRange) {
        el.pause();
        continue;
      }
      const target = Math.max(0, local);
      if (Math.abs((el.currentTime || 0) - target) > 0.3) {
        try {
          el.currentTime = target;
        } catch {
          /* ignore */
        }
      }
      if (shouldPlay) el.play().catch(() => {});
      else el.pause();
    }
  }, []);

  const applyMuteForTime = useCallback(
    (time) => {
      const video = videoRef.current;
      if (!video) return;
      const seg = segments.find((s) => time >= s.start && time < s.end);
      video.muted = seg ? mutedSet.has(seg.n) : false;
    },
    [mutedSet, segments]
  );

  useEffect(() => {
    applyMuteForTime(playheadRef.current);
  }, [applyMuteForTime, monitorUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let lastReactSync = 0;

    const tick = (now) => {
      const time = readVideoTimelineTime();
      // DOM needle every frame; React clock ~12fps to avoid thrashing layout.
      setPlayheadUI(time, { syncReact: now - lastReactSync > 80 });
      if (now - lastReactSync > 80) lastReactSync = now;
      applyMuteForTime(time);
      syncAudioToPlayhead(time, !video.paused);
      rafRef.current = requestAnimationFrame(tick);
    };

    const stopRaf = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };

    const onPlay = () => {
      setPlaying(true);
      stopRaf();
      rafRef.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      stopRaf();
      const time = readVideoTimelineTime();
      setPlayheadUI(time);
      applyMuteForTime(time);
      syncAudioToPlayhead(time, false);
    };
    const onEnded = () => {
      setPlaying(false);
      stopRaf();
      for (const el of audioElsRef.current.values()) el.pause();
    };
    const onSeeked = () => {
      const time = readVideoTimelineTime();
      setPlayheadUI(time);
      applyMuteForTime(time);
    };
    const onMeta = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setMediaDuration(video.duration);
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadedmetadata", onMeta);
    if (video.readyState >= 1) onMeta();
    if (!video.paused) onPlay();

    return () => {
      stopRaf();
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadedmetadata", onMeta);
    };
  }, [monitorUrl, readVideoTimelineTime, setPlayheadUI, applyMuteForTime, syncAudioToPlayhead]);

  function selectTake(n) {
    setSelectedTake(n);
    setSelectedAudioId(null);
    setInspectorTab("take");
    const seg = segments.find((s) => s.n === n);
    if (!seg) return;
    setPlayheadUI(seg.start);
    requestAnimationFrame(() => seekVideoToTimeline(seg.start));
  }

  function seekTimeline(clientX) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const time = clamp(x / pxPerSecRef.current, 0, totalSecRef.current);
    setPlayheadUI(time);
    const seg = segments.find((s) => time >= s.start && time < s.end) || segments[segments.length - 1];
    if (seg) {
      setSelectedTake(seg.n);
      setSelectedAudioId(null);
    }
    seekVideoToTimeline(time);
    syncAudioToPlayhead(time, !videoRef.current?.paused);
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video || !monitorUrl) return;
    if (video.paused) {
      syncAudioToPlayhead(playheadRef.current, true);
      video.play().catch(() => {});
    } else {
      video.pause();
      for (const el of audioElsRef.current.values()) el.pause();
    }
  }

  async function persistMix(next) {
    setMix(next);
    if (!project?.id) return;
    try {
      const r = await api.saveEditorMix(project.id, {
        muted_takes: next.muted_takes || [],
        audio_clips: listAudioClips(next).map((c) => ({
          id: c.id,
          offset_sec: Number(c.offset_sec) || 0,
          volume: Number(c.volume) ?? 0.7,
          track: Number(c.track) || 0,
          duration_sec: c.duration_sec == null ? null : Number(c.duration_sec),
          label: c.label || null,
        })),
      });
      if (r.editor_mix) {
        setMix(r.editor_mix);
        setProject?.({ ...project, editor_mix: r.editor_mix });
      }
    } catch (e) {
      setToast?.(String(e.message || e));
    }
  }

  function toggleMuteTake(n) {
    const set = new Set(mix.muted_takes || []);
    if (set.has(n)) set.delete(n);
    else set.add(n);
    persistMix({ ...mix, muted_takes: [...set].sort((a, b) => a - b) });
  }

  function patchAudioClip(clipId, patch) {
    const clips = listAudioClips(mix).map((c) =>
      c.id === clipId ? { ...c, ...patch } : c
    );
    persistMix({ ...mix, audio_clips: clips });
  }

  async function onAudioFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length || !project?.id) return;
    setBusy?.(true);
    try {
      let nextMix = mix;
      for (const file of files) {
        const r = await api.uploadEditorAudio(project.id, file, {
          offset_sec: playheadRef.current || 0,
        });
        nextMix = r.editor_mix || nextMix;
        if (r.clip_id) setSelectedAudioId(r.clip_id);
      }
      setMix(nextMix);
      setProject?.({ ...project, editor_mix: nextMix });
      setToast?.(
        files.length > 1
          ? t("editor.audioAddedMany", { n: files.length })
          : t("editor.audioAdded")
      );
    } catch (e) {
      setToast?.(String(e.message || e));
    } finally {
      setBusy?.(false);
    }
  }

  async function removeAudioClip(clipId) {
    if (!project?.id || !clipId) return;
    setBusy?.(true);
    try {
      const r = await api.deleteEditorAudio(project.id, clipId);
      const next = r.editor_mix || { muted_takes: mix.muted_takes || [], audio_clips: [] };
      setMix(next);
      setProject?.({ ...project, editor_mix: next });
      if (selectedAudioId === clipId) setSelectedAudioId(null);
      setToast?.(t("editor.audioRemoved"));
    } catch (e) {
      setToast?.(String(e.message || e));
    } finally {
      setBusy?.(false);
    }
  }

  function bindAudioEl(clipId, el) {
    if (!clipId) return;
    if (el) audioElsRef.current.set(clipId, el);
    else audioElsRef.current.delete(clipId);
  }

  function onAudioMeta(clipId, el) {
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const clips = listAudioClips(mixRef.current);
    const cur = clips.find((c) => c.id === clipId);
    if (!cur) return;
    if (cur.duration_sec && Math.abs(cur.duration_sec - el.duration) < 0.2) return;
    patchAudioClip(clipId, { duration_sec: el.duration });
  }

  async function exportEditorMaster() {
    if (!project?.id) return;
    const ok = await confirm({
      title: t("editor.exportMasterTitle"),
      message: t("editor.exportMasterWarning"),
      confirmLabel: t("editor.exportMasterConfirm"),
    });
    if (!ok) return;
    setBusy?.(true);
    try {
      const r = await api.buildEditorMaster(project.id, {
        label: t("editor.exportMasterLabel"),
      });
      if (r.project) setProject(r.project);
      else {
        const p = await api.project(project.id);
        setProject(p);
      }
      if (r.master_versions) setVersions(r.master_versions);
      setToast?.(t("editor.exportMasterDone"));
      onRefresh?.();
    } catch (e) {
      setToast?.(String(e.message || e));
    } finally {
      setBusy?.(false);
    }
  }

  async function restoreVersion(versionId) {
    if (!project?.id || !versionId) return;
    const ok = await confirm({
      title: t("editor.restoreVersionTitle"),
      message: t("editor.restoreVersionWarning"),
      confirmLabel: t("editor.restoreVersionConfirm"),
    });
    if (!ok) return;
    setBusy?.(true);
    try {
      const r = await api.restoreMasterVersion(project.id, versionId);
      if (r.project) setProject(r.project);
      if (r.master_versions) setVersions(r.master_versions);
      setToast?.(t("editor.restoreVersionDone"));
      onRefresh?.();
    } catch (e) {
      setToast?.(String(e.message || e));
    } finally {
      setBusy?.(false);
    }
  }

  async function regenerateSelected() {
    if (!selected || !project?.id) return;
    if (!["done", "failed"].includes(project.status)) {
      setToast?.(t("editor.needDone"));
      return;
    }
    const cascadeLabel = cascade.map((n) => `t${String(n).padStart(2, "0")}`).join(", ");
    const ok = await confirm({
      title: t("editor.regenTitle", { n: selected.n }),
      message: t("editor.regenWarning", {
        n: selected.n,
        cascade: cascadeLabel,
        count: cascade.length,
      }),
      confirmLabel: t("editor.regenConfirm"),
      danger: true,
    });
    if (!ok) return;
    const promptChanged =
      promptDraft.trim() && promptDraft.trim() !== String(selected.prompt || "").trim();
    setBusy?.(true);
    try {
      const r = await api.regenerateFromTake(project.id, {
        take_n: Number(selected.n),
        prompt: promptChanged ? promptDraft.trim() : undefined,
        confirmed: true,
      });
      if (r.project) setProject(r.project);
      else setProject(await api.project(project.id));
      setToast?.(t("editor.regenQueued", { n: selected.n, count: cascade.length }));
      onRefresh?.();
    } catch (e) {
      setToast?.(String(e.message || e));
    } finally {
      setBusy?.(false);
    }
  }

  const canRegen =
    !!selected && ["done", "failed"].includes(project?.status) && !busy &&
    !["generating", "queued", "paused", "awaiting_review"].includes(project?.status);
  const summary = selected ? summarizeTakePrompt(promptDraft || selected.prompt) : null;
  if (!project) return null;

  return (
    <div className="te-page">
      <nav className="pp-crumb te-page-crumb">
        <button type="button" className="pp-back" onClick={onBack}>
          <span aria-hidden>←</span> {t("editor.backProject")}
        </button>
        <span className="pp-crumb-sep" aria-hidden>/</span>
        <span className="pp-crumb-title">{cleanTitle(project.title)}</span>
        <span className="pp-crumb-sep" aria-hidden>/</span>
        <span className="pp-crumb-title">{t("editor.open")}</span>
        <div className="pp-crumb-pills">
          <span className={`status-pill ${project.status}`}>{statusLabel(project.status, t)}</span>
          <span className="status-pill">{format.ratio}</span>
          <span className="status-pill">{fmtClock(playhead)} / {fmtClock(totalSec)}</span>
        </div>
      </nav>

      <div className="te-page-body">
        <div className="te-stage">
          <div className="te-monitor">
            <div
              className="te-frame te-frame-lg"
              style={{ aspectRatio: format.aspect }}
            >
              {monitorUrl ? (
                <video
                  ref={videoRef}
                  className="pp-video"
                  key={monitorUrl}
                  src={monitorUrl}
                  playsInline
                  poster={nsfw ? undefined : posterSrc(project) || undefined}
                  onLoadedMetadata={() => {
                    const v = videoRef.current;
                    if (!v) return;
                    if (Number.isFinite(v.duration) && v.duration > 0) {
                      setMediaDuration(v.duration);
                    }
                  }}
                  onLoadedData={() => {
                    const v = videoRef.current;
                    if (!v) return;
                    applyMuteForTime(playheadRef.current);
                    seekVideoToTimeline(playheadRef.current);
                  }}
                />
              ) : (
                <div className={`pp-empty ${nsfw ? "nsfw-cover" : ""}`}>
                  <div className="pp-empty-mark">▶</div>
                  <p>{t("editor.noProgram")}</p>
                </div>
              )}
              <div className="pp-frame-badge">
                {activeSeg ? <span>{t("project.takeLabel", { n: activeSeg.n })}</span> : null}
                {activeSeg && mutedSet.has(activeSeg.n) ? (
                  <span className="te-badge-mute">{t("editor.muted")}</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <aside className="te-inspector te-page-inspector">
          <div className="te-inspector-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === "take"}
              className={inspectorTab === "take" ? "is-active" : ""}
              onClick={() => setInspectorTab("take")}
            >
              {t("editor.tabTake")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === "masters"}
              className={inspectorTab === "masters" ? "is-active" : ""}
              onClick={() => setInspectorTab("masters")}
            >
              {t("editor.tabMasters")}
              {versions.length ? (
                <span className="te-tab-count">{versions.length}</span>
              ) : null}
            </button>
          </div>

          {inspectorTab === "take" ? (
            selected ? (
              <div className="te-inspector-pane">
                <header className="te-inspector-head">
                  <div>
                    <strong>{t("project.takeLabel", { n: selected.n })}</strong>
                    <span className="muted">
                      {" "}
                      · {selected.kind.toUpperCase()} · {selected.duration}s
                    </span>
                  </div>
                  <span className="te-session-pill" title={selected.session}>
                    {selected.session}
                  </span>
                </header>
                {summary?.preview ? <p className="te-beat">{summary.preview}</p> : null}

                <div className="te-inline-actions">
                  <button
                    type="button"
                    className={mutedSet.has(selected.n) ? "danger" : ""}
                    onClick={() => toggleMuteTake(selected.n)}
                  >
                    {mutedSet.has(selected.n) ? t("editor.unmute") : t("editor.mute")}
                  </button>
                  {selectedMeta?.has_clip ? (
                    <span className="muted te-clip-ok">{t("editor.hasClip")}</span>
                  ) : (
                    <span className="muted">{t("editor.noClip")}</span>
                  )}
                </div>

                <label className="te-label" htmlFor={`te-prompt-${selected.n}`}>
                  {t("editor.promptLabel")}
                </label>
                <textarea
                  id={`te-prompt-${selected.n}`}
                  className="te-prompt"
                  rows={6}
                  value={promptDraft}
                  disabled={busy}
                  onChange={(e) => setPromptDraft(e.target.value)}
                />

                <div className="te-cascade">
                  <span className="te-label">{t("editor.cascadeLabel")}</span>
                  <p className="muted">
                    {cascade.length <= 1
                      ? t("editor.cascadeSolo", { n: selected.n })
                      : t("editor.cascadeList", {
                          list: cascade.map((n) => `t${String(n).padStart(2, "0")}`).join(", "),
                        })}
                  </p>
                </div>

                <div className="te-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={!canRegen}
                    onClick={regenerateSelected}
                  >
                    {t("editor.regenButton")}
                  </button>
                </div>
              </div>
            ) : (
              <p className="muted">{t("editor.selectTake")}</p>
            )
          ) : (
            <div className="te-inspector-pane te-versions">
              <div className="te-versions-head">
                <p className="muted te-versions-hint">{t("editor.versionsHint")}</p>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={exportEditorMaster}
                  title={t("editor.exportMasterHint")}
                >
                  {t("editor.exportMaster")}
                </button>
              </div>
              {versions.length ? (
                <ul className="te-versions-list">
                  {versions.map((v) => (
                    <li key={v.id} className={`te-version ${v.is_current ? "is-current" : ""}`}>
                      <div className="te-version-main">
                        <strong>{v.label || v.id}</strong>
                        <span className="muted">
                          {fmtDate(v.created_at, dateLocale)}
                          {v.is_current ? ` · ${t("editor.versionCurrent")}` : ""}
                        </span>
                        {(v.muted_takes?.length || v.audio_clip_ids?.length) ? (
                          <span className="muted te-version-meta">
                            {v.muted_takes?.length
                              ? t("editor.versionMutes", { n: v.muted_takes.length })
                              : null}
                            {v.muted_takes?.length && v.audio_clip_ids?.length ? " · " : null}
                            {v.audio_clip_ids?.length
                              ? t("editor.versionAudios", { n: v.audio_clip_ids.length })
                              : null}
                          </span>
                        ) : null}
                      </div>
                      <div className="te-version-actions">
                        {v.exists ? (
                          <a
                            className="btn-link"
                            href={api.masterVersionUrl(project.id, v.id)}
                            download
                          >
                            {t("editor.versionDownload")}
                          </a>
                        ) : (
                          <span className="muted">{t("editor.versionMissing")}</span>
                        )}
                        {!v.is_current && v.exists ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => restoreVersion(v.id)}
                          >
                            {t("editor.versionRestore")}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{t("editor.versionsEmpty")}</p>
              )}
            </div>
          )}
        </aside>
      </div>

      <div className="te-timeline-dock">
        <div className="te-timeline-head">
          <div className="te-timeline-title">
            <button
              type="button"
              className="te-play-btn primary"
              onClick={togglePlay}
              disabled={!monitorUrl}
              aria-label={playing ? t("editor.pause") : t("editor.play")}
              title={playing ? t("editor.pause") : t("editor.play")}
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <strong>{t("editor.timeline")}</strong>
            <span className="muted te-clock-inline">
              {fmtClock(playhead)} / {fmtClock(totalSec)}
            </span>
          </div>
          <div className="te-timeline-actions">
            <span className="muted">
              {t("editor.timelineMeta", {
                takes: segments.length,
                sec: Math.round(totalSec),
                scenes: scenes.length,
              })}
            </span>
            <div className="te-zoom-ctrl" title={t("editor.zoomWheelHint")}>
              <button
                type="button"
                aria-label={t("editor.zoomOut")}
                onClick={() => applyZoom(zoomRef.current / 1.15)}
              >
                −
              </button>
              <span className="te-zoom-pct">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                aria-label={t("editor.zoomIn")}
                onClick={() => applyZoom(zoomRef.current * 1.15)}
              >
                +
              </button>
            </div>
            <label className={`te-file-btn ${busy ? "is-disabled" : ""}`}>
              <span>{t("editor.addAudio")}</span>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                multiple
                disabled={busy}
                className="te-file-input"
                onChange={(e) => {
                  const files = takeSelectedFiles(e.currentTarget);
                  if (files.length) void onAudioFiles(files);
                }}
              />
            </label>
          </div>
        </div>

        <div
          className="te-overview"
          title={t("editor.overviewHint")}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
            const time = ratio * totalSecRef.current;
            setPlayheadUI(time);
            const seg =
              segments.find((s) => time >= s.start && time < s.end) || segments[segments.length - 1];
            if (seg) {
              setSelectedTake(seg.n);
              setSelectedAudioId(null);
            }
            const sc = scrollRef.current;
            if (sc) {
              const center = time * pxPerSecRef.current;
              sc.scrollLeft = Math.max(0, center - sc.clientWidth / 2);
            }
            seekVideoToTimeline(time);
            syncAudioToPlayhead(time, !videoRef.current?.paused);
          }}
        >
          <div className="te-overview-track">
            {segments.map((seg, i) => {
              const hue = sessionHue(seg.session, i);
              const left = (seg.start / totalSec) * 100;
              const width = (seg.duration / totalSec) * 100;
              return (
                <i
                  key={seg.n}
                  className={`te-overview-clip ${mutedSet.has(seg.n) ? "is-muted" : ""} ${
                    activeSeg?.n === seg.n ? "is-active" : ""
                  }`}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(0.8, width)}%`,
                    "--te-hue": hue,
                  }}
                />
              );
            })}
            {audioClips.map((clip) => {
              const start = Math.max(0, Number(clip.offset_sec) || 0);
              const dur = Number(clip.duration_sec);
              const widthSec = Number.isFinite(dur) && dur > 0 ? dur : Math.max(4, totalSec * 0.2);
              return (
                <i
                  key={`ov-${clip.id}`}
                  className="te-overview-audio"
                  style={{
                    left: `${(start / totalSec) * 100}%`,
                    width: `${Math.max(0.6, (widthSec / totalSec) * 100)}%`,
                  }}
                />
              );
            })}
            <i
              className="te-overview-playhead"
              style={{ left: `${(playhead / totalSec) * 100}%` }}
            />
          </div>
          <span className="te-overview-clock">
            {fmtClock(playhead)} · {fmtClock(totalSec)}
          </span>
        </div>

        {selectedAudio ? (
          <div className="te-audio-toolbar">
            <strong className="te-audio-toolbar-name" title={selectedAudio.label}>
              {selectedAudio.label || selectedAudio.id}
            </strong>
            <label className="te-vol">
              <span>{t("editor.audioVolume")}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={selectedAudio.volume ?? 0.7}
                onChange={(e) => {
                  const volume = Number(e.target.value);
                  setMix((m) => ({
                    ...m,
                    audio_clips: listAudioClips(m).map((c) =>
                      c.id === selectedAudio.id ? { ...c, volume } : c
                    ),
                  }));
                  const el = audioElsRef.current.get(selectedAudio.id);
                  if (el) el.volume = volume;
                }}
                onMouseUp={(e) =>
                  patchAudioClip(selectedAudio.id, { volume: Number(e.target.value) })
                }
                onTouchEnd={(e) =>
                  patchAudioClip(selectedAudio.id, { volume: Number(e.target.value) })
                }
              />
            </label>
            <label className="te-vol">
              <span>{t("editor.audioOffset")}</span>
              <input
                type="number"
                step="0.1"
                value={selectedAudio.offset_sec ?? 0}
                onChange={(e) => {
                  const offset_sec = Number(e.target.value) || 0;
                  setMix((m) => ({
                    ...m,
                    audio_clips: listAudioClips(m).map((c) =>
                      c.id === selectedAudio.id ? { ...c, offset_sec } : c
                    ),
                  }));
                }}
                onBlur={(e) =>
                  patchAudioClip(selectedAudio.id, {
                    offset_sec: Number(e.target.value) || 0,
                  })
                }
              />
            </label>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => removeAudioClip(selectedAudio.id)}
            >
              {t("editor.removeAudio")}
            </button>
          </div>
        ) : null}

        <div className="te-tracks">
          <div className="te-track-labels" aria-hidden>
            <div className="te-track-label te-label-spacer" />
            <div className="te-track-label">V1</div>
            {audioTracks.map((tr) => (
              <div key={`lbl-a${tr}`} className="te-track-label">
                A{tr + 1}
              </div>
            ))}
          </div>
          <div
            className="te-tracks-scroll"
            ref={scrollRef}
            onClick={(e) => seekTimeline(e.clientX)}
          >
            <div
              className="te-canvas"
              ref={canvasRef}
              style={{ width: trackWidth }}
            >
              <div className="te-ruler">
                {Array.from({ length: Math.floor(totalSec) + 1 }, (_, i) => (
                  <span
                    key={i}
                    className={`te-ruler-tick ${i % 5 === 0 ? "is-major" : ""}`}
                    style={{ transform: `translateX(${i * pxPerSec}px)` }}
                  >
                    {i % 5 === 0 ? fmtClock(i).slice(0, 5) : ""}
                  </span>
                ))}
              </div>

              <div className="te-track-lane te-lane-video">
                {scenes.map((scene, si) => {
                  const hue = sessionHue(scene.session, si);
                  return scene.items.map((tk) => {
                    const seg = segments.find((s) => s.n === Number(tk.n));
                    if (!seg) return null;
                    const meta = byEditor.get(seg.n);
                    const selectedCls = selected?.n === seg.n ? "is-selected" : "";
                    const muted = mutedSet.has(seg.n);
                    const active = activeSeg?.n === seg.n;
                    return (
                      <div
                        key={seg.n}
                        className={`te-clip-block ${selectedCls} ${muted ? "is-muted" : ""} ${
                          active ? "is-active" : ""
                        } ${seg.kind === "continue" ? "is-continue" : ""}`}
                        style={{
                          transform: `translateX(${seg.start * pxPerSec}px)`,
                          width: Math.max(36, seg.duration * pxPerSec - 2),
                          "--te-hue": hue,
                        }}
                      >
                        <button type="button" className="te-clip-select"
                          onClick={(e) => { e.stopPropagation(); selectTake(seg.n); }}
                          title={`${t("project.takeLabel", { n: seg.n })} · ${seg.duration}s`}>
                        <span className="te-clip-n">t{String(seg.n).padStart(2, "0")}</span>
                        <span className="te-clip-kind">
                          {seg.kind === "continue" ? "CONT" : "NEW"}
                        </span>
                        {!meta?.has_clip ? <span className="te-clip-miss">·</span> : null}
                        </button>
                        <button
                          type="button"
                          className="te-mute-btn"
                          title={muted ? t("editor.unmute") : t("editor.mute")}
                          aria-label={`${muted ? t("editor.unmute") : t("editor.mute")} · ${t("project.takeLabel", { n: seg.n })}`}
                          aria-pressed={muted}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleMuteTake(seg.n);
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                            {muted ? <path d="m16 9 5 6m0-6-5 6" /> : <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />}
                          </svg>
                        </button>
                      </div>
                    );
                  });
                })}
              </div>

              {audioTracks.map((tr) => {
                const clipsOnTrack = audioClips.filter((c) => (Number(c.track) || 0) === tr);
                return (
                  <div key={`lane-a${tr}`} className="te-track-lane te-lane-audio">
                    {clipsOnTrack.length ? (
                      clipsOnTrack.map((clip) => {
                        const dur = Number(clip.duration_sec);
                        const widthSec = Number.isFinite(dur) && dur > 0 ? dur : Math.max(8, totalSec * 0.35);
                        const selectedCls = selectedAudioId === clip.id ? "is-selected" : "";
                        return (
                          <button
                            key={clip.id}
                            type="button"
                            className={`te-audio-block ${selectedCls}`}
                            style={{
                              transform: `translateX(${Math.max(0, (Number(clip.offset_sec) || 0) * pxPerSec)}px)`,
                              width: Math.max(56, widthSec * pxPerSec),
                            }}
                            title={clip.label || clip.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAudioId(clip.id);
                              setSelectedTake(null);
                            }}
                          >
                            <span className="te-audio-block-label">{clip.label || clip.id}</span>
                            <span className="muted">
                              {Math.round((Number(clip.volume) ?? 0.7) * 100)}%
                            </span>
                          </button>
                        );
                      })
                    ) : tr === 0 ? (
                      <div className="te-audio-empty muted">{t("editor.audioEmpty")}</div>
                    ) : null}
                  </div>
                );
              })}

              <div className="te-playhead" ref={playheadElRef} />
            </div>
          </div>
        </div>
      </div>

      {audioClips.map((clip) => (
        <audio
          key={clip.id}
          ref={(el) => bindAudioEl(clip.id, el)}
          src={`${clip.url}?v=${encodeURIComponent(clip.file || clip.id)}`}
          preload="auto"
          onLoadedMetadata={(e) => onAudioMeta(clip.id, e.currentTarget)}
        />
      ))}
    </div>
  );
}
