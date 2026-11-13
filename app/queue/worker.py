from __future__ import annotations

import asyncio
import time
from typing import Any

from .. import db
from ..continuity.runner import ContinuityRunner
from ..cost import energy_kwh, cost_brl, load_or_detect_profile
from ..events import broadcast
from ..external_sync import cancel_jobs_for_project, is_external_project

_worker_task: asyncio.Task | None = None
_pause = asyncio.Event()
_pause.set()  # running when set
_review_futures: dict[str, asyncio.Future] = {}
_session_locks: set[str] = set()


async def start_worker() -> None:
    global _worker_task
    db.recover_orphaned_jobs()
    db.ensure_jobs_for_queued_projects()
    if _worker_task and not _worker_task.done():
        return
    _worker_task = asyncio.create_task(_loop(), name="promptera-worker")


def pause_worker() -> None:
    _pause.clear()
    # Mark active generating projects so the dock shows Pausado (user intent).
    active = db.active_job()
    if active and active.get("project_id"):
        db.update_project(active["project_id"], status="paused")
        db.update_job(active["id"], status="paused", message="Pausado pelo usuário")


def resume_worker() -> None:
    db.requeue_paused()
    db.ensure_jobs_for_queued_projects()
    _pause.set()


async def enqueue_generation(project_id: str, priority: int = 100) -> dict[str, Any]:
    project = db.get_project(project_id)
    if not project:
        raise RuntimeError("Projeto não encontrado")
    takes = project.get("takes") or []
    if not takes:
        raise RuntimeError("Projeto sem takes — gere a história primeiro")
    # assign queue position
    queued = db.queued_projects()
    pos = (max((p.get("queue_pos") or 0) for p in queued) + 1) if queued else 1
    db.update_project(project_id, status="queued", queue_pos=pos, error=None)
    job = db.enqueue_job(project_id, "generate_video", {}, priority=priority)
    await broadcast({"type": "job_queued", "job": job, "project_id": project_id})
    return job


async def submit_review(project_id: str, decision: str) -> dict[str, Any]:
    if decision not in {"approve", "reject"}:
        raise RuntimeError("decision deve ser approve|reject")
    fut = _review_futures.get(project_id)
    if not fut or fut.done():
        raise RuntimeError("Nenhuma revisão pendente para este projeto")
    fut.set_result(decision)
    await broadcast(
        {"type": "review_submitted", "project_id": project_id, "decision": decision}
    )
    return {"ok": True, "decision": decision}


async def _wait_review(payload: dict[str, Any]) -> str:
    project_id = payload["project_id"]
    loop = asyncio.get_event_loop()
    fut: asyncio.Future = loop.create_future()
    _review_futures[project_id] = fut
    job = db.active_job()
    if job:
        db.update_job(
            job["id"],
            status="awaiting_review",
            message=f"Aguardando revisão take {payload.get('take')}",
        )
    await broadcast({"type": "review_needed", **payload})
    try:
        decision = await fut
        return str(decision)
    finally:
        _review_futures.pop(project_id, None)
        if job:
            db.update_job(job["id"], status="running", message="Retomando…")


async def _loop() -> None:
    while True:
        try:
            await _pause.wait()
            job = db.next_queued_job()
            if not job:
                await asyncio.sleep(1.0)
                continue
            await _run_job(job)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await broadcast({"type": "worker_error", "error": str(exc)})
            await asyncio.sleep(2.0)


async def _run_job(job: dict[str, Any]) -> None:
    jid = job["id"]
    project_id = job["project_id"]
    project = db.get_project(project_id)
    if not project:
        db.update_job(jid, status="failed", message="Projeto sumiu", finished_at=time.time())
        return

    # External Continuity runners own ComfyUI — never compete with them.
    if is_external_project(project):
        db.update_job(
            jid,
            status="cancelled",
            message="Projeto externo — sincronizado pelo runner fora do Promptera",
            finished_at=time.time(),
        )
        cancel_jobs_for_project(project_id)
        await broadcast(
            {
                "type": "job_cancelled",
                "job_id": jid,
                "project_id": project_id,
                "reason": "external_runner",
            }
        )
        return

    # session lock
    sessions = {t.get("session") for t in (project.get("takes") or []) if t.get("session")}
    conflict = sessions & _session_locks
    if conflict:
        db.update_job(
            jid,
            message=f"Aguardando lock de session: {', '.join(sorted(conflict))}",
        )
        await asyncio.sleep(3.0)
        return

    for s in sessions:
        _session_locks.add(s)

    started = time.time()
    db.update_job(jid, status="running", started_at=started, progress=0, message="Iniciando…")
    db.update_project(project_id, status="generating", error=None)
    await broadcast({"type": "job_started", "job_id": jid, "project_id": project_id})

    async def on_progress(msg: str, pct: float, extra: dict | None = None) -> None:
        db.update_job(jid, progress=pct, message=msg)
        await broadcast(
            {
                "type": "job_progress",
                "job_id": jid,
                "project_id": project_id,
                "progress": pct,
                "message": msg,
                "extra": extra or {},
            }
        )

    try:
        runner = ContinuityRunner(
            project,
            on_progress=on_progress,
            wait_review=_wait_review if project.get("review_mode") == "com_revisao" else None,
        )
        # refresh project each time in case takes/seeds updated during reject
        async def wait_review_refresh(payload: dict[str, Any]) -> str:
            return await _wait_review(payload)

        if project.get("review_mode") == "com_revisao":
            runner.wait_review = wait_review_refresh

        result = await runner.run_all()
        finished = time.time()
        elapsed = finished - started
        profile = load_or_detect_profile()
        kwh = energy_kwh(elapsed, float(profile.get("watts") or 150))
        brl = cost_brl(kwh, float(profile.get("tariff_brl_per_kwh") or 0.96))
        stats = dict(project.get("stats") or {})
        stats.update(
            {
                "videos_sec": round(elapsed, 1),
                "energy_kwh": round(kwh, 4),
                "cost_brl": round(brl, 2),
                "master": result.get("master"),
            }
        )
        db.update_job(
            jid,
            status="done",
            progress=100,
            message="Concluído",
            finished_at=finished,
            duration_sec=elapsed,
        )
        db.update_project(
            project_id,
            status="done",
            queue_pos=None,
            stats=stats,
            review_take=None,
        )
        await broadcast(
            {
                "type": "job_done",
                "job_id": jid,
                "project_id": project_id,
                "result": result,
                "stats": stats,
            }
        )
    except Exception as exc:
        db.update_job(
            jid,
            status="failed",
            message=str(exc),
            finished_at=time.time(),
        )
        db.update_project(project_id, status="failed", error=str(exc))
        await broadcast(
            {
                "type": "job_failed",
                "job_id": jid,
                "project_id": project_id,
                "error": str(exc),
            }
        )
    finally:
        for s in sessions:
            _session_locks.discard(s)
