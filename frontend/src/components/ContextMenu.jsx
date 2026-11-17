import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Custom right-click menu.
 * items: [{ id, label, danger?, disabled?, sep? }]
 */
export default function ContextMenu({ x, y, items, onPick, onClose, pendingLabel }) {
  const ref = useRef(null);
  const picked = useRef(false);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    setPos({ left, top });
  }, [x, y, items]);

  useEffect(() => {
    const close = () => onClose?.();
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close();
    };
    const onScroll = () => close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  if (!items?.length) return null;

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {pendingLabel && <div className="ctx-pending" role="status">
        <span className="request-spinner" aria-hidden="true" /> {pendingLabel}
      </div>}
      {items.map((item, i) =>
        item.sep ? (
          <div key={`sep-${i}`} className="ctx-sep" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            title={item.title}
            className={`ctx-item ${item.danger ? "danger" : ""}`}
            disabled={item.disabled || !!pendingLabel}
            onClick={() => {
              if (item.disabled || pendingLabel || picked.current) return;
              picked.current = true;
              onClose?.();
              onPick?.(item.id);
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
