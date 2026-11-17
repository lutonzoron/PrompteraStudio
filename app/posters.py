from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from . import db
from .config import DELIVERABLES_DIR, PROJECTS_DIR, ensure_dirs


def _ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


def _project_poster_path(project_id: str) -> Path:
    ensure_dirs()
    d = PROJECTS_DIR / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d / "poster.jpg"


def _candidate_videos(project: dict) -> list[Path]:
    cands: list[Path] = []
    stats = project.get("stats") or {}
    for key in ("master", "original_master"):
        value = stats.get(key)
        if value:
            cands.append(Path(value))
    slug = project.get("slug") or ""
    deliver = DELIVERABLES_DIR / slug
    if deliver.exists():
        cands.extend(sorted(deliver.glob("*master*.mp4"), reverse=True))
        cands.extend(sorted(deliver.glob("review_t*.mp4")))
        cands.extend(sorted(deliver.glob("current_t*.mp4")))
    # absolute review paths
    for key in ("review_full_path", "review_current_path"):
        p = project.get(key)
        if p:
            cands.append(Path(p))
    # Fallback: any completed take clip still on disk
    try:
        from .masters import index_take_files
        indexed = index_take_files(project)
        for n in sorted(indexed):
            cands.append(indexed[n])
    except Exception:
        pass
    out = []
    seen = set()
    for p in cands:
        try:
            rp = p.resolve()
        except OSError:
            continue
        if rp in seen or not rp.exists() or not rp.is_file():
            continue
        seen.add(rp)
        out.append(rp)
    return out


def _extract_frame(video: Path, dest: Path) -> bool:
    ff = _ffmpeg()
    if not ff:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ff,
        "-y",
        "-ss",
        "0.5",
        "-i",
        str(video),
        "-frames:v",
        "1",
        "-q:v",
        "3",
        "-vf",
        "scale=360:-2",
        str(dest),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=30, check=False)
        return proc.returncode == 0 and dest.exists() and dest.stat().st_size > 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def ensure_poster(project_id: str, *, force: bool = False) -> Path | None:
    """Return path to poster.jpg or None if unavailable."""
    project = db.get_project(project_id)
    if not project:
        return None
    # NSFW projects never get cover frames
    pack = (project.get("model_pack") or "").lower()
    blob = f"{project.get('slug') or ''} {project.get('title') or ''}".lower()
    if pack == "nsfw" or "nsfw" in blob:
        return None
    poster = _project_poster_path(project_id)
    if poster.exists() and poster.stat().st_size > 0 and not force:
        return poster
    for video in _candidate_videos(project):
        if _extract_frame(video, poster):
            return poster
    return None
