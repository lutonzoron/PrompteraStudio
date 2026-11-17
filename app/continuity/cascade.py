"""Partial regeneration: same-session Continuity cascade helpers."""

from __future__ import annotations

from typing import Any

from .review import quarantine_latest_ready
from .runner import ckpt_root, latest_ready_clip


def take_session(take: dict[str, Any]) -> str:
    return str(take.get("session") or "default")


def cascade_from_take(takes: list[dict[str, Any]], take_n: int) -> list[dict[str, Any]]:
    """Takes in the same Continuity session with n >= take_n, in order."""
    ordered = sorted(takes, key=lambda t: int(t.get("n") or 0))
    by_n = {int(t["n"]): t for t in ordered if int(t.get("n") or 0) > 0}
    if take_n not in by_n:
        raise ValueError(f"Take {take_n} não encontrado")
    session = take_session(by_n[take_n])
    return [t for t in ordered if take_session(t) == session and int(t["n"]) >= take_n]


def cascade_ns(takes: list[dict[str, Any]], take_n: int) -> list[int]:
    return [int(t["n"]) for t in cascade_from_take(takes, take_n)]


def prior_in_session(takes: list[dict[str, Any]], take_n: int) -> list[dict[str, Any]]:
    """Takes in the same session with n < take_n."""
    ordered = sorted(takes, key=lambda t: int(t.get("n") or 0))
    by_n = {int(t["n"]): t for t in ordered if int(t.get("n") or 0) > 0}
    if take_n not in by_n:
        raise ValueError(f"Take {take_n} não encontrado")
    session = take_session(by_n[take_n])
    return [t for t in ordered if take_session(t) == session and int(t["n"]) < take_n]


def _ready_count(session: str) -> int:
    root = ckpt_root() / session
    if not root.exists():
        return 0
    count = 0
    for clip_dir in root.iterdir():
        if not clip_dir.is_dir() or clip_dir.name.startswith("_"):
            continue
        meta_path = clip_dir / "clip.json"
        if not meta_path.exists():
            continue
        try:
            import json

            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        status = meta.get("status")
        has_latent = (clip_dir / "latent.safetensors").exists() or (
            clip_dir / "delta.safetensors"
        ).exists()
        if status in {"staged", "broken"}:
            continue
        if status == "ready" or (has_latent and status not in {"staged", "broken"}):
            count += 1
    return count


def quarantine_session_to_keep(session: str, keep_count: int) -> int:
    """Quarantine newest ready Continuity clips until only keep_count remain."""
    root = ckpt_root() / session
    quarantined = 0
    while _ready_count(session) > max(0, keep_count):
        if not quarantine_latest_ready(root):
            break
        quarantined += 1
    return quarantined


def checkpoint_after_quarantine(session: str, keep_count: int) -> str | None:
    """Quarantine cascade clips and return the remaining latest ready id (or None)."""
    quarantine_session_to_keep(session, keep_count)
    if keep_count <= 0:
        return None
    try:
        return latest_ready_clip(session)
    except (FileNotFoundError, RuntimeError, OSError):
        return None
