import React from "react";
import { api } from "../api.js";

export default function InboxSheet({ inbox, busy, setBusy, setToast, onClose, onRefresh }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Inbox Cursor</h2>
          <button type="button" className="ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="sheet-body stack">
          <p className="muted">
            O Cursor grava packs aqui. O app importa sozinho a cada ~5s.
          </p>
          <pre className="path">{inbox?.inbox_dir || "data/inbox"}</pre>
          <h3 style={{ margin: 0, fontSize: 14 }}>Pendentes</h3>
          {(inbox?.pending_dirs || []).length === 0 &&
          (inbox?.pending_files || []).length === 0 ? (
            <p className="muted">Vazio</p>
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
