import React, { useCallback, useEffect, useRef, useState } from "react";

const MIN = 0.05;
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function clampCrop(next) {
  let x = Math.max(0, Math.min(1 - MIN, Number(next.x) || 0));
  let y = Math.max(0, Math.min(1 - MIN, Number(next.y) || 0));
  let w = Math.max(MIN, Math.min(1 - x, Number(next.w) || MIN));
  let h = Math.max(MIN, Math.min(1 - y, Number(next.h) || MIN));
  return { enabled: true, x, y, w, h };
}

/**
 * Interactive crop rectangle over the video frame.
 * Values are normalized 0..1 relative to the visible frame.
 */
export default function CropOverlay({ crop, onChange, disabled = false }) {
  const rootRef = useRef(null);
  const dragRef = useRef(null);
  const localRef = useRef(null);
  const [local, setLocal] = useState(() =>
    clampCrop(crop || { x: 0.08, y: 0.08, w: 0.84, h: 0.84 })
  );
  localRef.current = local;

  useEffect(() => {
    if (!crop) return;
    setLocal(clampCrop(crop));
  }, [crop?.x, crop?.y, crop?.w, crop?.h, crop?.enabled]);

  const commit = useCallback(
    (next) => {
      const clean = clampCrop(next);
      setLocal(clean);
      localRef.current = clean;
      onChange?.(clean);
    },
    [onChange]
  );

  const onPointerDown = (mode) => (e) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...local },
      rect,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { mode, startX, startY, origin, rect } = drag;
    const dx = (e.clientX - startX) / Math.max(1, rect.width);
    const dy = (e.clientY - startY) / Math.max(1, rect.height);
    let next = { ...origin };

    if (mode === "move") {
      next.x = origin.x + dx;
      next.y = origin.y + dy;
      next.x = Math.max(0, Math.min(1 - origin.w, next.x));
      next.y = Math.max(0, Math.min(1 - origin.h, next.y));
    } else {
      const right = origin.x + origin.w;
      const bottom = origin.y + origin.h;
      if (mode.includes("w")) {
        const nx = Math.max(0, Math.min(right - MIN, origin.x + dx));
        next.x = nx;
        next.w = right - nx;
      }
      if (mode.includes("e")) {
        next.w = Math.max(MIN, Math.min(1 - origin.x, origin.w + dx));
      }
      if (mode.includes("n")) {
        const ny = Math.max(0, Math.min(bottom - MIN, origin.y + dy));
        next.y = ny;
        next.h = bottom - ny;
      }
      if (mode.includes("s")) {
        next.h = Math.max(MIN, Math.min(1 - origin.y, origin.h + dy));
      }
    }
    const clean = clampCrop(next);
    localRef.current = clean;
    setLocal(clean);
  };

  const onPointerUp = (e) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    commit(localRef.current);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const style = {
    left: `${local.x * 100}%`,
    top: `${local.y * 100}%`,
    width: `${local.w * 100}%`,
    height: `${local.h * 100}%`,
  };

  return (
    <div
      ref={rootRef}
      className={`te-crop-overlay ${disabled ? "is-disabled" : ""}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="te-crop-shade te-crop-shade-top" style={{ height: `${local.y * 100}%` }} />
      <div
        className="te-crop-shade te-crop-shade-left"
        style={{ top: `${local.y * 100}%`, height: `${local.h * 100}%`, width: `${local.x * 100}%` }}
      />
      <div
        className="te-crop-shade te-crop-shade-right"
        style={{
          top: `${local.y * 100}%`,
          height: `${local.h * 100}%`,
          left: `${(local.x + local.w) * 100}%`,
          width: `${(1 - local.x - local.w) * 100}%`,
        }}
      />
      <div
        className="te-crop-shade te-crop-shade-bottom"
        style={{ top: `${(local.y + local.h) * 100}%`, height: `${(1 - local.y - local.h) * 100}%` }}
      />

      <div
        className="te-crop-box"
        style={style}
        onPointerDown={onPointerDown("move")}
      >
        <span className="te-crop-label">
          {Math.round(local.w * 100)}% × {Math.round(local.h * 100)}%
        </span>
        {HANDLES.map((h) => (
          <i
            key={h}
            className={`te-crop-handle is-${h}`}
            onPointerDown={onPointerDown(h)}
          />
        ))}
      </div>
    </div>
  );
}

export function defaultCrop() {
  return clampCrop({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
}
