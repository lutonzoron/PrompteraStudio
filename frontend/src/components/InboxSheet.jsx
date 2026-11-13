import React from "react";
import { api } from "../api.js";

export default function InboxSheet({ inbox, busy, setBusy, setToast, onClose, onRefresh }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Inbox</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="sheet-body stack">
          <p className="muted" style={{ margin: 0 }}>
            Cursor, Claude, Copilot ou outra IA grava um pack aqui. O app importa sozinho (~5s).
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Spec para agentes: <code>AI_STORY_INBOX.md</code> · <code>AGENTS.md</code>
          </p>
          <pre className="path">{inbox?.inbox_dir || "data/inbox"}</pre>
          <div className="muted" style={{ fontSize: 12 }}>
            <code>data/inbox/&lt;slug&gt;/takes.json</code> (+ meta.json, roteiro.md)
          </div>
          <h3 style={{ margin: 0, fontSize: 14 }}>Pendentes</h3>
          {(inbox?.pending_dirs || []).length === 0 &&
          (inbox?.pending_files || []).length === 0 ? (
            <p className="muted">Vazio — peça à IA para escrever um pack no caminho acima.</p>
          ) : (
            <>
              {(inbox?.pending_dirs || []).map((d) => (
                <div key={d} className="shot">
                  📁 {d}
                </div>
              ))}
              {(inbox?.pending_files || []).map((f) => (
                <div key={f} className="shot">
                  📄 {f}
                </div>
              ))}
            </>
          )}
          <p className="muted">{inbox?.processed_count ?? 0} processados</p>
        </div>
        <div className="sheet-foot">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.inboxScan();
                const n = (r.results || []).filter((x) => x.ok && !x.skipped).length;
                setToast(n ? `${n} importado(s)` : "Nada novo");
                onRefresh();
              } catch (e) {
                setToast(String(e.message || e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Escanear agora
          </button>
        </div>
      </div>
    </div>
  );
}
