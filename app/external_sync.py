"""Sync projects driven by external Continuity runners (outside Promptera worker)."""
from __future__ import annotations

import asyncio
import json
import shutil
import time
from pathlib import Path
from typing import Any

from . import db
from .config import DELIVERABLES_DIR
from .events import broadcast

SOURCE_ROOT = Path(r"C:\Projetos\teste comfyui nsfw")
COMFY_VIDEO = Path(r"C:\Projetos\Comfyui\output\video")


def is_external_project(project: dict[str, Any] | None) -> bool:
    if not project:
        return False
    stats = project.get("stats") or {}
    if stats.get("external_runner"):
        return True
    state = db.get_runner_state(project["id"])
    return bool(state.get("external"))


def cancel_jobs_for_project(project_id: str, message: str = "Externo — worker não executa") -> int:
    n = 0
    for j in db.list_jobs(50):
        if j.get("project_id") != project_id:
            continue
        if j.get("status") in {"queued", "running", "paused", "awaiting_review"}:
            db.update_job(
                j["id"],
                status="cancelled",
                message=message,
                finished_at=time.time(),
            )
            n += 1
    return n


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _log_has_marker(log_path: Path, markers: list[str]) -> bool:
    if not log_path.exists() or not markers:
        return False
    try:
        text = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    return any(m in text for m in markers)


def _copy_clips(slug: str, src_names: list[str] | None = None) -> list[str]:
    dst = DELIVERABLES_DIR / slug
    dst.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    sources = [
        SOURCE_ROOT / "deliverables" / slug,
        COMFY_VIDEO / slug,
    ]
    for src in sources:
        if not src.exists():
            continue
        for f in sorted(src.glob("*.mp4")):
            if src_names and f.name not in src_names and not any(
                f.name.startswith(n) for n in (src_names or [])
            ):
                # still copy masters / audio takes
                if "master" not in f.name.lower() and "_audio" not in f.name and not f.name.startswith("t"):
                    continue
            try:
                shutil.copy2(f, dst / f.name)
                copied.append(f.name)
            except OSError:
                pass
    return copied


def _completed_from_deliverables(slug: str, take_ns: list[int]) -> set[int]:
    """Infer finished takes from copied/local mp4 names (t01_*, t02_*, …)."""
    import re

    found: set[int] = set()
    roots = [
        DELIVERABLES_DIR / slug,
        SOURCE_ROOT / "deliverables" / slug,
        COMFY_VIDEO / slug,
    ]
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
            if n in take_ns:
                found.add(n)
    return found


def sync_project_from_external(project: dict[str, Any]) -> dict[str, Any] | None:
    """Update status/progress from external state file. Returns change summary or None."""
    stats = dict(project.get("stats") or {})
    if not stats.get("external_runner"):
        return None

    state_path = Path(stats.get("external_state_path") or "")
    log_path = Path(stats.get("external_log_path") or "")
    markers = list(stats.get("external_done_markers") or [])
    slug = project["slug"]
    takes = project.get("takes") or []
    take_ns = [int(t.get("n") or 0) for t in takes if int(t.get("n") or 0) > 0]
    total = len(takes)
    prev_status = project.get("status")

    # Draft/archived: only refresh runner completed counts — never re-queue.
    passive = prev_status in {"draft", "archived", "done"}

    if not state_path:
        return None

    st = _read_json(state_path)
    completed = set(int(x) for x in (st.get("completed") or []))
    # Also pick up takes present on disk (state file can lag behind Comfy)
    completed |= _completed_from_deliverables(slug, take_ns or list(range(1, 33)))
    completed = sorted(completed)
    done_all = bool(completed) and total > 0 and len(completed) >= total
    if not done_all and markers and _log_has_marker(log_path, markers):
        done_all = True
        if total and not completed:
            completed = list(range(1, total + 1))

    current_take = None
    if not done_all and take_ns:
        for n in take_ns:
            if n not in set(completed):
                current_take = n
                break

    prev = db.get_runner_state(project["id"])
    prev_done = sorted({int(x) for x in (prev.get("completed") or [])})
    prev_last_ok = prev.get("last_ok") if isinstance(prev.get("last_ok"), dict) else None
    new_last_ok = st.get("last_ok") if isinstance(st.get("last_ok"), dict) else None
    if completed != prev_done and new_last_ok:
        try:
            from .cost import record_take_interval_from_state

            finished_n = None
            if new_last_ok.get("n") is not None:
                finished_n = int(new_last_ok["n"])
            take_meta = next((t for t in takes if int(t.get("n") or 0) == finished_n), None)
            record_take_interval_from_state(prev_last_ok, new_last_ok, take_meta)
        except Exception:
            pass

    take_started_at = prev.get("take_started_at")
    # Only reset the wall clock when this project advances to a new take.
    # Idle queued projects must not get a fake "started now" stamp.
    if current_take and current_take != prev.get("current_take"):
        take_started_at = time.time()
    elif not current_take:
        take_started_at = None

    db.save_runner_state(
        project["id"],
        {
            **prev,
            "completed": completed,
            "last_ok": st.get("last_ok"),
            "current_take": current_take,
            "take_started_at": take_started_at,
            "external": True,
            "synced_at": time.time(),
        },
    )

    if passive and not done_all:
        if completed != prev_done:
            return {
                "slug": slug,
                "status": prev_status,
                "completed": completed,
                "total": total,
                "prev_status": prev_status,
                "passive": True,
            }
        return None

    waiting_for = stats.get("waiting_for")
    if waiting_for and not passive:
        dep = db.get_project_by_slug(str(waiting_for))
        if dep and dep.get("status") != "done":
            if prev_status != "queued":
                db.update_project(
                    project["id"],
                    status="queued",
                    error=None,
                )
            return {"slug": slug, "status": "queued", "completed": completed, "waiting_for": waiting_for}

    clips = _copy_clips(slug)
    new_stats = {
        **stats,
        "partial_clips": clips[-8:],
        "external_synced_at": time.time(),
    }
    if clips:
        masters = [c for c in clips if "master" in c.lower()]
        new_stats["preview"] = str(DELIVERABLES_DIR / slug / (masters[-1] if masters else clips[-1]))
        if masters:
            new_stats["master"] = str(DELIVERABLES_DIR / slug / masters[-1])

    if done_all:
        db.update_project(
            project["id"],
            status="done",
            queue_pos=None,
            error=None,
            stats=new_stats,
        )
        status = "done"
    else:
        # Unfinished external stays queued until reconcile promotes the live one.
        # (Marking every external as generating made Lara look "ao vivo" while waiting.)
        status = "queued"
        db.update_project(
            project["id"],
            status=status,
            queue_pos=project.get("queue_pos") or 1,
            error=None,
            stats=new_stats,
        )

    if completed != prev_done or status != prev_status:
        return {
            "slug": slug,
            "status": status,
            "completed": completed,
            "total": total,
            "current_take": current_take,
            "prev_status": prev_status,
        }
    return None


def attach_external_meta(project_id: str, *, slug: str, state_name: str, log_name: str, markers: list[str], waiting_for: str | None = None, extra: dict | None = None) -> None:
    p = db.get_project(project_id)
    if not p:
        return
    stats = dict(p.get("stats") or {})
    stats.update(
        {
            "external_runner": True,
            "external_state_path": str(SOURCE_ROOT / "download_logs" / state_name),
            "external_log_path": str(SOURCE_ROOT / "download_logs" / log_name),
            "external_done_markers": markers,
            "source": f"external:{slug}",
        }
    )
    if waiting_for:
        stats["waiting_for"] = waiting_for
    if extra:
        stats.update(extra)
    db.update_project(project_id, stats=stats)
    st = db.get_runner_state(project_id)
    st["external"] = True
    if waiting_for:
        st["waiting_for"] = waiting_for
    db.save_runner_state(project_id, st)
    cancel_jobs_for_project(project_id)


def reconcile_generating_statuses(live_slug: str | None = None) -> list[dict[str, Any]]:
    """Only the project actually on Comfy (or the next ready lead) is generating."""
    changed: list[dict[str, Any]] = []
    active = [
        p
        for p in db.list_projects()
        if p.get("status") in {"generating", "queued"}
    ]
    if not active:
        return changed

    def _blocked(p: dict[str, Any]) -> bool:
        wf = (p.get("stats") or {}).get("waiting_for")
        if not wf:
            return False
        dep = db.get_project_by_slug(str(wf))
        return bool(dep and dep.get("status") != "done")

    active_id: str | None = None
    if live_slug:
        for p in active:
            if p.get("slug") == live_slug:
                active_id = str(p["id"])
                break
    if active_id is None:
        job = db.active_job()
        if job and job.get("project_id"):
            jid = str(job["project_id"])
            if any(str(p["id"]) == jid for p in active):
                active_id = jid
    if active_id is None:
        ready = [p for p in active if not _blocked(p)]
        ready.sort(key=lambda x: int(x.get("queue_pos") or 9999))
        if ready:
            active_id = str(ready[0]["id"])

    for p in active:
        if _blocked(p):
            want = "queued"
        elif active_id and str(p["id"]) == active_id:
            want = "generating"
        else:
            want = "queued"
        if p.get("status") != want:
            db.update_project(p["id"], status=want, error=None)
            changed.append(
                {
                    "slug": p.get("slug"),
                    "status": want,
                    "project_id": p["id"],
                    "reconcile": True,
                }
            )
    return changed


def sync_all_external(live_slug: str | None = None) -> list[dict[str, Any]]:
    """One-shot sync of all external_runner projects. Returns change summaries."""
    changed: list[dict[str, Any]] = []
    for p in db.list_projects():
        if not is_external_project(p):
            continue
        cancel_jobs_for_project(p["id"])
        summary = sync_project_from_external(p)
        if summary:
            changed.append({**summary, "project_id": p["id"]})
    changed.extend(reconcile_generating_statuses(live_slug))
    return changed


async def peek_comfy_queue() -> dict[str, Any]:
    try:
        from .comfy.client import ComfyClient

        return await ComfyClient().queue_snapshot()
    except Exception as exc:
        return {"online": False, "running": 0, "pending": 0, "busy": False, "error": str(exc)}


async def external_sync_loop(interval_s: float = 15.0) -> None:
    """Every ~15s: sync external state files + broadcast Comfy queue peek."""
    while True:
        try:
            comfy_q = await peek_comfy_queue()
            live_slug = None
            live = comfy_q.get("live") if isinstance(comfy_q, dict) else None
            if isinstance(live, dict):
                live_slug = live.get("slug")
            changed = sync_all_external(live_slug=live_slug)
            await broadcast({"type": "comfy_queue", **comfy_q})
            for summary in changed:
                await broadcast({"type": "external_sync", **summary})
                await broadcast({"type": "project_updated", "project_id": summary["project_id"]})
            if changed:
                await broadcast({"type": "queue_changed", "reason": "external_sync"})
        except Exception as exc:
            await broadcast({"type": "external_sync_error", "error": str(exc)})
        await asyncio.sleep(interval_s)
