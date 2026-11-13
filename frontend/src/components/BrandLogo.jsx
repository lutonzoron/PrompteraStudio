import React from "react";

/** Official Promptera Studio logo asset. */
export default function BrandLogo({ compact = false }) {
  if (compact) {
    return (
      <span className="brand-logo compact" aria-label="Promptera Studio">
        <img className="brand-mark-img" src="/logo-mark.png" alt="" draggable={false} />
      </span>
    );
  }
  return (
    <span className="brand-logo" aria-label="Promptera Studio">
      <img
        className="brand-full-img"
        src="/logo-promptera.png"
        alt="Promptera Studio"
        draggable={false}
      />
    </span>
  );
}
