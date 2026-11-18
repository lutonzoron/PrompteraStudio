import React, { useState } from "react";
import { api } from "../api.js";
import { useT } from "../i18n/index.jsx";
import MediaPlayer from "./MediaPlayer.jsx";

export default function ReviewModal({ review, onDone, setToast }) {
  const t = useT();
  const [mode, setMode] = useState("current");
  const src =
    mode === "full"
      ? api.mediaUrl(review.full_path)
      : api.mediaUrl(review.current_path || review.full_path);

  return (
    <div className="review-modal">
      <div className="row" style={{ padding: "12px 16px", justifyContent: "space-between" }}>
        <strong>
          {t("review.takeOf", {
            take: review.take,
            total: review.total,
            title: review.title,
          })}
        </strong>
        <button type="button" className="ghost" onClick={onDone}>
          {t("review.minimize")}
        </button>
      </div>
      <MediaPlayer key={src} src={src} autoPlay playsInline />
      <div className="review-actions">
        <button type="button" onClick={() => setMode(mode === "full" ? "current" : "full")}>
          {mode === "full" ? t("review.viewCurrent") : t("review.viewFull")}
        </button>
        <button
          type="button"
          className="ok"
          onClick={async () => {
            await api.review(review.project_id, "approve");
            setToast(t("review.approvedToast"));
            onDone();
          }}
        >
          {t("review.approve")}
        </button>
        <button
          type="button"
          className="danger"
          onClick={async () => {
            await api.review(review.project_id, "reject");
            setToast(t("review.rejectedToast"));
            onDone();
          }}
        >
          {t("review.reject")}
        </button>
      </div>
    </div>
  );
}
