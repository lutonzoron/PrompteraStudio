import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Custom right-click menu.
 * items: [{ id, label, danger?, disabled?, sep? }]
 */
export default function ContextMenu({ x, y, items, onPick, onClose }) {
  const ref = useRef(null);
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
      {items.map((item, i) =>
        item.sep ? (
          <div key={`sep-${i}`} className="ctx-sep" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`ctx-item ${item.danger ? "danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onPick?.(item.id);
              onClose?.();
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
