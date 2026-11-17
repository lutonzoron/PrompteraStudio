import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { beep, notify } from "./utils.js";
import Shell from "./components/Shell.jsx";
import Library from "./components/Library.jsx";
import ProjectPage from "./components/ProjectPage.jsx";
import TakeEditor from "./components/TakeEditor.jsx";
import CreateSheet from "./components/CreateSheet.jsx";
import QueueDock from "./components/QueueDock.jsx";
import QueueBoard from "./components/QueueBoard.jsx";
import ReviewModal from "./components/ReviewModal.jsx";
import Settings from "./components/Settings.jsx";
import StyleGallery from "./components/StyleGallery.jsx";
import InboxSheet from "./components/InboxSheet.jsx";
import LogsPanel from "./components/LogsPanel.jsx";
import ActionFeedback from "./components/ActionFeedback.jsx";
import { ConfirmProvider } from "./components/ConfirmDialog.jsx";
import { useT } from "./i18n/index.jsx";

function readHashProjectId() {
  const m = String(window.location.hash || "").match(/^#\/p\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function readHashPage() {
  const hash = String(window.location.hash || "");
  if (hash === "#/logs") return "logs";
  if (hash === "#/queue") return "queue";
  if (hash === "#/styles") return "styles";
  if (/^#\/p\/[^/]+\/editor\/?$/.test(hash)) return "editor";
  if (hash.startsWith("#/p/")) return "studio";
  return "studio";
}

export default function App() {
  const t = useT();
  const [health, setHealth] = useState(null);
  const [queue, setQueue] = useState(null);
  const [projects, setProjects] = useState([]);
  const [styles, setStyles] = useState([]);
  const [selectedId, setSelectedId] = useState(() => readHashProjectId());
  const [project, setProject] = useState(null);
  const [toast, setToast] = useState(null);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [sheet, setSheet] = useState(null); // create | settings | inbox
  const [page, setPage] = useState(() => readHashPage());
  const [inbox, setInbox] = useState(null);
  const esRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const openProjectRef = useRef(null);
  const refreshRef = useRef(null);
  const tRef = useRef(t);
  selectedIdRef.current = selectedId;
  tRef.current = t;

  const pendingReviews = queue?.pending_reviews?.length || 0;
  const queueCount = (queue?.items?.length || 0) + (queue?.pending_reviews?.length || 0);

  const applyProject = useCallback((p) => {
    if (!p?.id) return;
    // Ignore stale responses from a previous selection.
    if (selectedIdRef.current && p.id !== selectedIdRef.current) return;
    setProject(p);
  }, []);

  const goHome = useCallback(() => {
    setSheet(null);
    setPage("studio");
    setSelectedId(null);
    setProject(null);
    if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const openStyles = useCallback(() => {
    setSheet(null);
    setPage("styles");
    setSelectedId(null);
    setProject(null);
    window.location.hash = "#/styles";
  }, []);

  const openQueue = useCallback(() => {
    setSheet(null);
    setPage("queue");
    setSelectedId(null);
    setProject(null);
    window.location.hash = "#/queue";
  }, []);

  const openProject = useCallback((id) => {
    if (!id) {
      goHome();
      return;
    }
    setSheet(null);
    setPage("studio");
    // Drop previous project immediately so a late fetch cannot paint the wrong video.
    setProject((prev) => (prev?.id === id ? prev : null));
    setSelectedId(id);
    const nextHash = `#/p/${id}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [goHome]);
  openProjectRef.current = openProject;

  const openEditor = useCallback((id) => {
    if (!id) return;
    setSheet(null);
    setPage("editor");
    setProject((prev) => (prev?.id === id ? prev : null));
    setSelectedId(id);
    const nextHash = `#/p/${id}/editor`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [h, q, p, s, ib] = await Promise.all([
        api.health(),
        api.queue(),
        api.projects(showArchived),
        api.styles(),
        api.inbox().catch(() => null),
      ]);
      setHealth(h);
      setQueue(q);
      setProjects(p);
      setStyles(s);
      if (ib) setInbox(ib);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    }
  }, [showArchived]);
  refreshRef.current = refresh;

  useEffect(() => {
    refresh();
    const tick = setInterval(() => refreshRef.current?.(), 8000);
    return () => clearInterval(tick);
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setProject(null);
      return;
    }
    let cancelled = false;
    api
      .project(selectedId)
      .then((p) => {
        if (!cancelled) applyProject(p);
      })
      .catch(() => {
        if (!cancelled) setToast(tRef.current("app.projectMissing"));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, applyProject]);

  useEffect(() => {
    const onHash = () => {
      const id = readHashProjectId();
      const nextPage = readHashPage();
      setSelectedId((prev) => (prev === id ? prev : id));
      setPage((prev) => (prev === nextPage ? prev : nextPage));
      if (id) {
        setProject((prev) => (prev?.id === id ? prev : null));
      } else if (nextPage === "studio") {
        setProject(null);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/events");
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const tt = tRef.current;
        const refreshNow = () => refreshRef.current?.();
        if (data.type === "review_needed") {
          setReview(data);
          beep();
          notify(
            tt("review.notifyTitle"),
            tt("review.notifyBody", {
              take: data.take,
              total: data.total,
              title: data.title || "",
            })
          );
          setToast(tt("review.waitingToast", { take: data.take }));
          refreshNow();
        }
        if (
          [
            "job_done",
            "job_failed",
            "job_progress",
            "job_queued",
            "job_started",
            "job_preempted",
            "inbox_imported",
            "external_sync",
            "project_updated",
            "queue_changed",
            "comfy_queue",
          ].includes(data.type)
        ) {
          refreshNow();
          if (data.type === "job_done") {
            setToast(tt("app.jobDone"));
            if (data.project_id) openProjectRef.current?.(data.project_id);
          }
          if (data.type === "job_failed") setToast(tt("app.jobFailed", { error: data.error }));
          if (data.type === "inbox_imported")
            setToast(tt("inbox.approved", { title: data.title || "" }));
          if (data.type === "inbox_pending") {
            const n = data.count || (data.names || []).length;
            setToast(n ? tt("inbox.pendingToast", { n }) : tt("inbox.updated"));
            beep();
            notify(tt("inbox.notifyTitle"), tt("inbox.notifyBody", { n }));
            api.inbox().then(setInbox).catch(() => {});
          }
          if (data.type === "inbox_changed" || data.type === "inbox_rejected") {
            api.inbox().then(setInbox).catch(() => {});
          }
          if (
            [
              "external_sync",
              "project_updated",
              "job_progress",
              "job_started",
              "job_queued",
              "job_done",
              "job_failed",
              "job_preempted",
            ].includes(data.type) &&
            data.project_id &&
            selectedIdRef.current === data.project_id
          ) {
            api.project(data.project_id).then(applyProject).catch(() => {});
          }
        }
        if (data.type === "review_submitted") {
          setReview(null);
          refreshNow();
        }
      } catch {
        /* ignore malformed SSE */
      }
    };
    return () => es.close();
  }, [applyProject]);

  useEffect(() => {
    if (!toast) return;
    const tick = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(tick);
  }, [toast]);

  useEffect(() => {
    const pending = queue?.pending_reviews?.[0];
    if (pending && !review) {
      setReview({
        project_id: pending.id,
        take: pending.review_take,
        total: (pending.takes || []).length,
        full_path: pending.review_full_path,
        current_path: pending.review_current_path,
        title: pending.title,
      });
    }
  }, [queue, review]);

  return (
    <ConfirmProvider>
      <Shell
        health={health}
        pendingReviews={pendingReviews}
        activeNav={page === "editor" ? "studio" : page}
        onHome={goHome}
        onCreate={() => setSheet("create")}
        onOpenSettings={() => setSheet("settings")}
        onOpenStyles={openStyles}
        onOpenLogs={() => {
          setSheet(null);
          setSelectedId(null);
          setProject(null);
          setPage("logs");
          window.location.hash = "#/logs";
        }}
        onOpenQueue={openQueue}
        onOpenInbox={() => setSheet("inbox")}
        onComfyStart={() => api.comfyStart().then(refresh)}
        inboxPending={inbox?.pending_count || inbox?.pending?.length || 0}
        queueCount={queueCount}
      >
        {error ? (
          <div className="alert bad" style={{ marginBottom: 14 }}>
            {error}
          </div>
        ) : null}
        {!health?.onboarding?.complete ? (
          <div className="alert warn" style={{ marginBottom: 14 }}>
            {t("app.setupWarn")}{" "}
            <button type="button" className="ghost" onClick={() => setSheet("settings")}>
              {t("app.openSettings")}
            </button>
          </div>
        ) : null}

        {page === "logs" ? (
          <LogsPanel />
        ) : page === "queue" ? (
          <div className="queue-page">
            <header className="queue-page-head">
              <div>
                <h1>{t("nav.queue")}</h1>
                <p className="muted">{t("queueBoard.pageHint")}</p>
              </div>
            </header>
            <QueueBoard
              queue={queue}
              prioritizeAvailable={!!health?.features?.prioritize}
              onRefresh={refresh}
              setToast={setToast}
              onOpenProject={openProject}
              onOpenReview={setReview}
            />
          </div>
        ) : page === "styles" ? (
          <StyleGallery
            styles={styles}
            busy={busy}
            setBusy={setBusy}
            setToast={setToast}
            onChange={refresh}
          />
        ) : page === "editor" && selectedId && project?.id === selectedId ? (
          <TakeEditor
            project={project}
            setProject={setProject}
            busy={busy}
            setBusy={setBusy}
            setToast={setToast}
            onRefresh={refresh}
            onBack={() => openProject(selectedId)}
          />
        ) : selectedId && project?.id === selectedId ? (
          <ProjectPage
            footageAvailable={!!health?.features?.footage}
            project={project}
            setProject={setProject}
            busy={busy}
            setBusy={setBusy}
            setToast={setToast}
            onRefresh={refresh}
            onBack={goHome}
            onOpenEditor={() => openEditor(selectedId)}
          />
        ) : selectedId ? (
          <div className="empty-hero">
            <p className="muted">{t("app.loadingProject")}</p>
          </div>
        ) : (
          <Library
            regenerateAvailable={!!health?.features?.regenerate}
            projects={projects}
            selectedId={null}
            showArchived={showArchived}
            setShowArchived={setShowArchived}
            onSelect={openProject}
            onCreate={() => setSheet("create")}
            onRefresh={refresh}
            onOpenQueue={openQueue}
            setToast={setToast}
          />
        )}
      </Shell>

      <QueueDock
        prioritizeAvailable={!!health?.features?.prioritize}
        queue={queue}
        onOpenReview={setReview}
        onRefresh={refresh}
        setToast={setToast}
        onOpenProject={openProject}
      />

      {sheet === "create" ? (
        <CreateSheet
          footageAvailable={!!health?.features?.footage}
          styles={styles}
          busy={busy}
          setBusy={setBusy}
          setToast={setToast}
          onClose={() => setSheet(null)}
          onCreated={async (p) => {
            setSheet(null);
            await refresh();
            await openProject(p.id);
          }}
        />
      ) : null}

      {sheet === "settings" ? (
        <Settings
          health={health}
          onClose={() => setSheet(null)}
          onDone={refresh}
          setToast={setToast}
          onOpenStyles={openStyles}
        />
      ) : null}

      {sheet === "inbox" ? (
        <InboxSheet
          inbox={inbox}
          busy={busy}
          setBusy={setBusy}
          setToast={setToast}
          onClose={() => setSheet(null)}
          onRefresh={async () => {
            await refresh();
            try {
              setInbox(await api.inbox());
            } catch {}
          }}
        />
      ) : null}

      {review ? (
        <ReviewModal
          review={review}
          onDone={() => {
            setReview(null);
            refresh();
          }}
          setToast={setToast}
        />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
      <ActionFeedback />
    </ConfirmProvider>
  );
}
