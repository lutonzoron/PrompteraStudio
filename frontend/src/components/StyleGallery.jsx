import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useConfirm } from "./ConfirmDialog.jsx";
import { useT } from "../i18n/index.jsx";

function initials(label) {
  return String(label || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

export default function StyleGallery({ styles, busy, setBusy, setToast, onChange }) {
  const t = useT();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState(styles[0]?.id || null);
  const [creating, setCreating] = useState(false);
  const [desc, setDesc] = useState("");
  const [base, setBase] = useState(styles[0]?.id || "");
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!styles.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !styles.some((s) => s.id === selectedId)) {
      setSelectedId(styles[0].id);
    }
    if (!base || !styles.some((s) => s.id === base)) {
      setBase(styles[0].id);
    }
  }, [styles, selectedId, base]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return styles;
    return styles.filter((s) => {
      const hay = `${s.label} ${s.bible_hint_pt || ""} ${s.id}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [styles, q]);

  const selected = styles.find((s) => s.id === selectedId) || null;

  return (
    <div className="styles-page">
      <div className="page-head">
        <div>
          <h1>{t("styles.title")}</h1>
          <p>{t("styles.subtitle", { count: styles.length })}</p>
        </div>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setCreating(true);
              setLabel("");
              setDesc("");
            }}
          >
            {t("styles.newStyle")}
          </button>
        </div>
      </div>

      <div className="styles-toolbar">
        <input placeholder={t("styles.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted">{t("styles.visible", { n: filtered.length })}</span>
      </div>

      <div className="styles-layout">
        <div className="styles-grid">
          {filtered.length === 0 ? (
            <div className="empty-hero" style={{ gridColumn: "1 / -1" }}>
              <h2>{t("styles.emptyTitle")}</h2>
              <p>{t("styles.emptyHint")}</p>
              <button type="button" className="primary" onClick={() => setCreating(true)}>
                {t("styles.createStyle")}
              </button>
            </div>
          ) : (
            filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`style-tile ${selectedId === s.id ? "selected" : ""}`}
                onClick={() => {
                  setSelectedId(s.id);
                  setCreating(false);
                }}
              >
                <div className="style-tile-mark" aria-hidden>
                  {initials(s.label)}
                </div>
                <strong>{s.label}</strong>
                <p>{s.bible_hint_pt || t("styles.noDescription")}</p>
              </button>
            ))
          )}
        </div>

        <aside className="styles-side stack">
          {creating ? (
            <>
              <div className="styles-side-head">
                <h2>{t("styles.newStyleTitle")}</h2>
                <button type="button" className="ghost" onClick={() => setCreating(false)}>
                  {t("styles.cancel")}
                </button>
              </div>
              <p className="muted">{t("styles.adaptHint")}</p>
              <div className="field">
                <label>{t("styles.base")}</label>
                <select value={base} onChange={(e) => setBase(e.target.value)}>
                  {styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t("styles.name")}</label>
                <input
                  value={label}
                  placeholder={t("styles.namePh")}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="field">
                <label>{t("styles.desc")}</label>
                <textarea
                  value={desc}
                  placeholder={t("styles.descPh")}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="primary"
                disabled={busy || !desc.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const s = await api.adaptStyle({
                      description: desc,
                      base_style_id: base || null,
                      label: label || null,
                    });
                    setToast(t("styles.createdToast", { label: s.label }));
                    setDesc("");
                    setLabel("");
                    setCreating(false);
                    setSelectedId(s.id);
                    onChange();
                  } catch (e) {
                    setToast(String(e.message || e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("styles.createWithAi")}
              </button>
            </>
          ) : selected ? (
            <>
              <div className="styles-side-head">
                <h2>{selected.label}</h2>
              </div>
              <div className="style-detail-mark" aria-hidden>
                {initials(selected.label)}
              </div>
              <p className="styles-side-body">{selected.bible_hint_pt || t("styles.noBible")}</p>
              {selected.craft_rules_en ? (
                <div className="field">
                  <label>{t("styles.craftRules")}</label>
                  <pre className="style-pre">{selected.craft_rules_en}</pre>
                </div>
              ) : null}
              {selected.lock_en ? (
                <div className="field">
                  <label>{t("styles.lock")}</label>
                  <pre className="style-pre">{selected.lock_en}</pre>
                </div>
              ) : null}
              <div className="muted" style={{ fontSize: 11 }}>
                id · {selected.id}
              </div>
              <div className="styles-side-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const s = await api.dupStyle(selected.id);
                      setToast(t("styles.duplicatedToast", { label: s.label || selected.label }));
                      setSelectedId(s.id || selectedId);
                      onChange();
                    } catch (e) {
                      setToast(String(e.message || e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t("styles.duplicate")}
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await confirm({
                      title: t("styles.archiveTitle"),
                      message: t("styles.archiveMsg", { label: selected.label }),
                      confirmLabel: t("styles.archive"),
                      danger: true,
                    });
                    if (!ok) return;
                    setBusy(true);
                    try {
                      await api.archiveStyle(selected.id);
                      setToast(t("styles.archivedToast"));
                      setSelectedId(null);
                      onChange();
                    } catch (e) {
                      setToast(String(e.message || e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t("styles.archive")}
                </button>
              </div>
            </>
          ) : (
            <p className="muted">{t("styles.selectHint")}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
