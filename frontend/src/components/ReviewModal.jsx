import React, { useState } from "react";
import { api } from "../api.js";

export default function ReviewModal({ review, onDone, setToast }) {
  const [mode, setMode] = useState("current");
  const src =
    mode === "full"
      ? api.mediaUrl(review.full_path)
      : api.mediaUrl(review.current_path || review.full_path);

  return (
    <div className="review-modal">
      <div className="row" style={{ padding: "12px 16px", justifyContent: "space-between" }}>
        <strong>
          Take {review.take}/{review.total} — {review.title}
        </strong>
        <button type="button" className="ghost" onClick={onDone}>
          Minimizar
        </button>
      </div>
      <video key={src} src={src} controls autoPlay playsInline />
      <div className="review-actions">
        <button type="button" onClick={() => setMode(mode === "full" ? "current" : "full")}>
          {mode === "full" ? "Ver take atual" : "Ver tudo junto"}
        </button>
        <button
          type="button"
          className="ok"
          onClick={async () => {
            await api.review(review.project_id, "approve");
            setToast("Aprovado");
            onDone();
          }}
        >
          Aprovar
        </button>
        <button
          type="button"
          className="danger"
          onClick={async () => {
            await api.review(review.project_id, "reject");
            setToast("Reprovado — refazendo");
            onDone();
          }}
        >
          Reprovar
        </button>
      </div>
    </div>
  );
}
