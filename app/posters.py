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


def poster_version(path: Path | None) -> int | None:
    """mtime as cache-bust version, or None if missing."""
    if not path:
        return None
    try:
        if path.exists() and path.stat().st_size > 0:
            return int(path.stat().st_mtime)
    except OSError:
        return None
    return None


def _dedupe_existing(cands: list[Path]) -> list[Path]:
    out: list[Path] = []
    seen: set[Path] = set()
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


def _early_candidate_videos(project: dict) -> list[Path]:
    """Cheap candidates (master / deliverables) — no take-index scan."""
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
    for key in ("review_full_path", "review_current_path"):
        p = project.get(key)
        if p:
            cands.append(Path(p))
    return _dedupe_existing(cands)


def _take_fallback_videos(project: dict) -> list[Path]:
    """Expensive disk scan — only when early candidates fail."""
    try:
        from .masters import index_take_files

        indexed = index_take_files(project)
        return _dedupe_existing([indexed[n] for n in sorted(indexed)])
    except Exception:
        return []


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


def _is_nsfw_project(project: dict) -> bool:
    pack = (project.get("model_pack") or "").lower()
    blob = f"{project.get('slug') or ''} {project.get('title') or ''}".lower()
    return pack == "nsfw" or "nsfw" in blob


def _poster_fresher_than(poster: Path, videos: list[Path]) -> bool:
    """True when poster exists and is at least as new as every candidate video."""
    try:
        if not poster.is_file() or poster.stat().st_size <= 0:
            return False
        poster_mtime = poster.stat().st_mtime
    except OSError:
        return False
    if not videos:
        return True
    for video in videos:
        try:
            # Half-second slack avoids false stale from same-second writes.
            if video.stat().st_mtime > poster_mtime + 0.5:
                return False
        except OSError:
            continue
    return True


def ensure_poster(project_id: str, *, force: bool = False) -> Path | None:
    """Return path to poster.jpg or None if unavailable.

    Rebuilds when ``force`` is set, or when the master/candidate video is newer
    than the cached JPEG (common after regen if warmup was skipped).
    """
    project = db.get_project(project_id)
    if not project:
        return None
    if _is_nsfw_project(project):
        return None
    poster = _project_poster_path(project_id)
    early = _early_candidate_videos(project)
    if not force and early and _poster_fresher_than(poster, early):
        return poster
    if not force and not early and poster.is_file() and poster.stat().st_size > 0:
        # No master/deliverable to compare — keep existing cover.
        return poster
    for video in early:
        if _extract_frame(video, poster):
            return poster
    for video in _take_fallback_videos(project):
        if _extract_frame(video, poster):
            return poster
    if poster.is_file() and poster.stat().st_size > 0:
        return poster
    return None
