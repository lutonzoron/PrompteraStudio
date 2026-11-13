from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from . import db
from .config import DELIVERABLES_DIR, PROJECTS_DIR

# Extra search roots for imported legacy jobs
_LEGACY_DELIVERABLES = [
    Path(r"c:\Projetos\teste comfyui nsfw\deliverables"),
]
_COMFY_VIDEO = Path(r"C:\Projetos\Comfyui\output\video")


def resolve_master_path(project: dict) -> Path | None:
    """Find playable master MP4 for a project."""
    stats = project.get("stats") or {}
    candidates: list[Path] = []
    master = stats.get("master")
    if master:
        candidates.append(Path(master))

    slug = project.get("slug") or ""
    # Known legacy slug → folder aliases
    aliases = {
        "anime6": ["anime6", "anime6_lanterna"],
        "ru_nsfw_11h": ["ru_nsfw_11h", "ru_nsfw"],
        "re_horror_1min": ["re_horror_1min", "re_horror_1min"],
        "vila_lele_3x30": ["vila_lele_3x30", "vila_lele"],
    }
    slug_dirs = aliases.get(slug, [slug]) if slug else []
    if slug and slug not in slug_dirs:
        slug_dirs.insert(0, slug)

    preferred: list[Path] = []
    fallback: list[Path] = []
    for folder_name in slug_dirs:
        preferred.append(DELIVERABLES_DIR / folder_name / "master.mp4")
        for root in [DELIVERABLES_DIR, *_LEGACY_DELIVERABLES]:
            preferred.extend(sorted(root.glob(f"*{folder_name}*master*.mp4"), reverse=True))
            folder = root / folder_name
            if folder.exists():
                preferred.extend(sorted(folder.glob("*master*.mp4"), reverse=True))
                # only use non-master clips as last resort
                fallback.extend(sorted(folder.glob("*.mp4"), reverse=True)[:3])

    def _first_existing(paths: list[Path]) -> Path | None:
        seen: set[Path] = set()
        for p in paths:
            try:
                rp = p.resolve()
            except OSError:
                continue
            if rp in seen:
                continue
            seen.add(rp)
            if rp.exists() and rp.is_file() and rp.suffix.lower() == ".mp4":
                name = rp.name.lower()
                if any(x in name for x in ("_audio", "current_t", "review_t")) and paths is preferred:
                    continue
                return rp
        return None

    return _first_existing(preferred) or _first_existing(fallback)


def project_master_info(project_id: str) -> dict:
    project = db.get_project(project_id)
    if not project:
        return {"has_master": False, "master_url": None, "master_path": None}
    path = resolve_master_path(project)
    if not path:
        return {"has_master": False, "master_url": None, "master_path": None}
    # Persist discovered path into stats for next time
    stats = dict(project.get("stats") or {})
    if stats.get("master") != str(path):
        stats["master"] = str(path)
        db.update_project(project_id, stats=stats)
    return {
        "has_master": True,
        "master_url": f"/api/projects/{project_id}/master",
        "master_path": str(path),
    }


def _slug_dirs(slug: str) -> list[str]:
    aliases = {
        "anime6": ["anime6", "anime6_lanterna"],
        "ru_nsfw_11h": ["ru_nsfw_11h", "ru_nsfw"],
        "re_horror_1min": ["re_horror_1min"],
        "vila_lele_3x30": ["vila_lele_3x30", "vila_lele"],
        "milkshake_htf": ["milkshake_htf"],
    }
    dirs = aliases.get(slug, [slug]) if slug else []
    if slug and slug not in dirs:
        dirs = [slug, *dirs]
    return dirs


def project_is_continuity_full(project: dict[str, Any]) -> bool:
    """Continuity Full: each take MP4 already contains 1..N (do NOT concat all takes)."""
    takes = project.get("takes") or []
    if any(str(t.get("kind") or "").lower() == "continue" for t in takes):
        return True
    stats = project.get("stats") or {}
    if stats.get("external_runner"):
        return True
    mode = str(project.get("mode") or stats.get("mode") or "").lower()
    return "continuity" in mode or mode in {"h3", "minimax", "minimax_h3"}


def _take_clip_score(path: Path) -> tuple[int, float]:
    """Higher is better for picking the Continuity Full export of a take."""
    name = path.name.lower()
    score = 0
    if "master" in name:
        score -= 100
    if "current_t" in name or "review_t" in name:
        # review/current are for UI — not the Full session join
        score -= 40
    if "_audio" in name:
        score += 50
    if "_full" in name or name.endswith("_full.mp4"):
        score += 40
    if re.match(r"^t\d{2}(?:_|\.|$)", name):
        score += 20
    try:
        mtime = path.stat().st_mtime
        size = path.stat().st_size
    except OSError:
        mtime = 0.0
        size = 0
    # Prefer larger files among same take (Full grows with N)
    score += min(size // (1024 * 256), 30)
    return (score, mtime)


def _index_take_files(project: dict[str, Any]) -> dict[int, Path]:
    """Best MP4 path per take number (skips masters)."""
    slug = project.get("slug") or ""
    takes = project.get("takes") or []
    take_ns = [int(t.get("n") or 0) for t in takes if int(t.get("n") or 0) > 0]
    if not take_ns:
        take_ns = list(range(1, 32))

    roots: list[Path] = []
    for folder_name in _slug_dirs(slug):
        roots.append(DELIVERABLES_DIR / folder_name)
        roots.append(_COMFY_VIDEO / folder_name)
        for legacy in _LEGACY_DELIVERABLES:
            roots.append(legacy / folder_name)
    if project.get("id"):
        roots.append(PROJECTS_DIR / project["id"] / "review")

    by_n: dict[int, list[Path]] = {n: [] for n in take_ns}
    rx = re.compile(r"(?:^|[_\-])t(\d{1,2})(?:[_\-.]|$)", re.I)
    for root in roots:
        if not root.exists():
            continue
        for f in root.glob("*.mp4"):
            name = f.name.lower()
            if "master" in name:
                continue
            m = rx.search(name) or re.match(r"^t(\d{1,2})\.mp4$", name)
            if not m:
                continue
            n = int(m.group(1))
            if n in by_n:
                by_n[n].append(f)

    chosen: dict[int, Path] = {}
    for n in sorted(by_n.keys()):
        cands = by_n[n]
        if not cands:
            continue
        cands.sort(key=_take_clip_score, reverse=True)
        chosen[n] = cands[0]
    return chosen


def collect_take_clips(project: dict[str, Any]) -> list[Path]:
    """
    Clips to feed into a master build.

    Continuity Full: ONE file per session (the latest cumulative take) —
    never every t01+t02+t03… (that triple-counts the film).

    Independent takes: one file per take number, in order.
    """
    if project_is_continuity_full(project):
        return pick_continuity_session_finals(project)
    indexed = _index_take_files(project)
    return [indexed[n] for n in sorted(indexed.keys())]


def pick_continuity_session_finals(project: dict[str, Any]) -> list[Path]:
    """Last Full export per Continuity session, in first-seen session order."""
    takes = project.get("takes") or []
    indexed = _index_take_files(project)
    if not indexed:
        return []

    order: list[str] = []
    by_session: dict[str, list[int]] = {}
    for t in takes:
        s = str(t.get("session") or "_default")
        n = int(t.get("n") or 0)
        if not n:
            continue
        if s not in by_session:
            order.append(s)
            by_session[s] = []
        by_session[s].append(n)

    if not order:
        # No session metadata — single film: use highest take number only
        return [indexed[max(indexed.keys())]]

    finals: list[Path] = []
    seen_files: set[Path] = set()
    for s in order:
        ns = sorted(set(by_session.get(s) or []))
        picked: Path | None = None
        for n in reversed(ns):
            if n in indexed:
                picked = indexed[n]
                break
        if picked is None:
            continue
        try:
            key = picked.resolve()
        except OSError:
            key = picked
        if key in seen_files:
            continue
        seen_files.add(key)
        finals.append(picked)

    # Fallback: if sessions had no files, still prefer latest take overall
    if not finals and indexed:
        finals = [indexed[max(indexed.keys())]]
    return finals


def build_master(project_id: str, *, force: bool = False) -> dict[str, Any]:
    """Build deliverables/<slug>/master.mp4 without re-stacking Continuity Fulls."""
    from .continuity.runner import concat_master

    project = db.get_project(project_id)
    if not project:
        raise RuntimeError("Projeto não encontrado")

    if not force:
        existing = resolve_master_path(project)
        # only reuse if it's clearly a master file, not a random take fallback
        if existing and "master" in existing.name.lower():
            info = project_master_info(project_id)
            return {**info, "built": False, "clips": []}

    continuity = project_is_continuity_full(project)
    clips = collect_take_clips(project)
    if not clips:
        raise RuntimeError(
            "Nenhum clip de take encontrado para montar o master. "
            "Gere os takes primeiro (Comfy/runner)."
        )

    slug = project.get("slug") or project_id
    out_dir = DELIVERABLES_DIR / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "master.mp4"

    # Continuity Full single-session → copy last take (already the whole short)
    # Multi-session → concat only each session's final Full (not every take)
    mode = "continuity_session_finals" if continuity else "independent_takes_concat"
    concat_master(clips, out_path)

    stats = dict(project.get("stats") or {})
    stats["master"] = str(out_path)
    stats["master_clips"] = [c.name for c in clips]
    stats["master_mode"] = mode
    db.update_project(project_id, stats=stats)

    # drop stale poster so a fresh frame can be pulled later (SFW only)
    poster = PROJECTS_DIR / project_id / "poster.jpg"
    if poster.exists():
        try:
            poster.unlink()
        except OSError:
            pass

    return {
        "has_master": True,
        "master_url": f"/api/projects/{project_id}/master",
        "master_path": str(out_path),
        "built": True,
        "clips": [c.name for c in clips],
        "clip_count": len(clips),
        "mode": mode,
        "continuity_full": continuity,
    }
