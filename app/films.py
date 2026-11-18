"""Independent film assembly: stitch completed project masters into one cut."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from . import db
from .config import FILMS_DIR, PROJECTS_DIR, ensure_dirs
from .continuity.runner import concat_master
from .masters import resolve_master_path


def _normalize_scenes(scenes: list[Any] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in scenes or []:
        if not isinstance(item, dict):
            continue
        project_id = str(item.get("project_id") or "").strip()
        if not project_id:
            continue
        scene_id = str(item.get("id") or uuid.uuid4())
        out.append({"id": scene_id, "project_id": project_id})
    return out


def enrich_scene(scene: dict[str, Any]) -> dict[str, Any]:
    project_id = scene.get("project_id")
    project = db.get_project(project_id) if project_id else None
    row = dict(scene)
    if not project:
        row.update({
            "title": "(vídeo removido)",
            "slug": None,
            "has_master": False,
            "poster_url": None,
            "master_url": None,
            "width": None,
            "height": None,
            "missing": True,
        })
        return row
    master = resolve_master_path(project)
    has_master = bool(master and master.is_file())
    poster_file = PROJECTS_DIR / project_id / "poster.jpg" if project_id else None
    try:
        has_poster = bool(poster_file and poster_file.is_file() and poster_file.stat().st_size > 0)
        poster_ver = int(poster_file.stat().st_mtime) if has_poster else None
    except OSError:
        has_poster = False
        poster_ver = None
    row.update({
        "title": project.get("title") or project.get("slug") or project_id,
        "slug": project.get("slug"),
        "has_master": has_master,
        "has_poster": has_poster,
        "poster_version": poster_ver,
        "poster_url": (
            f"/api/projects/{project_id}/poster?v={poster_ver}"
            if has_poster and poster_ver
            else (f"/api/projects/{project_id}/poster" if has_master else None)
        ),
        "master_url": f"/api/projects/{project_id}/master" if has_master else None,
        "width": project.get("width"),
        "height": project.get("height"),
        "missing": False,
        "status": project.get("status"),
    })
    return row


def enrich_film(film: dict[str, Any] | None) -> dict[str, Any] | None:
    if not film:
        return None
    scenes = [enrich_scene(s) for s in _normalize_scenes(film.get("scenes"))]
    out = dict(film)
    out["scenes"] = scenes
    out["scene_count"] = len(scenes)
    out_path = film.get("output_path")
    has_output = bool(out_path and Path(out_path).is_file())
    out["has_output"] = has_output
    out["output_url"] = f"/api/films/{film['id']}/output" if has_output else None
    return out


def list_films_enriched() -> list[dict[str, Any]]:
    return [enrich_film(f) for f in db.list_films()]  # type: ignore[misc]


def get_film_enriched(film_id: str) -> dict[str, Any] | None:
    return enrich_film(db.get_film(film_id))


def create_film(title: str, notes: str = "", scenes: list[Any] | None = None) -> dict[str, Any]:
    film = db.create_film({
        "title": (title or "").strip() or "Sem título",
        "notes": notes or "",
        "scenes": _normalize_scenes(scenes),
        "status": "draft",
    })
    return enrich_film(film)  # type: ignore[return-value]


def update_film(
    film_id: str,
    *,
    title: str | None = None,
    notes: str | None = None,
    scenes: list[Any] | None = None,
) -> dict[str, Any] | None:
    fields: dict[str, Any] = {}
    if title is not None:
        fields["title"] = title.strip() or "Sem título"
    if notes is not None:
        fields["notes"] = notes
    if scenes is not None:
        fields["scenes"] = _normalize_scenes(scenes)
        fields["status"] = "draft"
        fields["error"] = None
    film = db.update_film(film_id, **fields)
    return enrich_film(film)


def delete_film(film_id: str) -> bool:
    film = db.get_film(film_id)
    if not film:
        return False
    out_path = film.get("output_path")
    if out_path:
        path = Path(out_path)
        try:
            if path.is_file():
                path.unlink()
        except OSError:
            pass
        try:
            parent = path.parent
            if parent.is_dir() and parent != FILMS_DIR and not any(parent.iterdir()):
                parent.rmdir()
        except OSError:
            pass
    return db.delete_film(film_id)


def resolve_film_output(film: dict[str, Any]) -> Path | None:
    path = film.get("output_path")
    if not path:
        return None
    p = Path(path)
    return p if p.is_file() else None


def build_film(film_id: str) -> dict[str, Any]:
    """Concatenate scene masters into data/films/<slug>/film.mp4."""
    ensure_dirs()
    film = db.get_film(film_id)
    if not film:
        raise RuntimeError("Projeto (filme) não encontrado")

    scenes = _normalize_scenes(film.get("scenes"))
    if not scenes:
        raise RuntimeError("Adicione pelo menos uma cena antes de montar o filme")

    clips: list[Path] = []
    missing: list[str] = []
    for scene in scenes:
        project = db.get_project(scene["project_id"])
        if not project:
            missing.append(scene["project_id"])
            continue
        master = resolve_master_path(project)
        if not master or not master.is_file():
            missing.append(project.get("title") or project.get("slug") or scene["project_id"])
            continue
        clips.append(master)

    if missing:
        raise RuntimeError(f"Cenas sem master disponível: {', '.join(missing)}")
    if not clips:
        raise RuntimeError("Nenhum master encontrado para montar o filme")

    slug = film.get("slug") or film_id
    out_dir = FILMS_DIR / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "film.mp4"

    db.update_film(film_id, status="building", error=None)
    try:
        result = concat_master(clips, out_path)
        db.update_film(
            film_id,
            status="ready",
            output_path=str(result),
            error=None,
            scenes=scenes,
        )
    except Exception as exc:
        db.update_film(film_id, status="failed", error=str(exc))
        raise

    enriched = get_film_enriched(film_id)
    assert enriched is not None
    return {**enriched, "built": True, "clips": len(clips)}
