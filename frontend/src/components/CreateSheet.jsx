import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useT } from "../i18n/index.jsx";

function DiceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="3.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="8.2" cy="8.2" r="1.35" fill="currentColor" />
      <circle cx="15.8" cy="8.2" r="1.35" fill="currentColor" />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" />
      <circle cx="8.2" cy="15.8" r="1.35" fill="currentColor" />
      <circle cx="15.8" cy="15.8" r="1.35" fill="currentColor" />
    </svg>
  );
}

export default function CreateSheet({ styles, busy, setBusy, setToast, onClose, onCreated }) {
  const t = useT();
  const [form, setForm] = useState({
    title: "",
    brief: "",
    style_id: styles[0]?.id || "",
    max_duration_sec: 60,
    review_mode: "automatico",
    model_pack: "sfw",
  });
  const [estimate, setEstimate] = useState(null);
  const style = styles.find((s) => s.id === form.style_id);

  useEffect(() => {
    if (!form.style_id && styles[0]) setForm((f) => ({ ...f, style_id: styles[0].id }));
  }, [styles, form.style_id]);

  useEffect(() => {
    const approx = Math.max(1, Math.round(Number(form.max_duration_sec) / 5));
    api.estimate(approx).then(setEstimate).catch(() => {});
  }, [form.max_duration_sec]);

  async function rollDice() {
    setBusy(true);
    try {
      const d = await api.dice(form.model_pack);
      setForm((f) => ({
        ...f,
        brief: d.brief,
        title: d.title || f.title,
      }));
      setToast(t("create.diceToast"));
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay-center" onClick={onClose}>
      <div className="create-modal" onClick={(e) => e.stopPropagation()}>
        <header className="create-modal-head">
          <div>
            <h2>{t("create.title")}</h2>
            <p className="muted">{t("create.subtitle")}</p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            {t("common.close")}
          </button>
        </header>

        <div className="create-modal-body stack">
          <div className="field">
            <label>{t("create.titleLabel")}</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t("create.titlePh")}
            />
          </div>

          <div className="field">
            <div className="create-brief-label">
              <label>{t("create.briefLabel")}</label>
              <button
                type="button"
                className="dice-btn"
                disabled={busy}
                title={t("create.diceTitle")}
                aria-label={t("create.diceTitle")}
                onClick={rollDice}
              >
                <DiceIcon />
              </button>
            </div>
            <textarea
              value={form.brief}
              onChange={(e) => setForm({ ...form, brief: e.target.value })}
              placeholder={t("create.briefPh")}
              className="create-brief"
            />
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              {t("create.diceHint", { pack: form.model_pack.toUpperCase() })}
            </div>
          </div>

          <div className="field">
            <label>{t("create.style")}</label>
            <select
              value={form.style_id}
              onChange={(e) => setForm({ ...form, style_id: e.target.value })}
            >
              <option value="">{t("create.noStyle")}</option>
              {styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            {style?.bible_hint_pt ? (
              <p className="create-style-hint">{style.bible_hint_pt}</p>
            ) : null}
          </div>

          <div className="chip-row">
            <button
              type="button"
              className={`chip ${form.model_pack === "sfw" ? "active" : ""}`}
              onClick={() => setForm({ ...form, model_pack: "sfw" })}
            >
              SFW
            </button>
            <button
              type="button"
              className={`chip ${form.model_pack === "nsfw" ? "active" : ""}`}
              onClick={() => setForm({ ...form, model_pack: "nsfw" })}
            >
              NSFW
            </button>
            <button
              type="button"
              className={`chip ${form.review_mode === "automatico" ? "active" : ""}`}
              onClick={() => setForm({ ...form, review_mode: "automatico" })}
            >
              {t("create.noReview")}
            </button>
            <button
              type="button"
              className={`chip ${form.review_mode === "com_revisao" ? "active" : ""}`}
              onClick={() => setForm({ ...form, review_mode: "com_revisao" })}
            >
              {t("create.withReview")}
            </button>
          </div>

          <div className="field" style={{ maxWidth: 220 }}>
            <label>{t("create.maxTime")}</label>
            <input
              type="number"
              min={10}
              max={600}
              value={form.max_duration_sec}
              onChange={(e) => setForm({ ...form, max_duration_sec: Number(e.target.value) })}
            />
          </div>
        </div>

        <footer className="create-modal-foot">
          {estimate ? (
            <div className="cta-cost">
              {t("create.estimate", {
                min: estimate.total_min,
                kwh: estimate.energy_kwh,
                cost: estimate.cost_brl,
              })}
              <span className="muted">{t("create.estimateTakes", { n: estimate.take_count })}</span>
            </div>
          ) : (
            <div className="cta-cost">{t("create.estimating")}</div>
          )}
          <button
            type="button"
            className="primary create-submit"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const p = await api.createProject({
                  ...form,
                  title: form.title || t("create.defaultTitle"),
                });
                const result = await api.generateStory(p.id, {
                  brief: form.brief,
                  use_dice: !form.brief.trim(),
                });
                setToast(t("create.readyToast"));
                onCreated(result.project);
              } catch (e) {
                setToast(String(e.message || e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("create.submit")}
          </button>
        </footer>
      </div>
    </div>
  );
}
