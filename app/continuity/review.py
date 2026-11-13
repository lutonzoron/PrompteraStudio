from __future__ import annotations

import json
import shutil
import subprocess
import time
from pathlib import Path


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg não está no PATH")
    return exe


def extract_current_take(full_mp4: Path, out_mp4: Path, take_seconds: float = 5.0) -> Path:
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        _ffmpeg(),
        "-y",
        "-sseof",
        f"-{take_seconds + 0.15:.2f}",
        "-i",
        str(full_mp4),
        "-c",
        "copy",
        str(out_mp4),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return out_mp4


def prepare_review_clips(
    *,
    full_src: Path,
    review_dir: Path,
    n: int,
    take_seconds: float,
) -> tuple[Path, Path]:
    review_dir.mkdir(parents=True, exist_ok=True)
    full_dst = review_dir / f"review_t{n:02d}.mp4"
    current_dst = review_dir / f"current_t{n:02d}.mp4"
    shutil.copy2(full_src, full_dst)
    try:
        extract_current_take(full_dst, current_dst, take_seconds)
    except Exception:
        shutil.copy2(full_dst, current_dst)
    return full_dst, current_dst


def quarantine_latest_ready(session_root: Path) -> str | None:
    ready = []
    if not session_root.exists():
        return None
    for clip_dir in session_root.iterdir():
        if not clip_dir.is_dir() or clip_dir.name.startswith("_"):
            continue
        meta_path = clip_dir / "clip.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        status = meta.get("status")
        has_latent = (clip_dir / "latent.safetensors").exists() or (
            clip_dir / "delta.safetensors"
        ).exists()
        if status in {"staged", "broken"}:
            continue
        if status == "ready" or (has_latent and status not in {"staged", "broken"}):
            ready.append((meta_path.stat().st_mtime, clip_dir))
    if not ready:
        return None
    ready.sort(key=lambda x: x[0], reverse=True)
    clip_dir = ready[0][1]
    clip_id = clip_dir.name
    dest_root = session_root / "_rejected"
    dest_root.mkdir(parents=True, exist_ok=True)
    dest = dest_root / f"{clip_id}_{int(time.time())}"
    shutil.move(str(clip_dir), str(dest))
    return clip_id
