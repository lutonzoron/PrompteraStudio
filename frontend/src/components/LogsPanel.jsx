import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useLocale, useT } from "../i18n/index.jsx";

export default function LogsPanel({ projectId = null, embedded = false }) {
  const t = useT();
  const { dateLocale } = useLocale();
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [olderBusy, setOlderBusy] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [follow, setFollow] = useState(true);
  const viewport = useRef(null);
  const active = useRef(0);

  useEffect(() => {
    const generation = ++active.current;
    let cancelled = false;
    let cursor = 0;
    let pending = false;
    let initialized = false;
    setItems([]);
    setLoading(true);
    setHasOlder(false);
    setFollow(true);
    async function poll() {
      if (pending) return;
      pending = true;
      try {
        const page = await api.logs({ projectId, after: cursor });
        if (cancelled) return;
        if (!initialized) setHasOlder(page.has_more);
        initialized = true;
        if (page.items.length) {
          cursor = page.items[page.items.length - 1].id;
          setItems((old) => [...old, ...page.items]);
        }
        setError("");
      } catch (e) {
        if (!cancelled) setError(String(e.message || e));
      } finally {
        pending = false;
        if (!cancelled) setLoading(false);
      }
    }
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      if (active.current === generation) active.current++;
      clearInterval(timer);
    };
  }, [projectId]);

  useEffect(() => {
    if (follow && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [items, follow]);

  async function loadOlder() {
    const generation = active.current;
    setOlderBusy(true);
    setFollow(false);
    try {
      const page = await api.logs({ projectId, before: items[0]?.id });
      if (generation !== active.current) return;
      setItems((old) => [...page.items, ...old]);
      setHasOlder(page.has_more);
      setError("");
    } catch (e) {
      if (generation === active.current) setError(String(e.message || e));
    } finally {
      if (generation === active.current) setOlderBusy(false);
    }
  }

  function line(item) {
    const date = new Date(item.created_at * 1000).toLocaleString(dateLocale, { hour12: false });
    return `[${date}] [${item.level.toUpperCase()}] [${item.source}]${!projectId && item.project_id ? ` [${item.project_title || item.project_id}]` : ""} ${item.message}`;
  }

  function download() {
    const blob = new Blob([items.map(line).join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `promptera-${projectId || "logs"}.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className={`logs-panel${embedded ? " is-embedded" : ""}`} aria-label={t(projectId ? "logs.videoTitle" : "logs.title")}>
      <div className="logs-heading">
        <div>
          {!embedded && <h2>{t(projectId ? "logs.videoTitle" : "logs.title")}</h2>}
          <p className="muted">{t("logs.hint")}</p>
        </div>
        <div className="logs-tools">
          <label className="logs-follow">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            {t("logs.follow")}
          </label>
          <button type="button" onClick={download} disabled={!items.length}>{t("logs.download")}</button>
        </div>
      </div>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {hasOlder && <button type="button" className="logs-older" onClick={loadOlder} disabled={olderBusy}>
        {t(olderBusy ? "logs.loading" : "logs.older")}
      </button>}
      <div className="logs-viewport" ref={viewport} role="region" tabIndex={0}
        aria-label={t("logs.entries")} aria-busy={loading}
        onScroll={() => {
          const el = viewport.current;
          if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 60) setFollow(false);
        }}>
        {items.map((item) => <div className={`log-line log-${item.level}`} key={item.id}>{line(item)}</div>)}
        {!items.length && <p className="muted">{t(loading ? "logs.loading" : "logs.empty")}</p>}
      </div>
      <p className="muted logs-count">{t("logs.count", { n: items.length })}</p>
    </section>
  );
}
