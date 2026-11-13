import React from "react";
import BrandLogo from "./BrandLogo.jsx";

export default function Shell({
  children,
  health,
  pendingReviews,
  activeNav = "studio",
  onHome,
  onCreate,
  onOpenSettings,
  onOpenStyles,
  onComfyStart,
}) {
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
            Studio
          </button>
          <button
            type="button"
            className={activeNav === "styles" ? "active" : ""}
            onClick={onOpenStyles}
          >
            Estilos
          </button>
          <button type="button" onClick={onOpenSettings}>
            Config
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
              IA
            </span>
          </div>
          {pendingReviews > 0 ? (
            <span className="badge warn" title="Takes aguardando revisão">
              {pendingReviews} review
            </span>
          ) : null}
          {!comfyOn ? (
            <button type="button" onClick={onComfyStart}>
              Iniciar Comfy
            </button>
          ) : null}
          <button type="button" className="primary" onClick={onCreate}>
            Nova história
          </button>
        </div>
      </header>
      <div className="main">{children}</div>
    </div>
  );
}
