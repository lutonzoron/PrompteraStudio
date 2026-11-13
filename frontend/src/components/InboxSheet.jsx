import React from "react";
import { api } from "../api.js";

export default function InboxSheet({ inbox, busy, setBusy, setToast, onClose, onRefresh }) {
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
        setToast(`Já existia: ${name}`);
      } else if (r?.result?.ok === false) {
        setToast(`Falhou: ${r.result.error || name}`);
      } else {
        setToast(`Aprovado: ${proj?.title || name}`);
      }
      await refreshInbox();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function rejectOne(name) {
    if (!confirm(`Rejeitar “${name}”? O pack vai para _failed.`)) return;
    setBusy(true);
    try {
      await api.inboxReject(name);
      setToast(`Rejeitado: ${name}`);
      await refreshInbox();
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function approveAll() {
    if (!pending.length) return;
    if (!confirm(`Aprovar todos os ${pending.length} pack(s)?`)) return;
    setBusy(true);
    try {
      const r = await api.inboxScan();
      const n = (r.results || []).filter((x) => x.ok && !x.skipped).length;
      setToast(n ? `${n} aprovado(s)` : "Nada importado");
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
          <h2>Inbox · aprovação</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="sheet-body stack">
          <p className="muted" style={{ margin: 0 }}>
            Packs de Cursor / Claude / Copilot entram aqui e <strong>esperam aprovação</strong> —
            nada importa sozinho.
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Spec: <code>AI_STORY_INBOX.md</code> · pasta <code>{inbox?.inbox_dir || "data/inbox"}</code>
          </p>

          <h3 style={{ margin: 0, fontSize: 14 }}>
            Aguardando aprovação{" "}
            <span className="muted">· {pending.length}</span>
          </h3>

          {pending.length === 0 ? (
            <p className="muted">Vazio — peça à IA para gravar em data/inbox/&lt;slug&gt;/.</p>
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
                      {!p.ready ? <span className="badge warn">incompleto</span> : null}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      <code>{p.name}</code>
                      {p.slug ? ` · ${p.slug}` : ""}
                      {p.takes_count ? ` · ${p.takes_count} takes` : ""}
                      {p.has_roteiro ? " · roteiro" : ""}
                      {p.has_meta ? " · meta" : ""}
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
                      Aprovar
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() => rejectOne(p.name)}
                    >
                      Rejeitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="muted" style={{ fontSize: 12 }}>
            {inbox?.processed_count ?? 0} processados · rejeitados em _failed/
          </p>
        </div>
        <div className="sheet-foot" style={{ gap: 8 }}>
          <button type="button" disabled={busy} onClick={refreshInbox}>
            Atualizar lista
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || pending.length === 0}
            onClick={approveAll}
          >
            Aprovar todos
          </button>
        </div>
      </div>
    </div>
  );
}
