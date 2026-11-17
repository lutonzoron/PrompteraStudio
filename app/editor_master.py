"""Export timeline mix (mute takes + audio beds) as a new master version."""

from __future__ import annotations

import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

from . import db
from .config import DELIVERABLES_DIR, PROJECTS_DIR
from .editor_crop import ffmpeg_crop_filter, normalize_crop
from .masters import build_master, project_master_info, resolve_master_path


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg não está no PATH")
    return exe


def _ffprobe() -> str:
    exe = shutil.which("ffprobe")
    if not exe:
        raise RuntimeError("ffprobe não está no PATH")
    return exe


def _probe_duration(path: Path) -> float:
    proc = subprocess.run(
        [
            _ffprobe(),
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError("Não foi possível ler a duração do master")
    data = json.loads(proc.stdout or "{}")
    return float((data.get("format") or {}).get("duration") or 0.0)


def _probe_size(path: Path) -> tuple[int, int]:
    proc = subprocess.run(
        [
            _ffprobe(),
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError("Não foi possível ler o tamanho do master")
    streams = (json.loads(proc.stdout or "{}").get("streams") or [{}])
    width = int(streams[0].get("width") or 0)
    height = int(streams[0].get("height") or 0)
    if width < 2 or height < 2:
        raise RuntimeError("Dimensões do master inválidas")
    return width, height


def _has_audio_stream(path: Path) -> bool:
    proc = subprocess.run(
        [
            _ffprobe(),
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    return bool((proc.stdout or "").strip())


def _take_segments(takes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cursor = 0.0
    rows = []
    for take in sorted(takes, key=lambda t: int(t.get("n") or 0)):
        n = int(take.get("n") or 0)
        if not n:
            continue
        duration = max(0.5, float(take.get("duration") or 5))
        rows.append({"n": n, "start": cursor, "end": cursor + duration, "duration": duration})
        cursor += duration
    return rows


def _versions_dir(project: dict[str, Any]) -> Path:
    slug = project.get("slug") or project["id"]
    path = DELIVERABLES_DIR / slug / "versions"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _editor_audio_dir(project_id: str) -> Path:
    return PROJECTS_DIR / project_id / "editor"


def list_master_versions(project: dict[str, Any]) -> list[dict[str, Any]]:
    stats = project.get("stats") or {}
    versions = list(stats.get("master_versions") or [])
    current = resolve_master_path(project)
    current_rp = None
    if current and current.is_file():
        try:
            current_rp = str(current.resolve())
        except OSError:
            current_rp = str(current)
    out = []
    for row in versions:
        item = dict(row)
        path = Path(item.get("path") or "")
        item["exists"] = path.is_file()
        item["url"] = f"/api/projects/{project['id']}/master-versions/{item['id']}"
        try:
            item["is_current"] = bool(current_rp and path.is_file() and str(path.resolve()) == current_rp)
        except OSError:
            item["is_current"] = False
        out.append(item)
    out.sort(key=lambda r: float(r.get("created_at") or 0), reverse=True)
    return out


def _save_versions(project_id: str, versions: list[dict[str, Any]], *, master_path: Path | None = None) -> dict[str, Any]:
    project = db.get_project(project_id)
    if not project:
        raise RuntimeError("Projeto não encontrado")
    stats = dict(project.get("stats") or {})
    # persist without derived fields
    clean = []
    for row in versions:
        clean.append({
            "id": row["id"],
            "path": row["path"],
            "created_at": row["created_at"],
            "label": row.get("label") or "Master",
            "kind": row.get("kind") or "export",
            "note": row.get("note") or "",
            "muted_takes": list(row.get("muted_takes") or []),
            "audio_clip_ids": list(row.get("audio_clip_ids") or []),
        })
    stats["master_versions"] = clean[-40:]  # keep last 40
    if master_path is not None:
        if not stats.get("original_master") and stats.get("master"):
            # preserve first known master as original for footage tools
            prev = Path(str(stats["master"]))
            if prev.is_file():
                stats["original_master"] = str(prev)
        stats["master"] = str(master_path)
        stats["master_built_at"] = time.time()
        stats["master_kind"] = "editor_mix"
    updated = db.update_project(project_id, stats=stats)
    # drop stale poster
    poster = PROJECTS_DIR / project_id / "poster.jpg"
    try:
        poster.unlink(missing_ok=True)
    except OSError:
        pass
    return updated or project


def ensure_base_master(project_id: str) -> Path:
    project = db.get_project(project_id)
    if not project:
        raise RuntimeError("Projeto não encontrado")
    path = resolve_master_path(project)
    if path and path.is_file():
        return path
    built = build_master(project_id, force=True)
    path = Path(built["master_path"])
    if not path.is_file():
        raise RuntimeError("Não foi possível montar o master base")
    return path


def build_editor_master(project_id: str, *, label: str | None = None) -> dict[str, Any]:
    """Render current editor mix on top of the master and archive a version."""
    project = db.get_project(project_id)
    if not project:
        raise RuntimeError("Projeto não encontrado")
    if project.get("status") not in {"done", "failed"}:
        # still allow if master exists
        if not resolve_master_path(project):
            raise RuntimeError("Conclua a geração dos takes antes de exportar o mix")

    source = ensure_base_master(project_id)
    project = db.get_project(project_id) or project
    mix = dict((project.get("stats") or {}).get("editor_mix") or {})
    muted = {int(n) for n in (mix.get("muted_takes") or []) if int(n) > 0}
    clips = [c for c in (mix.get("audio_clips") or []) if isinstance(c, dict) and c.get("id")]
    # migrate legacy single bed
    if not clips and mix.get("audio_name"):
        clips = [{
            "id": "legacy",
            "file": mix["audio_name"],
            "offset_sec": float(mix.get("audio_offset_sec") or 0),
            "volume": float(mix.get("audio_volume") if mix.get("audio_volume") is not None else 0.7),
        }]

    segments = _take_segments(project.get("takes") or [])
    mute_ranges = [(s["start"], s["end"]) for s in segments if s["n"] in muted]

    version_id = uuid.uuid4().hex[:10]
    out_dir = _versions_dir(project)
    out_path = out_dir / f"master_{time.strftime('%Y%m%d_%H%M%S')}_{version_id}.mp4"

    audio_inputs: list[Path] = []
    audio_meta: list[dict[str, Any]] = []
    for clip in clips:
        file_name = clip.get("file")
        if not file_name and clip.get("id") == "legacy":
            file_name = mix.get("audio_name")
        if not file_name:
            continue
        path = _editor_audio_dir(project_id) / str(file_name)
        if not path.is_file():
            continue
        audio_inputs.append(path)
        audio_meta.append({
            "id": clip.get("id"),
            "offset_sec": float(clip.get("offset_sec") or 0),
            "volume": float(clip.get("volume") if clip.get("volume") is not None else 0.7),
        })

    duration = _probe_duration(source)
    has_video_audio = _has_audio_stream(source)
    crop = normalize_crop(mix.get("crop"))
    needs_video_filter = bool(crop)

    # Plain snapshot when nothing in the mix changed.
    if not needs_video_filter and not mute_ranges and not audio_meta:
        shutil.copy2(source, out_path)
    else:
        filters: list[str] = []
        video_map = "0:v:0"
        if crop:
            width, height = _probe_size(source)
            filters.append(f"[0:v]{ffmpeg_crop_filter(crop, width, height)}[vout]")
            video_map = "[vout]"

        mix_labels: list[str] = []
        if has_video_audio:
            vol = "[0:a]"
            if mute_ranges:
                for i, (start, end) in enumerate(mute_ranges):
                    out = f"[va{i}]"
                    filters.append(
                        f"{vol}volume=0:enable='between(t,{start:.3f},{end:.3f})'{out}"
                    )
                    vol = out
            filters.append(
                f"{vol}aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[basea]"
            )
        else:
            filters.append(
                f"anullsrc=r=48000:cl=stereo,atrim=0:{max(0.1, duration):.3f},asetpts=N/SR/TB[basea]"
            )
        mix_labels.append("[basea]")

        for i, meta in enumerate(audio_meta):
            delay_ms = max(0, int(round(float(meta["offset_sec"]) * 1000)))
            vol = max(0.0, min(1.0, float(meta["volume"])))
            filters.append(
                f"[{i + 1}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,"
                f"adelay={delay_ms}|{delay_ms},volume={vol:.3f}[bed{i}]"
            )
            mix_labels.append(f"[bed{i}]")

        if len(mix_labels) == 1:
            filters.append(f"{mix_labels[0]}anull[aout]")
        else:
            filters.append(
                f"{''.join(mix_labels)}amix=inputs={len(mix_labels)}:duration=first:dropout_transition=0:normalize=0[aout]"
            )

        cmd = [_ffmpeg(), "-y", "-i", str(source)]
        for path in audio_inputs:
            cmd.extend(["-i", str(path)])
        video_codec = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"] if needs_video_filter else ["-c:v", "copy"]
        cmd.extend([
            "-filter_complex", ";".join(filters),
            "-map", video_map, "-map", "[aout]",
            *video_codec,
            "-c:a", "aac", "-b:a", "192k",
            "-shortest", "-movflags", "+faststart",
            str(out_path),
        ])
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=max(180, duration * 6 + 60))
        if proc.returncode != 0:
            # Always re-encode video if stream copy + filters failed.
            cmd_re = [_ffmpeg(), "-y", "-i", str(source)]
            for path in audio_inputs:
                cmd_re.extend(["-i", str(path)])
            cmd_re.extend([
                "-filter_complex", ";".join(filters),
                "-map", video_map, "-map", "[aout]",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                "-c:a", "aac", "-b:a", "192k",
                "-shortest", "-movflags", "+faststart",
                str(out_path),
            ])
            proc2 = subprocess.run(cmd_re, capture_output=True, text=True, timeout=max(180, duration * 6 + 60))
            if proc2.returncode != 0:
                raise RuntimeError(
                    "Falha ao exportar master do editor: "
                    + ((proc2.stderr or proc.stderr or "")[-1500:])
                )

    if not out_path.is_file():
        raise RuntimeError("Exportação do master não gerou arquivo")

    version = {
        "id": version_id,
        "path": str(out_path),
        "created_at": time.time(),
        "label": (label or "Mix da timeline").strip() or "Mix da timeline",
        "kind": "editor_mix",
        "note": "",
        "muted_takes": sorted(muted),
        "audio_clip_ids": [str(m["id"]) for m in audio_meta if m.get("id")],
        "crop": crop,
    }
    versions = list((project.get("stats") or {}).get("master_versions") or [])
    versions.append(version)
    updated = _save_versions(project_id, versions, master_path=out_path)
    info = project_master_info(project_id)
    return {
        "ok": True,
        "built": True,
        "version": {**version, "url": f"/api/projects/{project_id}/master-versions/{version_id}", "is_current": True},
        "master_versions": list_master_versions(updated),
        "master_url": info.get("master_url"),
        "has_master": info.get("has_master"),
        "project": updated,
    }


def restore_master_version(project_id: str, version_id: str) -> dict[str, Any]:
    project = db.get_project(project_id)
    if not project:
        raise RuntimeError("Projeto não encontrado")
    versions = list((project.get("stats") or {}).get("master_versions") or [])
    match = next((v for v in versions if str(v.get("id")) == str(version_id)), None)
    if not match:
        raise RuntimeError("Versão não encontrada")
    path = Path(match["path"])
    if not path.is_file():
        raise RuntimeError("Arquivo da versão não existe mais no disco")

    # Copy into canonical master.mp4 for stable download URL, keep version file too.
    slug = project.get("slug") or project_id
    canonical = DELIVERABLES_DIR / slug / "master.mp4"
    canonical.parent.mkdir(parents=True, exist_ok=True)
    tmp = canonical.with_suffix(".restoring.mp4")
    shutil.copy2(path, tmp)
    try:
        tmp.replace(canonical)
        active = canonical
    except PermissionError:
        active = path

    updated = _save_versions(project_id, versions, master_path=active)
    info = project_master_info(project_id)
    return {
        "ok": True,
        "restored": version_id,
        "master_url": info.get("master_url"),
        "has_master": info.get("has_master"),
        "master_versions": list_master_versions(updated),
        "project": updated,
    }
