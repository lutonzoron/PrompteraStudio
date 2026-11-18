import React, { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";

const RATES = [0.5, 1, 1.5, 2];
const HIDE_MS = 2400;

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isFullscreenElement(el) {
  const doc = document;
  return (
    doc.fullscreenElement === el ||
    doc.webkitFullscreenElement === el ||
    doc.msFullscreenElement === el
  );
}

export default function MediaPlayer({
  src,
  poster,
  autoPlay = false,
  playsInline = true,
  preload = "metadata",
  className = "",
  videoClassName = "",
  ariaLabel,
  onError,
}) {
  const t = useT();
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const hideTimer = useRef(null);
  const wasPlaying = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [rateOpen, setRateOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [buffered, setBuffered] = useState(0);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused && !scrubbing && !rateOpen) setChromeVisible(false);
    }, HIDE_MS);
  }, [clearHideTimer, scrubbing, rateOpen]);

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;

    const onPlay = () => {
      setPlaying(true);
      scheduleHide();
    };
    const onPause = () => {
      setPlaying(false);
      setChromeVisible(true);
      clearHideTimer();
    };
    const syncBuffered = () => {
      try {
        if (!v.duration || !v.buffered?.length) {
          setBuffered(0);
          return;
        }
        let end = 0;
        for (let i = 0; i < v.buffered.length; i += 1) {
          end = Math.max(end, v.buffered.end(i));
        }
        setBuffered(Math.min(100, (end / v.duration) * 100));
      } catch {
        setBuffered(0);
      }
    };
    const onTime = () => {
      if (!scrubbing) setCurrent(v.currentTime || 0);
      syncBuffered();
    };
    const onMeta = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
      syncBuffered();
    };
    const onVol = () => {
      setMuted(v.muted);
      setVolume(v.volume);
    };
    const onRate = () => setRate(v.playbackRate || 1);
    const onEnded = () => {
      setPlaying(false);
      setChromeVisible(true);
      clearHideTimer();
    };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("progress", syncBuffered);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("durationchange", onMeta);
    v.addEventListener("volumechange", onVol);
    v.addEventListener("ratechange", onRate);
    v.addEventListener("ended", onEnded);

    setMuted(v.muted);
    setVolume(v.volume);
    setRate(v.playbackRate || 1);
    if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
    syncBuffered();

    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("progress", syncBuffered);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("durationchange", onMeta);
      v.removeEventListener("volumechange", onVol);
      v.removeEventListener("ratechange", onRate);
      v.removeEventListener("ended", onEnded);
    };
  }, [src, scrubbing, scheduleHide, clearHideTimer]);

  useEffect(() => {
    const onFs = () => {
      const root = rootRef.current;
      setFullscreen(root ? isFullscreenElement(root) : false);
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, []);

  useEffect(() => {
    if (!rateOpen) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setRateOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [rateOpen]);

  const togglePlay = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    showChrome();
    try {
      if (v.paused) await v.play();
      else v.pause();
    } catch {
      /* autoplay / play() rejection */
    }
  }, [showChrome]);

  const seekTo = useCallback(
    (next) => {
      const v = videoRef.current;
      if (!v) return;
      const dur = Number.isFinite(v.duration) ? v.duration : duration;
      const clamped = Math.max(0, Math.min(dur || 0, next));
      v.currentTime = clamped;
      setCurrent(clamped);
    },
    [duration]
  );

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    showChrome();
    if (v.muted || v.volume === 0) {
      v.muted = false;
      if (v.volume === 0) v.volume = volume > 0 ? volume : 1;
    } else {
      v.muted = true;
    }
  }, [showChrome, volume]);

  const setVol = useCallback(
    (next) => {
      const v = videoRef.current;
      if (!v) return;
      showChrome();
      const value = Math.max(0, Math.min(1, next));
      v.volume = value;
      v.muted = value === 0;
    },
    [showChrome]
  );

  const setPlaybackRate = useCallback(
    (next) => {
      const v = videoRef.current;
      if (!v) return;
      showChrome();
      v.playbackRate = next;
      setRate(next);
      setRateOpen(false);
    },
    [showChrome]
  );

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    showChrome();
    try {
      if (isFullscreenElement(root)) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else if (root.requestFullscreen) {
        await root.requestFullscreen();
      } else if (root.webkitRequestFullscreen) {
        root.webkitRequestFullscreen();
      }
    } catch {
      /* fullscreen denied */
    }
  }, [showChrome]);

  const onKeyDown = useCallback(
    (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, select, textarea, button.mp-rate-btn")) {
        if (e.key !== "Escape") return;
      }
      const v = videoRef.current;
      if (!v) return;
      let handled = true;
      switch (e.key) {
        case " ":
        case "k":
        case "K":
          togglePlay();
          break;
        case "ArrowLeft":
          seekTo((v.currentTime || 0) - 5);
          break;
        case "ArrowRight":
          seekTo((v.currentTime || 0) + 5);
          break;
        case "ArrowUp":
          setVol((v.muted ? 0 : v.volume) + 0.05);
          break;
        case "ArrowDown":
          setVol((v.muted ? 0 : v.volume) - 0.05);
          break;
        case "m":
        case "M":
          toggleMute();
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "Escape":
          setRateOpen(false);
          handled = rateOpen;
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        showChrome();
      }
    },
    [togglePlay, seekTo, setVol, toggleMute, toggleFullscreen, showChrome, rateOpen]
  );

  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const volShown = muted ? 0 : volume;

  return (
    <div
      ref={rootRef}
      className={`mp-root${chromeVisible ? " is-chrome" : ""}${fullscreen ? " is-fullscreen" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--mp-volume": `${volShown * 100}%` }}
      tabIndex={0}
      role="region"
      aria-label={ariaLabel || t("player.label")}
      onMouseMove={showChrome}
      onMouseLeave={() => {
        if (playing && !scrubbing && !rateOpen) {
          clearHideTimer();
          setChromeVisible(false);
        }
      }}
      onFocus={showChrome}
      onPointerDown={showChrome}
      onKeyDown={onKeyDown}
    >
      <video
        ref={videoRef}
        className={`mp-video${videoClassName ? ` ${videoClassName}` : ""}`}
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        playsInline={playsInline}
        preload={preload}
        onClick={togglePlay}
        onError={onError}
      />

      <div
        className={`mp-chrome${chromeVisible ? " is-visible" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`mp-progress-row${scrubbing ? " is-scrubbing" : ""}`}>
          <div
            className="mp-progress-shell"
            style={{ "--mp-progress": `${progress}%`, "--mp-buffered": `${buffered}%` }}
          >
            <div className="mp-progress-rail" aria-hidden="true">
              <div className="mp-progress-buffered" />
              <div className="mp-progress-played" />
              <div className="mp-progress-knob" />
            </div>
            <input
              type="range"
              className="mp-progress"
              min={0}
              max={duration || 0}
              step="any"
              value={duration ? current : 0}
              aria-label={t("player.seek")}
              disabled={!duration}
              onPointerDown={(e) => {
                setScrubbing(true);
                wasPlaying.current = videoRef.current ? !videoRef.current.paused : false;
                videoRef.current?.pause();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                showChrome();
              }}
              onPointerUp={(e) => {
                setScrubbing(false);
                try {
                  e.currentTarget.releasePointerCapture?.(e.pointerId);
                } catch {
                  /* already released */
                }
                if (wasPlaying.current) videoRef.current?.play().catch(() => {});
                scheduleHide();
              }}
              onPointerCancel={() => {
                setScrubbing(false);
                if (wasPlaying.current) videoRef.current?.play().catch(() => {});
                scheduleHide();
              }}
              onChange={(e) => seekTo(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="mp-bar">
          <button
            type="button"
            className="mp-btn"
            onClick={togglePlay}
            aria-label={playing ? t("player.pause") : t("player.play")}
            title={playing ? t("player.pause") : t("player.play")}
          >
            {playing ? "❚❚" : "▶"}
          </button>

          <span className="mp-time" aria-hidden="true">
            {formatTime(current)} / {formatTime(duration)}
          </span>

          <div className="mp-spacer" />

          <div className="mp-volume">
            <button
              type="button"
              className="mp-btn"
              onClick={toggleMute}
              aria-label={muted || volume === 0 ? t("player.unmute") : t("player.mute")}
              title={muted || volume === 0 ? t("player.unmute") : t("player.mute")}
            >
              <svg className="mp-icon" viewBox="0 0 24 24" aria-hidden="true">
                {muted || volume === 0 ? (
                  <>
                    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
                    <path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                  </>
                ) : (
                  <>
                    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
                    <path d="M16 8.5a4 4 0 010 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                    {volume >= 0.45 && (
                      <path d="M18 6a7 7 0 010 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                    )}
                  </>
                )}
              </svg>
            </button>
            <input
              type="range"
              className="mp-volume-slider"
              min={0}
              max={1}
              step={0.01}
              value={volShown}
              aria-label={t("player.volume")}
              onChange={(e) => setVol(Number(e.target.value))}
            />
          </div>

          <div className="mp-rate">
            <button
              type="button"
              className="mp-btn mp-rate-btn"
              aria-label={t("player.rate")}
              aria-expanded={rateOpen}
              title={t("player.rate")}
              onClick={() => {
                setRateOpen((o) => !o);
                showChrome();
              }}
            >
              {rate === 1 ? "1×" : `${rate}×`}
            </button>
            {rateOpen && (
              <div className="mp-rate-menu" role="menu">
                {RATES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="menuitemradio"
                    aria-checked={rate === r}
                    className={rate === r ? "is-active" : ""}
                    onClick={() => setPlaybackRate(r)}
                  >
                    {r === 1 ? "1×" : `${r}×`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className="mp-btn"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? t("player.exitFullscreen") : t("player.fullscreen")}
            title={fullscreen ? t("player.exitFullscreen") : t("player.fullscreen")}
          >
            <svg className="mp-icon" viewBox="0 0 24 24" aria-hidden="true">
              {fullscreen ? (
                <path
                  d="M8 3v3H5v2h5V3H8zm6 0v5h5V6h-3V3h-2zM5 16h3v3h2v-5H5v2zm11 0v5h2v-3h3v-2h-5z"
                  fill="currentColor"
                />
              ) : (
                <path
                  d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z"
                  fill="currentColor"
                />
              )}
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
