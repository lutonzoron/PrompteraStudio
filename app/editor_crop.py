"""Normalized crop rect helpers for the take editor (fractions of the frame)."""

from __future__ import annotations

from typing import Any


def normalize_crop(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return a clamped crop rect in 0..1 fractions, or None when disabled/invalid."""
    if not isinstance(raw, dict):
        return None
    if raw.get("enabled") is False:
        return None
    try:
        x = float(raw.get("x", 0))
        y = float(raw.get("y", 0))
        w = float(raw.get("w", 1))
        h = float(raw.get("h", 1))
    except (TypeError, ValueError):
        return None
    x = max(0.0, min(0.98, x))
    y = max(0.0, min(0.98, y))
    w = max(0.05, min(1.0 - x, w))
    h = max(0.05, min(1.0 - y, h))
    # Treat near-full frame as no crop.
    if x <= 0.001 and y <= 0.001 and w >= 0.998 and h >= 0.998:
        return None
    return {"enabled": True, "x": round(x, 6), "y": round(y, 6), "w": round(w, 6), "h": round(h, 6)}


def crop_pixels(crop: dict[str, Any], width: int, height: int) -> tuple[int, int, int, int]:
    """Map normalized crop to even pixel x,y,w,h suitable for yuv420p."""
    width = max(2, int(width))
    height = max(2, int(height))
    x = int(round(float(crop["x"]) * width))
    y = int(round(float(crop["y"]) * height))
    w = int(round(float(crop["w"]) * width))
    h = int(round(float(crop["h"]) * height))
    x = max(0, min(width - 2, x))
    y = max(0, min(height - 2, y))
    w = max(2, min(width - x, w))
    h = max(2, min(height - y, h))
    # libx264 / yuv420p needs even dimensions and offsets.
    x -= x % 2
    y -= y % 2
    w -= w % 2
    h -= h % 2
    w = max(2, w)
    h = max(2, h)
    if x + w > width:
        w = width - x
        w -= w % 2
    if y + h > height:
        h = height - y
        h -= h % 2
    return x, y, max(2, w), max(2, h)


def ffmpeg_crop_filter(crop: dict[str, Any], width: int, height: int) -> str:
    x, y, w, h = crop_pixels(crop, width, height)
    return f"crop={w}:{h}:{x}:{y}"
