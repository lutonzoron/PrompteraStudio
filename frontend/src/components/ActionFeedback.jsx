import React from "react";
import { useProjectActions } from "../projectActions.js";

export default function ActionFeedback() {
  const pending = useProjectActions();
  if (!pending.size) return null;
  return <div className="action-feedback" role="status" aria-live="polite" aria-atomic="true">
    {[...pending].map(([id, label]) => <div className="action-feedback-line" key={id}>
      <span className="request-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>)}
  </div>;
}
