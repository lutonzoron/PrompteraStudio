import React from "react";
import BrandLogo from "./BrandLogo.jsx";
import { useT } from "../i18n/index.jsx";

export default function Shell({
  children,
  health,
  pendingReviews,
  activeNav = "studio",
  onHome,
  onCreate,
  onOpenSettings,
  onOpenStyles,
  onOpenLogs,
  onOpenQueue,
  onOpenInbox,
  onComfyStart,
  inboxPending = 0,
  queueCount = 0,
}) {
  const t = useT();
  const comfyOn = !!health?.comfy?.online;
  const llmOn = !!health?.onboarding?.steps?.llm?.done;

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={onHome} type="button">
          <BrandLogo />
        </button>
        <nav className="top-nav">
          <button
            type="button"
            className={activeNav === "studio" ? "active" : ""}
            onClick={onHome}
          >
            {t("nav.studio")}
          </button>
          <button type="button" className={activeNav === "queue" ? "active" : ""} onClick={onOpenQueue}>
            {t("nav.queue")}
            {queueCount > 0 ? <span className="badge">{queueCount}</span> : null}
          </button>
          <button
            type="button"
            className={activeNav === "styles" ? "active" : ""}
            onClick={onOpenStyles}
          >
            {t("nav.styles")}
          </button>
          <button type="button" onClick={onOpenInbox}>
            {t("nav.inbox")}
            {inboxPending > 0 ? <span className="badge warn">{inboxPending}</span> : null}
          </button>
          <button type="button" className={activeNav === "logs" ? "active" : ""} onClick={onOpenLogs}>
            {t("logs.nav")}
          </button>
          <button type="button" onClick={onOpenSettings}>
            {t("nav.settings")}
            {!health?.onboarding?.complete ? <span className="badge warn">!</span> : null}
          </button>
        </nav>
        <div className="top-actions">
          <div className="dot-row">
            <span>
              <i className={`dot ${comfyOn ? "on" : "off"}`} />
              Comfy
            </span>
            <span>
              <i className={`dot ${llmOn ? "on" : "off"}`} />
              AI
            </span>
          </div>
          {pendingReviews > 0 ? (
            <span className="badge warn" title={t("nav.reviewsWaiting")}>
              {pendingReviews} review
            </span>
          ) : null}
          {!comfyOn ? (
            <button type="button" onClick={onComfyStart}>
              {t("nav.startComfy")}
            </button>
          ) : null}
          <button type="button" className="primary" onClick={onCreate}>
            {t("nav.newStory")}
          </button>
        </div>
      </header>
      <div className="main">{children}</div>
    </div>
  );
}
