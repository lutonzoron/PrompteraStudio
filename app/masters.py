from __future__ import annotations

import re
import hashlib
import shutil
import threading
from pathlib import Path
from typing import Any

from . import db
from .config import DELIVERABLES_DIR, PROJECTS_DIR

# Extra search roots for imported legacy jobs
_LEGACY_DELIVERABLES = [
    Path(r"c:\Projetos\teste comfyui nsfw\deliverables"),
]
_COMFY_VIDEO = Path(r"C:\Projetos\Comfyui\output\video")
_preview_lock = threading.Lock()


def resolve_master_path(project: dict) -> Path | None:
    """Find playable master MP4 for a project."""
    stats = project.get("stats") or {}
    candidates: list[Path] = []
    master = stats.get("master")
    if master:
        candidates.append(Path(master))
    if stats.get('generation_id'):
        # Older files still on disk belong to the replaced run, never this one.
        return Path(master) if master and Path(master).is_file() else None

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
    for folder_name in slug_dirs:
        preferred.append(DELIVERABLES_DIR / folder_name / "master.mp4")
        for root in [DELIVERABLES_DIR, *_LEGACY_DELIVERABLES]:
            preferred.extend(sorted(root.glob(f"*{folder_name}*master*.mp4"), reverse=True))
            folder = root / folder_name
            if folder.exists():
                preferred.extend(sorted(folder.glob("*master*.mp4"), reverse=True))

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
                if "master" not in name or any(x in name for x in ("current_t", "review_t", "preview")):
                    continue
                return rp
        return None

    return _first_existing(candidates + preferred)


def project_master_info(project_id: str) -> dict:
    project = db.get_project(project_id)
    if not project:
        return {"has_master": False, "master_url": None, "master_path": None}
    ready = _completed_project(project)
    if len(ready.get('takes') or []) < len(project.get('takes') or []):
        return {"has_master": False, "master_url": None, "master_path": None}
    path = resolve_master_path(project)
    if not path:
        return {"has_master": False, "master_url": None, "master_path": None}
    version = f"{path.stat().st_mtime_ns}-{path.stat().st_size}"
    return {
        "has_master": True,
        "master_url": f"/api/projects/{project_id}/master?v={version}",
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
    if re.match(r"^t\d+(?:_|\.|$)", name):
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
    run_id = (project.get('stats') or {}).get('generation_id')
    prefixes = {int(t['n']): str(t.get('prefix', '')).replace('\\', '/').rsplit('/', 1)[-1]
                for t in takes}
    rx = re.compile(r"(?:^|[_\-])t(\d+)(?:[_\-.]|$)", re.I)
    for root in roots:
        if not root.exists():
            continue
        for f in root.glob("*.mp4"):
            name = f.name.lower()
            if "master" in name or "current_t" in name:
                continue
            m = rx.search(name)
            if not m:
                continue
            n = int(m.group(1))
            if run_id:
                prefix = prefixes.get(n, '').lower()
                if not (name.startswith(prefix + '_') or name == prefix + '.mp4'):
                    continue
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


def index_take_files(project: dict[str, Any]) -> dict[int, Path]:
    """Public wrapper: best MP4 path per take number."""
    return _index_take_files(project)


def project_takes_editor_info(project: dict[str, Any], project_id: str | None = None) -> list[dict[str, Any]]:
    """Per-take media + cascade metadata for the in-video take editor."""
    from .continuity.cascade import cascade_ns

    takes = list(project.get("takes") or [])
    state = project.get("runner_state")
    if state is None and project_id:
        state = db.get_runner_state(project_id)
    completed = {int(x) for x in ((state or {}).get("completed") or [])}
    indexed = _index_take_files(project)
    pid = project_id or project.get("id")
    rows: list[dict[str, Any]] = []
    for take in sorted(takes, key=lambda t: int(t.get("n") or 0)):
        n = int(take.get("n") or 0)
        if not n:
            continue
        path = indexed.get(n)
        try:
            cascade = cascade_ns(takes, n)
        except ValueError:
            cascade = [n]
        clip_url = None
        if path and path.is_file():
            # Dedicated project clip route avoids exposing raw filesystem paths in the UI.
            clip_url = f"/api/projects/{pid}/takes/{n}/clip" if pid else None
        rows.append({
            "n": n,
            "kind": take.get("kind"),
            "session": take.get("session"),
            "duration": take.get("duration"),
            "title": take.get("title"),
            "seed": take.get("seed"),
            "prefix": take.get("prefix"),
            "prompt": take.get("prompt"),
            "completed": n in completed,
            "has_clip": bool(path and path.is_file()),
            "clip_url": clip_url,
            "cascade_ns": cascade,
        })
    return rows


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

    ready = _completed_project(project)
    takes = project.get("takes") or []
    if len(ready.get("takes") or []) != len(takes):
        raise RuntimeError("A geração ainda não terminou. Use o preview parcial dos takes concluídos.")
    indexed = _index_take_files(ready)
    expected: dict[str, int] = {}
    for take in takes:
        key = str(take.get("session") or "_default") if project_is_continuity_full(project) else str(take['n'])
        expected[key] = max(expected.get(key, 0), int(take['n']))
    missing = sorted(n for n in expected.values() if n not in indexed)
    if missing:
        raise RuntimeError(f"Faltam arquivos Full para os takes finais: {missing}")

    if not force:
        existing = resolve_master_path(project)
        # only reuse if it's clearly a master file, not a random take fallback
        if existing and "master" in existing.name.lower():
            info = project_master_info(project_id)
            return {**info, "built": False, "clips": []}

    continuity = project_is_continuity_full(project)
    clips = collect_take_clips(ready)
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
    out_path = concat_master(clips, out_path)

    stats = dict(project.get("stats") or {})
    stats["master"] = str(out_path)
    stats["master_clips"] = [c.name for c in clips]
    stats["master_mode"] = mode
    db.update_project(project_id, stats=stats)

    # Refresh poster off the library critical path (SFW only; NSFW returns None)
    try:
        from .posters import ensure_poster

        ensure_poster(project_id, force=True)
    except Exception:
        poster = PROJECTS_DIR / project_id / "poster.jpg"
        if poster.exists():
            try:
                poster.unlink()
            except OSError:
                pass

    return {
        "has_master": True,
        "master_url": project_master_info(project_id)["master_url"],
        "master_path": str(out_path),
        "built": True,
        "clips": [c.name for c in clips],
        "clip_count": len(clips),
        "mode": mode,
        "continuity_full": continuity,
    }


def _completed_project(project: dict[str, Any]) -> dict[str, Any]:
    """Only confirmed takes may be read while ComfyUI is still writing its next export."""
    state = db.get_runner_state(project['id'])
    if 'completed' not in state:
        if project.get('status') in {'generating', 'queued', 'paused', 'awaiting_review'}:
            return {**project, 'takes': []}
        return project
    completed = {int(n) for n in state['completed']}
    return {**project, 'takes': [t for t in project.get('takes') or [] if int(t['n']) in completed]}


def _preview_sources(project: dict[str, Any]) -> list[Path]:
    ready = _completed_project(project)
    if not ready.get('takes'):
        return []
    return collect_take_clips(ready)


def _source_version(clips: list[Path]) -> str:
    signature = [(str(p.resolve()), p.stat().st_size, p.stat().st_mtime_ns) for p in clips]
    return hashlib.sha256(repr(signature).encode()).hexdigest()[:16]


def project_preview_info(project: dict[str, Any]) -> dict[str, Any]:
    clips = _preview_sources(project)
    if not clips:
        return {'has_preview': False, 'preview_url': None}
    version = _source_version(clips)
    return {'has_preview': True, 'preview_url': f"/api/projects/{project['id']}/preview?v={version}"}


def build_preview(project_id: str, version: str | None = None) -> Path:
    """Immutable snapshots, one final Full per completed session; never persist as master."""
    from .continuity.runner import concat_master

    project = db.get_project(project_id)
    if not project:
        raise RuntimeError('Projeto não encontrado')
    directory = PROJECTS_DIR / project_id / 'preview'
    with _preview_lock:
        if version and re.fullmatch(r'[0-9a-f]{16}', version):
            cached = directory / f'preview_{version}.mp4'
            if cached.is_file():
                return cached
        clips = _preview_sources(project)
        if not clips:
            raise RuntimeError('Nenhum take concluído disponível para preview')
        version = _source_version(clips)
        cached = directory / f'preview_{version}.mp4'
        if cached.is_file():
            return cached
        directory.mkdir(parents=True, exist_ok=True)
        temporary = directory / f'preview_{version}.partial.mp4'
        temporary = concat_master(clips, temporary)
        temporary.replace(cached)
        return cached
