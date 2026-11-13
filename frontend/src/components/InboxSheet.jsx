import React from "react";
import { api } from "../api.js";
import { useConfirm } from "./ConfirmDialog.jsx";
import { useT } from "../i18n/index.jsx";

export default function InboxSheet({ inbox, busy, setBusy, setToast, onClose, onRefresh }) {
  const t = useT();
  const confirm = useConfirm();
  const pending = inbox?.pending || [];

  async function refreshInbox() {
    onRefresh?.();
  }

  async function approveOne(name) {
    setBusy(true);
    try {
      const r = await api.inboxApprove(name);
      const proj = r?.result?.project;
      if (r?.result?.skipped) {
        setToast(t("inbox.alreadyExists", { name }));
      } else if (r?.result?.ok === false) {
        setToast(t("inbox.failed", { error: r.result.error || name }));
      } else {
        setToast(t("inbox.approvedOne", { title: proj?.title || name }));
      }
      await refreshInbox();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function rejectOne(name) {
    const ok = await confirm({
      title: t("inbox.rejectTitle"),
      message: t("inbox.rejectMsgPack", { name }),
      confirmLabel: t("common.reject"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.inboxReject(name);
      setToast(t("inbox.rejectedOne", { name }));
      await refreshInbox();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function approveAll() {
    if (!pending.length) return;
    const ok = await confirm({
      title: t("inbox.approveAllTitle"),
      message: t("inbox.approveAllMsg", { n: pending.length }),
      confirmLabel: t("inbox.approveAll"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.inboxScan();
      const n = (r.results || []).filter((x) => x.ok && !x.skipped).length;
      setToast(n ? t("inbox.approvedCount", { n }) : t("inbox.nothingImported"));
      await refreshInbox();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet wide" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{t("inbox.title")}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        <div className="sheet-body stack">
          <p className="muted" style={{ margin: 0 }}>
            {t("inbox.helper")}
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Spec: <code>AI_STORY_INBOX.md</code> ·{" "}
            <code>{inbox?.inbox_dir || "data/inbox"}</code>
          </p>

          <h3 style={{ margin: 0, fontSize: 14 }}>
            {t("inbox.waitingTitle")}{" "}
            <span className="muted">· {pending.length}</span>
          </h3>

          {pending.length === 0 ? (
            <p className="muted">{t("inbox.emptyPending")}</p>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {pending.map((p) => (
                <div key={p.name} className="inbox-card">
                  <div className="inbox-card-main">
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      <strong style={{ fontSize: 14 }}>{p.title || p.name}</strong>
                      {p.model_pack ? (
                        <span className={`badge ${p.model_pack === "nsfw" ? "warn" : ""}`}>
                          {String(p.model_pack).toUpperCase()}
                        </span>
                      ) : null}
                      {!p.ready ? <span className="badge warn">{t("inbox.incomplete")}</span> : null}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      <code>{p.name}</code>
                      {p.slug ? ` · ${p.slug}` : ""}
                      {p.takes_count ? ` · ${p.takes_count} takes` : ""}
                      {p.has_roteiro ? t("inbox.tagRoteiro") : ""}
                      {p.has_meta ? t("inbox.tagMeta") : ""}
                    </div>
                    {p.brief ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {p.brief}
                      </div>
                    ) : null}
                    {p.error ? (
                      <div className="alert bad" style={{ margin: 0, padding: "6px 10px", fontSize: 12 }}>
                        {p.error}
                      </div>
                    ) : null}
                  </div>
                  <div className="inbox-card-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || !p.ready}
                      onClick={() => approveOne(p.name)}
                    >
                      {t("inbox.approve")}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() => rejectOne(p.name)}
                    >
                      {t("inbox.reject")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="muted" style={{ fontSize: 12 }}>
            {t("inbox.processedLine", { n: inbox?.processed_count ?? 0 })}
          </p>
        </div>
        <div className="sheet-foot" style={{ gap: 8 }}>
          <button type="button" disabled={busy} onClick={refreshInbox}>
            {t("inbox.refreshList")}
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || pending.length === 0}
            onClick={approveAll}
          >
            {t("inbox.approveAll")}
          </button>
        </div>
      </div>
    </div>
  );
}
