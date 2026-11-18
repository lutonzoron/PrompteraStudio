from __future__ import annotations

import asyncio
import time
import secrets
import uuid
from typing import Any

import httpx

from .. import db
from ..comfy.client import ComfyClient
from ..continuity.runner import ContinuityRunner
from ..cost import energy_kwh, cost_brl, load_or_detect_profile, estimate_project
from ..events import broadcast
from ..external_sync import cancel_jobs_for_project, is_external_project

_worker_task: asyncio.Task | None = None
_pause = asyncio.Event()
_pause.set()  # running when set
_review_futures: dict[str, asyncio.Future] = {}
_session_locks: set[str] = set()
_running_tasks: dict[str, asyncio.Task] = {}
_dispatch_lock = asyncio.Lock()


async def start_worker() -> None:
    global _worker_task
    if _worker_task and not _worker_task.done():
        return
    db.recover_orphaned_jobs()
    db.ensure_jobs_for_queued_projects()
    _worker_task = asyncio.create_task(_loop(), name="promptera-worker")


async def cancel_generation(project_id: str) -> None:
    """Stop the removed project's render before dispatching another project."""
    project = db.get_project(project_id)
    if not project:
        return
    async with _dispatch_lock:
        await _stop_generation(project)
        await broadcast({'type': 'job_cancelled', 'project_id': project_id,
                         'reason': 'Removido da fila; execução cancelada'})


async def _stop_generation(project: dict[str, Any]) -> None:
    project_id = project['id']
    client = ComfyClient()
    try:
        snapshot = await client.queue_snapshot()
    except httpx.HTTPError:
        snapshot = {}
    pending = [p['prompt_id'] for p in snapshot.get('pending_items', [])
               if p.get('slug') == project['slug']]
    await client.delete_prompts(pending)
    live = snapshot.get('live') or {}
    if live.get('slug') == project['slug']:
        # Recheck ownership after deleting pending prompts; never interrupt another video.
        current = (await client.queue_snapshot()).get('live') or {}
        if current.get('prompt_id') == live.get('prompt_id'):
            await client.interrupt()
    task = _running_tasks.get(project_id)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


async def prioritize_generation(project_id: str) -> dict[str, Any]:
    from ..comfy.validation import check_runtime

    project = db.get_project(project_id)
    if not project or project.get('status') not in {'queued', 'paused', 'generating'}:
        raise RuntimeError('Só é possível priorizar um vídeo que está na fila')
    if is_external_project(project):
        raise RuntimeError('A priorização está disponível para vídeos gerenciados pelo Promptera')
    readiness = await check_runtime(project)
    if not readiness['ok']:
        raise RuntimeError('Geração bloqueada: ' + '; '.join(readiness['errors']))

    async with _dispatch_lock:
        project = db.get_project(project_id)
        if not project or project.get('status') not in {'queued', 'paused', 'generating'}:
            raise RuntimeError('O vídeo não está mais na fila')
        active = db.active_job()
        current = db.get_project(active['project_id']) if active else None
        if not current and _running_tasks:
            current = db.get_project(next(iter(_running_tasks)))
            active = next((j for j in db.jobs_for_project(current['id'])
                           if j['status'] == 'paused'), None) if current else None
        if current and current['id'] == project_id:
            return {'ok': True, 'already_active': True, 'project_id': project_id}
        if active and active.get('status') == 'awaiting_review':
            raise RuntimeError('Conclua a revisão do take atual antes de priorizar outro vídeo')

        snapshot = await ComfyClient().queue_snapshot()
        live = snapshot.get('live') or {}
        if live and (not current or live.get('slug') != current['slug']):
            raise RuntimeError('O ComfyUI está ocupado por uma execução fora do worker; ela não será interrompida')
        interrupted = None
        if current:
            await _stop_generation(current)
            # A render can complete naturally while the interrupt request is in flight.
            current = db.get_project(current['id'])
            if current and current.get('status') not in {'done', 'archived'}:
                interrupted = current['id']
                if active:
                    db.update_job(active['id'], status='queued', started_at=None, finished_at=None,
                                  message='Aguardando: outro vídeo foi priorizado')
                db.update_project(interrupted, status='queued', review_take=None,
                                  review_full_path=None, review_current_path=None)
                await broadcast({'type': 'job_preempted', 'project_id': interrupted,
                                 'message': 'Interrompido para priorização; takes concluídos preservados'})

        db.update_project(project_id, status='queued', error=None)
        jobs = [j for j in db.jobs_for_project(project_id) if j['status'] in {'queued', 'paused'}]
        if jobs:
            db.update_job(jobs[0]['id'], status='queued', message='Vídeo priorizado')
            for duplicate in jobs[1:]:
                db.update_job(duplicate['id'], status='cancelled', finished_at=time.time(),
                              message='Pedido duplicado substituído pela priorização')
        else:
            db.enqueue_job(project_id, 'generate_video', {})
        db.ensure_jobs_for_queued_projects()
        order = [project_id]
        if interrupted:
            order.append(interrupted)
        order.extend(p['id'] for p in db.queued_projects() if p['id'] not in order)
        db.set_queue_order(order)
        _pause.set()
        await broadcast({'type': 'queue_changed', 'project_id': project_id,
                         'reason': 'prioritized', 'message': 'Vídeo priorizado', 'order': order})
    await start_worker()
    return {'ok': True, 'project_id': project_id, 'interrupted_project_id': interrupted, 'order': order}


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
    if project.get('status') == 'done':
        raise RuntimeError('Vídeo concluído. Use Regerar vídeo e confirme a substituição do resultado atual.')
    takes = project.get("takes") or []
    if not takes:
        raise RuntimeError("Project has no takes — generate the story first")
    from ..comfy.validation import check_runtime
    readiness = await check_runtime(project)
    if not readiness['ok']:
        raise RuntimeError('Geração bloqueada: ' + '; '.join(readiness['errors']))
    # Explicit enqueue from UI/API = Promptera owns generation (drop external sync lock).
    stats = dict(project.get("stats") or {})
    if stats.get("external_runner"):
        stats.pop("external_runner", None)
        stats.pop("waiting_for", None)
        stats.pop("external_state_path", None)
        stats.pop("external_log_path", None)
        stats.pop("external_done_markers", None)
        stats["note"] = "Promptera worker generation (manual enqueue)"
        st = db.get_runner_state(project_id)
        st.pop("external", None)
        st.pop("waiting_for", None)
        db.save_runner_state(project_id, st)
    # assign queue position
    queued = db.queued_projects()
    pos = (max((p.get("queue_pos") or 0) for p in queued) + 1) if queued else 1
    db.update_project(
        project_id,
        status="queued",
        queue_pos=pos,
        error=None,
        stats=stats,
    )
    job = db.enqueue_job(project_id, "generate_video", {}, priority=priority)
    await broadcast({"type": "job_queued", "job": job, "project_id": project_id})
    return job


async def regenerate_generation(project_id: str) -> dict[str, Any]:
    from ..comfy.validation import check_runtime
    from ..config import PROJECTS_DIR

    project = db.get_project(project_id)
    if not project or project.get('status') != 'done':
        raise RuntimeError('Somente vídeos concluídos podem ser regerados')
    if not project.get('takes'):
        raise RuntimeError('O vídeo não possui takes para regerar')
    readiness = await check_runtime(project)
    if not readiness['ok']:
        raise RuntimeError('Geração bloqueada: ' + '; '.join(readiness['errors']))
    async with _dispatch_lock:
        project = db.get_project(project_id)
        if not project or project.get('status') != 'done':
            raise RuntimeError('O vídeo já foi alterado ou enfileirado')
        run_id = uuid.uuid4().hex[:12]
        seed_base = secrets.randbelow(2**31 - 100000)
        sessions = {}
        takes = []
        for take in project['takes']:
            session = str(take.get('session') or 'default')
            if session not in sessions:
                sessions[session] = len(sessions)
            takes.append({**take, 'session': f"regen_{project_id[:8]}_{run_id}_{sessions[session]:02d}",
                          'seed': seed_base + sessions[session],
                          'prefix': f"video/{project['slug']}/t{int(take['n']):02d}_r{run_id}"})
        queue = db.queued_projects()
        position = max((p.get('queue_pos') or 0 for p in queue), default=0) + 1
        job = db.reset_project_generation(project_id, takes, seed_base,
                                          {'generation_id': run_id, 'regenerated_at': time.time()}, position)
        try:
            (PROJECTS_DIR / project_id / 'poster.jpg').unlink(missing_ok=True)
        except OSError:
            pass
        await broadcast({'type': 'project_updated', 'project_id': project_id})
        await broadcast({'type': 'job_queued', 'project_id': project_id, 'job': job,
                         'message': 'Regeração confirmada; resultado anterior substituído e progresso reiniciado'})
        return job


async def regenerate_from_take(
    project_id: str,
    take_n: int,
    *,
    prompt: str | None = None,
) -> dict[str, Any]:
    """Regenerate take N and same-session Continuity dependents; keep other sessions."""
    from ..comfy.validation import check_runtime
    from ..config import PROJECTS_DIR
    from ..continuity.cascade import (
        cascade_from_take,
        cascade_ns,
        checkpoint_after_quarantine,
        prior_in_session,
        take_session,
    )

    project = db.get_project(project_id)
    if not project or project.get('status') not in {'done', 'failed'}:
        raise RuntimeError('Somente vídeos concluídos (ou falhos) podem regerar um take')
    takes_in = list(project.get('takes') or [])
    if not takes_in:
        raise RuntimeError('O vídeo não possui takes para regerar')
    try:
        cascade = cascade_from_take(takes_in, take_n)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc
    cascade_set = {int(t['n']) for t in cascade}
    target = cascade[0]
    kind = str(target.get('kind') or '').lower()
    session = take_session(target)
    priors = prior_in_session(takes_in, take_n)
    if kind == 'continue' and not priors:
        raise RuntimeError('Take CONTINUE sem predecessor na sessão')

    readiness = await check_runtime(project)
    if not readiness['ok']:
        raise RuntimeError('Geração bloqueada: ' + '; '.join(readiness['errors']))

    async with _dispatch_lock:
        project = db.get_project(project_id)
        if not project or project.get('status') not in {'done', 'failed'}:
            raise RuntimeError('O vídeo já foi alterado ou enfileirado')
        takes_in = list(project.get('takes') or [])
        cascade = cascade_from_take(takes_in, take_n)
        cascade_set = {int(t['n']) for t in cascade}
        target = cascade[0]
        kind = str(target.get('kind') or '').lower()
        session = take_session(target)
        priors = prior_in_session(takes_in, take_n)

        run_id = uuid.uuid4().hex[:12]
        seed_base = secrets.randbelow(2**31 - 100000)
        prev_state = db.get_runner_state(project_id) or {}
        prev_completed = {int(x) for x in (prev_state.get('completed') or [])}
        prev_checkpoints = dict(prev_state.get('session_checkpoints') or {})

        new_session = session
        if kind == 'new':
            # Restart the Continuity chain under a fresh session name.
            new_session = f"regen_{project_id[:8]}_{run_id}_s"
            checkpoint = None
            prev_checkpoints.pop(session, None)
            prev_checkpoints.pop(new_session, None)
        else:
            checkpoint = checkpoint_after_quarantine(session, keep_count=len(priors))
            if checkpoint:
                prev_checkpoints[session] = checkpoint
            else:
                prev_checkpoints.pop(session, None)

        updated_takes: list[dict[str, Any]] = []
        for take in sorted(takes_in, key=lambda t: int(t.get('n') or 0)):
            n = int(take['n'])
            row = dict(take)
            if n in cascade_set:
                row['seed'] = seed_base + (n - take_n)
                row['prefix'] = f"video/{project['slug']}/t{n:02d}_r{run_id}"
                if kind == 'new':
                    row['session'] = new_session
                if n == take_n and prompt is not None:
                    text = str(prompt).strip()
                    if not text:
                        raise RuntimeError('Prompt do take não pode ficar vazio')
                    row['prompt'] = text
            updated_takes.append(row)

        kept_completed = sorted(n for n in prev_completed if n not in cascade_set)
        # Drop checkpoints for renamed session; keep other sessions intact.
        session_checkpoints = {
            k: v for k, v in prev_checkpoints.items()
            if k != session or kind == 'continue'
        }
        if kind == 'continue' and checkpoint:
            session_checkpoints[session] = checkpoint
        elif kind == 'new':
            session_checkpoints.pop(new_session, None)

        runner_state = {
            'completed': kept_completed,
            'last_ok': kept_completed[-1] if kept_completed else None,
            'session_checkpoints': session_checkpoints,
            'partial_regen_from': take_n,
            'partial_regen_cascade': cascade_ns(updated_takes, take_n),
        }

        prev_stats = dict(project.get('stats') or {})
        prev_master = prev_stats.get('master') or prev_stats.get('original_master')
        prev_stats.pop('preview', None)
        # Keep the previous master as original so poster/CCTV restore still work
        # while the cascade regenerates. A fresh master is built when the job finishes.
        stats = {
            **prev_stats,
            'generation_id': run_id,
            'partial_regen_at': time.time(),
            'partial_from_take': take_n,
            'partial_cascade': sorted(cascade_set),
        }
        if prev_master:
            stats['original_master'] = str(prev_stats.get('original_master') or prev_master)
            stats['master'] = str(prev_master)

        queue = db.queued_projects()
        position = max((p.get('queue_pos') or 0 for p in queue), default=0) + 1
        payload = {
            'generation_id': run_id,
            'regenerate': True,
            'regenerate_from': take_n,
            'cascade': sorted(cascade_set),
        }
        job = db.partial_reset_project_generation(
            project_id, updated_takes, runner_state, stats, position, payload
        )
        # Keep / refresh the poster on partial regen — only the cascade takes are replaced.
        try:
            from ..posters import ensure_poster
            ensure_poster(project_id)
        except Exception:
            pass
        await broadcast({'type': 'project_updated', 'project_id': project_id})
        await broadcast({
            'type': 'job_queued',
            'project_id': project_id,
            'job': job,
            'message': f'Regeração parcial do take {take_n} (+continuidade da sessão)',
        })
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
        if job and not fut.cancelled():
            db.update_job(job["id"], status="running", message="Retomando…")


async def _loop() -> None:
    while True:
        try:
            await _pause.wait()
            async with _dispatch_lock:
                job = db.next_queued_job()
                task = None
                if job:
                    task = asyncio.create_task(_run_job(job), name=f"generate-{job['id']}")
                    _running_tasks[job['project_id']] = task
            if not job:
                await asyncio.sleep(1.0)
                continue
            try:
                await task
            except asyncio.CancelledError:
                if asyncio.current_task().cancelling():
                    raise
                # The child render was deliberately cancelled; keep consuming the queue.
            finally:
                if _running_tasks.get(job['project_id']) is task:
                    _running_tasks.pop(job['project_id'], None)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await broadcast({"type": "worker_error", "error": str(exc)})
            await asyncio.sleep(2.0)


async def _run_job(job: dict[str, Any]) -> None:
    jid = job["id"]
    project_id = job["project_id"]
    current = db.get_job(jid)
    if not current or current.get('status') != 'queued':
        return
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
        if (db.get_job(jid) or {}).get('status') == 'cancelled':
            raise asyncio.CancelledError()
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
        profile = load_or_detect_profile()
        initial_estimate = estimate_project(project, profile=profile, now_ts=started)
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
        if (db.get_job(jid) or {}).get('status') == 'cancelled':
            raise asyncio.CancelledError()
        finished = time.time()
        elapsed = finished - started
        kwh = energy_kwh(elapsed, float(profile.get("watts") or 150))
        brl = cost_brl(kwh, float(profile.get("tariff_brl_per_kwh") or 0.96))
        stats = dict(project.get("stats") or {})
        stats.update(
            {
                "videos_sec": round(elapsed, 1),
                "energy_kwh": round(kwh, 4),
                "cost_brl": round(brl, 2),
                "initial_estimate": initial_estimate,
                "generation_started_at": started,
                "generation_finished_at": finished,
                "watts": float(profile.get('watts') or 150),
                "tariff_brl_per_kwh": float(profile.get('tariff_brl_per_kwh') or 0.96),
                "master": result.get("master"),
            }
        )
        if result.get('original_master'):
            stats['original_master'] = result['original_master']
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
        try:
            from ..config import PROJECTS_DIR
            from ..posters import ensure_poster

            # Drop then rebuild so library ?v=mtime always changes after regen.
            (PROJECTS_DIR / project_id / "poster.jpg").unlink(missing_ok=True)
            ensure_poster(project_id, force=True)
        except Exception:
            pass
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
        if (db.get_job(jid) or {}).get('status') == 'cancelled':
            return
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
