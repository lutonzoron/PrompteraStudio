import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { beep, notify } from "./utils.js";
import Shell from "./components/Shell.jsx";
import Library from "./components/Library.jsx";
import ProjectPage from "./components/ProjectPage.jsx";
import CreateSheet from "./components/CreateSheet.jsx";
import QueueDock from "./components/QueueDock.jsx";
import ReviewModal from "./components/ReviewModal.jsx";
import Settings from "./components/Settings.jsx";
import StyleGallery from "./components/StyleGallery.jsx";
import InboxSheet from "./components/InboxSheet.jsx";

function readHashProjectId() {
  const m = String(window.location.hash || "").match(/^#\/p\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function App() {
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
  const [page, setPage] = useState("studio"); // studio | styles
  const [inbox, setInbox] = useState(null);
  const esRef = useRef(null);

  const pendingReviews = queue?.pending_reviews?.length || 0;

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
    if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const openProject = useCallback(async (id) => {
    if (!id) {
      goHome();
      return;
    }
    setPage("studio");
    setSelectedId(id);
    window.location.hash = `#/p/${id}`;
    const p = await api.project(id);
    setProject(p);
  }, [goHome]);

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

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setProject(null);
      return;
    }
    api.project(selectedId).then(setProject).catch(() => setToast("Projeto não encontrado"));
  }, [selectedId]);

  useEffect(() => {
    const onHash = () => {
      const id = readHashProjectId();
      setSelectedId(id);
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
        if (data.type === "review_needed") {
          setReview(data);
          beep();
          notify("Revisão de take", `Take ${data.take}/${data.total} — ${data.title || ""}`);
          setToast(`Take ${data.take} aguardando`);
          refresh();
        }
        if (
          [
            "job_done",
            "job_failed",
            "job_progress",
            "job_queued",
            "job_started",
            "inbox_imported",
            "external_sync",
            "project_updated",
            "queue_changed",
            "comfy_queue",
          ].includes(data.type)
        ) {
          refresh();
          if (data.type === "job_done") {
            setToast("Geração concluída — abra o projeto para ver o master");
            if (data.project_id) openProject(data.project_id);
          }
          if (data.type === "job_failed") setToast(`Falhou: ${data.error}`);
          if (data.type === "inbox_imported")
            setToast(`Nova história importada: ${data.title || ""}`);
          if (
            (data.type === "external_sync" || data.type === "project_updated") &&
            data.project_id &&
            selectedId === data.project_id
          ) {
            api.project(data.project_id).then(setProject).catch(() => {});
          }
        }
        if (data.type === "review_submitted") {
          setReview(null);
          refresh();
        }
      } catch {}
    };
    return () => es.close();
  }, [refresh, openProject, selectedId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
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
    <>
      <Shell
        health={health}
        pendingReviews={pendingReviews}
        activeNav={page === "styles" ? "styles" : "studio"}
        onHome={goHome}
        onCreate={() => setSheet("create")}
        onOpenSettings={() => setSheet("settings")}
        onOpenStyles={openStyles}
        onOpenInbox={() => setSheet("inbox")}
        onComfyStart={() => api.comfyStart().then(refresh)}
      >
        {error ? (
          <div className="alert bad" style={{ marginBottom: 14 }}>
            {error}
          </div>
        ) : null}
        {!health?.onboarding?.complete ? (
          <div className="alert warn" style={{ marginBottom: 14 }}>
            Configure a API de IA para gerar roteiros no app.{" "}
            <button type="button" className="ghost" onClick={() => setSheet("settings")}>
              Abrir config
            </button>
          </div>
        ) : null}

        {page === "styles" ? (
          <StyleGallery
            styles={styles}
            busy={busy}
            setBusy={setBusy}
            setToast={setToast}
            onChange={refresh}
          />
        ) : project && selectedId ? (
          <ProjectPage
            project={project}
            setProject={setProject}
            busy={busy}
            setBusy={setBusy}
            setToast={setToast}
            onRefresh={refresh}
            onBack={goHome}
          />
        ) : (
          <Library
            projects={projects}
            selectedId={null}
            showArchived={showArchived}
            setShowArchived={setShowArchived}
            onSelect={openProject}
            onCreate={() => setSheet("create")}
            onRefresh={refresh}
            setToast={setToast}
          />
        )}
      </Shell>

      <QueueDock
        queue={queue}
        onOpenReview={setReview}
        onRefresh={refresh}
        setToast={setToast}
        onOpenProject={openProject}
      />

      {sheet === "create" ? (
        <CreateSheet
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
    </>
  );
}
