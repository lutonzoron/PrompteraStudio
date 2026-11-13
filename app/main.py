from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db
from .comfy.client import start_comfyui
from .config import DELIVERABLES_DIR, FRONTEND_DIST, PROJECTS_DIR, ensure_dirs
from .cost import (
    apply_machine_cost,
    estimate_generation,
    estimate_project,
    estimate_queue,
    load_or_detect_profile,
)
from .events import broadcast, sse_encode, subscribe, unsubscribe
from .llm.providers import get_provider, llm_config, test_provider
from .onboarding.hardware import hardware_report
from .onboarding.setup import (
    clone_comfyui,
    clone_dasiwa,
    comfy_status,
    dependency_report,
    download_model,
    ensure_comfy_stack,
    ensure_workflows_copied,
    onboarding_status,
)
from .queue.worker import (
    enqueue_generation,
    pause_worker,
    resume_worker,
    start_worker,
    submit_review,
)
from .story.service import generate_dice_brief, generate_story, validate_takes
from .styles.service import adapt_style, duplicate_style, ensure_seed_styles
from .inbox.service import (
    INBOX_DIR,
    approve_inbox_item,
    ensure_inbox,
    list_inbox,
    reject_inbox_item,
    scan_and_import_inbox,
    import_takes_file,
)
from .posters import ensure_poster
from .masters import build_master, project_master_info, resolve_master_path
from .external_sync import external_sync_loop, peek_comfy_queue, sync_all_external

app = FastAPI(title="Promptera Studio", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _inbox_watcher() -> None:
    """Watch drop folder — notify pending packs; never auto-import (approval required)."""
    ensure_inbox()
    last_names: set[str] = set()
    while True:
        try:
            snap = list_inbox()
            pending = snap.get("pending") or []
            names = {str(p.get("name")) for p in pending}
            new_items = [p for p in pending if p.get("name") not in last_names]
            if new_items:
                await broadcast(
                    {
                        "type": "inbox_pending",
                        "count": len(pending),
                        "names": [p.get("name") for p in new_items],
                        "titles": [p.get("title") for p in new_items],
                    }
                )
            elif names != last_names:
                await broadcast({"type": "inbox_changed", "count": len(pending)})
            last_names = names
        except Exception as exc:
            await broadcast({"type": "inbox_error", "error": str(exc)})
        await asyncio.sleep(5.0)


@app.on_event("startup")
async def _startup() -> None:
    ensure_dirs()
    ensure_inbox()
    db.init_db()
    ensure_seed_styles()
    await start_worker()
    asyncio.create_task(_inbox_watcher(), name="inbox-watcher")
    asyncio.create_task(external_sync_loop(15.0), name="external-sync")


# ---------- models ----------


class LLMConfigBody(BaseModel):
    provider: str = "openai"
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None


class MachineBody(BaseModel):
    watts: float | None = None
    tariff_brl_per_kwh: float | None = None


class StyleCreateBody(BaseModel):
    description: str
    base_style_id: str | None = None
    label: str | None = None


class StyleUpdateBody(BaseModel):
    label: str | None = None
    lock_en: str | None = None
    bible_hint_pt: str | None = None
    craft_rules_en: str | None = None
    anti_drift_en: str | None = None
    negatives: str | None = None
    model_pack_hint: str | None = None
    archived: bool | None = None


class ProjectCreateBody(BaseModel):
    title: str = "Nova história"
    brief: str = ""
    style_id: str | None = None
    max_duration_sec: float = 60
    review_mode: str = "automatico"
    model_pack: str = "sfw"
    width: int = 544
    height: int = 992
    steps: int = 8
    seed_base: int = 2000


class ProjectUpdateBody(BaseModel):
    title: str | None = None
    brief: str | None = None
    style_id: str | None = None
    max_duration_sec: float | None = None
    review_mode: str | None = None
    model_pack: str | None = None
    synopsis: str | None = None
    roteiro_md: str | None = None
    takes: list[dict[str, Any]] | None = None
    width: int | None = None
    height: int | None = None
    steps: int | None = None
    seed_base: int | None = None
    queue_pos: int | None = None


class StoryGenerateBody(BaseModel):
    brief: str | None = None
    use_dice: bool = False


class ReviewBody(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")


class ReorderBody(BaseModel):
    project_ids: list[str]


# ---------- health / onboarding ----------


@app.get("/api/health")
async def health() -> dict[str, Any]:
    comfy = await comfy_status()
    return {
        "ok": True,
        "onboarding": onboarding_status(),
        "comfy": comfy,
        "machine": load_or_detect_profile(),
        "pending_reviews": len(db.projects_awaiting_review()),
    }


@app.get("/api/onboarding")
def get_onboarding() -> dict[str, Any]:
    return onboarding_status()


@app.get("/api/hardware")
def get_hardware() -> dict[str, Any]:
    return hardware_report()


@app.get("/api/machine")
def get_machine() -> dict[str, Any]:
    return load_or_detect_profile()


@app.patch("/api/machine")
def patch_machine(body: MachineBody) -> dict[str, Any]:
    return apply_machine_cost(watts=body.watts, tariff=body.tariff_brl_per_kwh)


@app.get("/api/llm")
def get_llm() -> dict[str, Any]:
    cfg = llm_config()
    return {
        "provider": cfg.get("provider"),
        "base_url": cfg.get("base_url"),
        "model": cfg.get("model"),
        "has_api_key": bool(cfg.get("api_key")),
    }


@app.put("/api/llm")
async def put_llm(body: LLMConfigBody) -> dict[str, Any]:
    cfg = llm_config()
    if body.provider:
        cfg["provider"] = body.provider
    if body.api_key is not None:
        cfg["api_key"] = body.api_key
    if body.base_url is not None:
        cfg["base_url"] = body.base_url
    if body.model is not None:
        cfg["model"] = body.model
    db.set_setting("llm", cfg)
    return await test_provider()


@app.post("/api/llm/test")
async def llm_test(body: LLMConfigBody | None = None) -> dict[str, Any]:
    cfg = body.model_dump(exclude_none=True) if body else None
    return await test_provider(cfg)


@app.get("/api/comfy/status")
async def api_comfy_status() -> dict[str, Any]:
    return await comfy_status()


@app.post("/api/comfy/start")
def api_comfy_start() -> dict[str, Any]:
    return start_comfyui()


@app.post("/api/comfy/clone")
def api_comfy_clone() -> dict[str, Any]:
    return clone_comfyui()


@app.post("/api/comfy/dasiwa")
def api_dasiwa() -> dict[str, Any]:
    return clone_dasiwa()


@app.post("/api/comfy/workflows")
def api_workflows() -> dict[str, Any]:
    copied = ensure_workflows_copied()
    return {"ok": True, "copied": copied}


@app.get("/api/comfy/deps")
def api_comfy_deps() -> dict[str, Any]:
    return dependency_report()


@app.post("/api/comfy/ensure")
def api_comfy_ensure(download_sfw: bool = False) -> dict[str, Any]:
    """Clone/install missing Comfy stack pieces; optionally download SFW models."""
    return ensure_comfy_stack(download_sfw=download_sfw)


@app.post("/api/comfy/models/{key}/download")
def api_download_model(key: str) -> dict[str, Any]:
    result = download_model(key)
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "Falha no download")
    return result


@app.put("/api/settings/comfyui_root")
def set_comfy_root(body: dict[str, str]) -> dict[str, Any]:
    path = body.get("path")
    if not path:
        raise HTTPException(400, "path obrigatório")
    db.set_setting("comfyui_root", path)
    return {"ok": True, "path": path}


# ---------- styles ----------


@app.get("/api/styles")
def api_list_styles() -> list[dict[str, Any]]:
    ensure_seed_styles()
    return db.list_styles()


@app.get("/api/styles/{style_id}")
def api_get_style(style_id: str) -> dict[str, Any]:
    s = db.get_style(style_id)
    if not s:
        raise HTTPException(404, "Estilo não encontrado")
    return s


@app.post("/api/styles/adapt")
async def api_adapt_style(body: StyleCreateBody) -> dict[str, Any]:
    try:
        return await adapt_style(
            description=body.description,
            base_style_id=body.base_style_id,
            label=body.label,
        )
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/styles/{style_id}/duplicate")
def api_dup_style(style_id: str) -> dict[str, Any]:
    try:
        return duplicate_style(style_id)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.patch("/api/styles/{style_id}")
def api_patch_style(style_id: str, body: StyleUpdateBody) -> dict[str, Any]:
    s = db.get_style(style_id)
    if not s:
        raise HTTPException(404)
    data = {**s, **body.model_dump(exclude_none=True)}
    return db.upsert_style(data)


@app.delete("/api/styles/{style_id}")
def api_archive_style(style_id: str) -> dict[str, Any]:
    db.archive_style(style_id)
    return {"ok": True}


# ---------- projects / story ----------


@app.get("/api/projects")
def api_list_projects(include_archived: bool = False) -> list[dict[str, Any]]:
    return db.list_projects(include_archived=include_archived)


@app.get("/api/queue")
async def api_queue() -> dict[str, Any]:
    items = db.queued_projects()
    enriched = []
    has_internal = False
    active_job = db.active_job()
    comfy_q = await peek_comfy_queue()
    live = (comfy_q or {}).get("live") if isinstance(comfy_q, dict) else None
    live_slug = (live or {}).get("slug") if isinstance(live, dict) else None
    live_take = (live or {}).get("take") if isinstance(live, dict) else None

    by_slug = {str(p.get("slug") or ""): p for p in items}

    # Truth = what Comfy is executing right now. Fallbacks only if Comfy idle/unknown.
    active_project_id: str | None = None
    if live_slug and live_slug in by_slug:
        active_project_id = str(by_slug[live_slug]["id"])
    elif live_slug:
        # fuzzy: slug contained / contains
        for p in items:
            slug = str(p.get("slug") or "")
            if slug and (slug in live_slug or live_slug in slug):
                active_project_id = str(p["id"])
                break
    if active_project_id is None and active_job and active_job.get("project_id"):
        # Only trust internal job if Comfy isn't clearly busy on someone else
        if not live_slug:
            active_project_id = str(active_job["project_id"])
    if active_project_id is None:
        externals = []
        for p in items:
            stats = p.get("stats") or {}
            state = db.get_runner_state(p["id"])
            external = bool(stats.get("external_runner") or state.get("external"))
            if not external or stats.get("waiting_for"):
                continue
            if p.get("status") not in {"generating", "queued"}:
                continue
            externals.append(p)
        externals.sort(key=lambda x: int(x.get("queue_pos") or 9999))
        if externals:
            active_project_id = str(externals[0]["id"])

    now: dict[str, Any] | None = None
    external_active = None

    for p in items:
        d = dict(p)
        state = db.get_runner_state(p["id"])
        stats = p.get("stats") or {}
        external = bool(stats.get("external_runner") or state.get("external"))
        takes = p.get("takes") or []
        done = set(int(x) for x in (state.get("completed") or []))
        d["external"] = external
        d["runner_state"] = state
        d["progress"] = {
            "completed": len(done),
            "total": len(takes),
            "completed_ns": sorted(done),
        }
        if not external:
            has_internal = True
        take_ns = [int(t.get("n") or 0) for t in takes if int(t.get("n") or 0) > 0]
        current_take = state.get("current_take")
        if current_take is None and take_ns:
            for n in take_ns:
                if n not in done:
                    current_take = n
                    break
        is_now = active_project_id is not None and str(p["id"]) == active_project_id
        if is_now and live_take:
            current_take = int(live_take)
        d["current_take"] = current_take
        d["is_active"] = is_now
        d["queue_role"] = "generating" if is_now else "queued"
        d["comfy_live"] = bool(is_now and live_slug)

        if is_now:
            pct = (100.0 * len(done) / len(takes)) if takes else 0.0
            # Take in flight isn't done yet — show almost-complete within current take band
            if takes and current_take and int(current_take) not in done:
                pct = min(99.0, (100.0 * len(done) / len(takes)) + (50.0 / len(takes)))
            job_owns = bool(
                active_job
                and str(active_job.get("project_id")) == str(p["id"])
                and (not live_slug or live_slug == p.get("slug"))
            )
            if job_owns:
                try:
                    jp = float(active_job.get("progress") or 0)
                    if jp > 1:
                        pct = jp
                    elif jp > 0:
                        take_base = (100.0 * len(done) / len(takes)) if takes else 0.0
                        pct = min(99.0, take_base + jp * (100.0 / max(len(takes), 1)))
                except (TypeError, ValueError):
                    pass
                msg = active_job.get("message") or (
                    f"Gerando take {current_take}" if current_take else "Gerando"
                )
                source = "internal"
            else:
                msg = (
                    f"Take {current_take}/{len(takes)} no Comfy"
                    if current_take and takes
                    else "Gerando no Comfy"
                )
                source = "external" if external else "comfy"
                if external:
                    external_active = {
                        "kind": "external_runner",
                        "project_id": p["id"],
                        "title": p.get("title"),
                        "slug": p.get("slug"),
                        "message": f"{msg} · {p.get('title') or p.get('slug')}",
                        "progress": pct,
                        "completed": len(done),
                        "total": len(takes),
                        "current_take": current_take,
                    }
            now = {
                "project_id": p["id"],
                "title": p.get("title"),
                "slug": p.get("slug"),
                "message": msg,
                "progress": pct,
                "completed": len(done),
                "total": len(takes),
                "current_take": current_take,
                "source": source,
                "external": external,
                "comfy_prompt_id": (live or {}).get("prompt_id") if live else None,
            }
        enriched.append(d)

    return {
        "items": enriched,
        "pending_reviews": db.projects_awaiting_review(),
        "active_job": active_job,
        "now": now,
        "external_active": external_active,
        "external_only": bool(enriched) and not has_internal and not active_job,
        "comfy_queue": comfy_q,
        "sync_every_sec": 15,
        "jobs": db.list_jobs(30),
        "estimate": estimate_queue(
            enriched,
            active_job=active_job,
            now_live=live if isinstance(live, dict) else None,
        ),
    }


@app.post("/api/external/sync")
async def api_external_sync() -> dict[str, Any]:
    changed = sync_all_external()
    comfy_q = await peek_comfy_queue()
    return {"ok": True, "changed": changed, "comfy_queue": comfy_q}


@app.post("/api/projects")
def api_create_project(body: ProjectCreateBody) -> dict[str, Any]:
    return db.create_project(body.model_dump())


@app.get("/api/projects/{project_id}")
async def api_get_project(project_id: str) -> dict[str, Any]:
    p = db.get_project(project_id)
    if not p:
        raise HTTPException(404)
    p["runner_state"] = db.get_runner_state(project_id)
    jobs = db.jobs_for_project(project_id)
    p["jobs"] = jobs
    active_job = next((j for j in jobs if j.get("status") == "running"), None) or db.active_job()
    if active_job and str(active_job.get("project_id")) != str(project_id):
        active_job = None
    comfy_q = await peek_comfy_queue()
    live = (comfy_q or {}).get("live") if isinstance(comfy_q, dict) else None
    if live and live.get("slug") != p.get("slug"):
        live = None
    p["estimate"] = estimate_project(p, now_live=live, job=active_job)
    poster = ensure_poster(project_id)
    p["poster_url"] = f"/api/projects/{project_id}/poster" if poster else None
    p.update(project_master_info(project_id))
    return p


@app.get("/api/projects/{project_id}/poster")
def api_project_poster(project_id: str, force: bool = False):
    p = db.get_project(project_id)
    if not p:
        raise HTTPException(404)
    # NSFW: nunca servir capa (evita vazamento por URL direta)
    pack = (p.get("model_pack") or "").lower()
    blob = f"{p.get('slug') or ''} {p.get('title') or ''}".lower()
    if pack == "nsfw" or "nsfw" in blob:
        raise HTTPException(404, "Capa ocultada para conteúdo NSFW")
    poster = ensure_poster(project_id, force=force)
    if not poster:
        raise HTTPException(404, "Poster indisponível")
    return FileResponse(poster, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=60"})


@app.post("/api/projects/{project_id}/build-master")
def api_build_master(project_id: str, force: bool = True) -> dict[str, Any]:
    if not db.get_project(project_id):
        raise HTTPException(404)
    try:
        return build_master(project_id, force=force)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/projects/{project_id}/master")
def api_project_master(project_id: str):
    p = db.get_project(project_id)
    if not p:
        raise HTTPException(404)
    path = resolve_master_path(p)
    if not path:
        raise HTTPException(404, "Vídeo final ainda não disponível")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=f"{p.get('slug') or project_id}_master.mp4",
        headers={"Accept-Ranges": "bytes", "Cache-Control": "no-cache"},
    )


@app.patch("/api/projects/{project_id}")
def api_patch_project(project_id: str, body: ProjectUpdateBody) -> dict[str, Any]:
    p = db.update_project(project_id, **body.model_dump(exclude_none=True))
    if not p:
        raise HTTPException(404)
    return p


@app.delete("/api/projects/{project_id}")
def api_delete_project(project_id: str, hard: bool = False) -> dict[str, Any]:
    """Soft-archive by default. hard=true apaga DB + pastas locais do projeto."""
    if not db.get_project(project_id):
        raise HTTPException(404)
    db.delete_project(project_id, hard=hard)
    return {"ok": True, "archived": not hard, "deleted": bool(hard)}


@app.post("/api/projects/{project_id}/restore")
def api_restore_project(project_id: str) -> dict[str, Any]:
    p = db.get_project(project_id)
    if not p:
        raise HTTPException(404)
    return db.update_project(project_id, status="draft")  # type: ignore[return-value]


@app.post("/api/projects/dice")
async def api_dice(model_pack: str = "sfw") -> dict[str, Any]:
    try:
        return await generate_dice_brief(model_pack=model_pack)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/projects/{project_id}/generate-story")
async def api_generate_story(project_id: str, body: StoryGenerateBody) -> dict[str, Any]:
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(404)
    brief = body.brief if body.brief is not None else project.get("brief") or ""
    if body.use_dice or not brief.strip():
        dice = await generate_dice_brief(model_pack=project.get("model_pack") or "sfw")
        brief = dice["brief"]
        db.update_project(project_id, brief=brief, title=dice.get("title") or project["title"])
        project = db.get_project(project_id)  # type: ignore[assignment]
    try:
        result = await generate_story(
            brief=brief,
            max_duration_sec=float(project["max_duration_sec"]),
            style_id=project.get("style_id"),
            slug=project["slug"],
            seed_base=int(project.get("seed_base") or 2000),
            model_pack=project.get("model_pack") or "sfw",
            title=project.get("title"),
        )
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    errors = validate_takes(result["takes"], float(project["max_duration_sec"]))
    updated = db.update_project(
        project_id,
        title=result["title"],
        synopsis=result["synopsis"],
        roteiro_md=result["roteiro_md"],
        takes=result["takes"],
        brief=brief,
        status="draft",
    )
    return {"project": updated, "estimate": result["estimate"], "warnings": errors}


@app.post("/api/projects/{project_id}/enqueue")
async def api_enqueue(project_id: str) -> dict[str, Any]:
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(404)
    errors = validate_takes(project.get("takes") or [], float(project["max_duration_sec"]))
    if errors:
        raise HTTPException(400, "; ".join(errors))
    try:
        job = await enqueue_generation(project_id)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"job": job, "project": db.get_project(project_id)}


@app.post("/api/projects/{project_id}/dequeue")
def api_dequeue(project_id: str) -> dict[str, Any]:
    """Remove project from render queue without archiving."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(404)
    from .external_sync import cancel_jobs_for_project

    cancel_jobs_for_project(project_id, message="Removido da fila")
    updated = db.update_project(
        project_id,
        status="draft" if project.get("status") != "done" else "done",
        queue_pos=None,
        error=None,
    )
    return {"ok": True, "project": updated}


@app.post("/api/comfy/interrupt")
async def api_comfy_interrupt() -> dict[str, Any]:
    from .comfy.client import ComfyClient

    try:
        await ComfyClient().interrupt()
        return {"ok": True, "interrupted": True}
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/queue/reorder")
def api_reorder(body: ReorderBody) -> dict[str, Any]:
    for i, pid in enumerate(body.project_ids, start=1):
        db.update_project(pid, queue_pos=i)
    return {"ok": True, "items": db.queued_projects()}


@app.post("/api/projects/{project_id}/review")
async def api_review(project_id: str, body: ReviewBody) -> dict[str, Any]:
    try:
        return await submit_review(project_id, body.decision)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/worker/pause")
def api_pause() -> dict[str, Any]:
    pause_worker()
    return {"ok": True, "paused": True}


@app.post("/api/worker/resume")
def api_resume() -> dict[str, Any]:
    resume_worker()
    return {"ok": True, "paused": False}


@app.get("/api/estimate")
def api_estimate(takes: int = 1) -> dict[str, Any]:
    return estimate_generation(takes)


# ---------- inbox (Cursor → app) ----------


@app.get("/api/inbox")
def api_inbox() -> dict[str, Any]:
    return list_inbox()


class InboxItemBody(BaseModel):
    name: str


@app.post("/api/inbox/approve")
async def api_inbox_approve(body: InboxItemBody) -> dict[str, Any]:
    try:
        result = approve_inbox_item(body.name)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if result.get("ok") and not result.get("skipped"):
        await broadcast(
            {
                "type": "inbox_imported",
                "project_id": (result.get("project") or {}).get("id"),
                "title": (result.get("project") or {}).get("title"),
                "takes_count": result.get("takes_count"),
            }
        )
    return {"result": result, "inbox": list_inbox()}


@app.post("/api/inbox/reject")
async def api_inbox_reject(body: InboxItemBody) -> dict[str, Any]:
    try:
        result = reject_inbox_item(body.name)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    await broadcast({"type": "inbox_rejected", "name": body.name})
    return {"result": result, "inbox": list_inbox()}


@app.post("/api/inbox/scan")
async def api_inbox_scan() -> dict[str, Any]:
    """Approve all pending packs (explicit). Prefer per-item /approve in the UI."""
    results = scan_and_import_inbox()
    for r in results:
        if r.get("ok") and not r.get("skipped"):
            await broadcast(
                {
                    "type": "inbox_imported",
                    "project_id": (r.get("project") or {}).get("id"),
                    "title": (r.get("project") or {}).get("title"),
                }
            )
    return {"results": results, "inbox": list_inbox()}


class ImportPathBody(BaseModel):
    path: str
    title: str | None = None
    slug: str | None = None
    model_pack: str | None = None
    review_mode: str | None = None
    roteiro_path: str | None = None
    completed: list[int] | None = None
    enqueue: bool = False


@app.post("/api/inbox/import-path")
async def api_import_path(body: ImportPathBody) -> dict[str, Any]:
    path = Path(body.path)
    if not path.exists():
        raise HTTPException(404, f"Arquivo não encontrado: {body.path}")
    roteiro = ""
    if body.roteiro_path:
        rp = Path(body.roteiro_path)
        if rp.exists():
            roteiro = rp.read_text(encoding="utf-8")
    meta: dict[str, Any] = {}
    if body.title:
        meta["title"] = body.title
    if body.slug:
        meta["slug"] = body.slug
    if body.model_pack:
        meta["model_pack"] = body.model_pack
    if body.review_mode:
        meta["review_mode"] = body.review_mode
    if body.completed is not None:
        meta["completed"] = body.completed
    try:
        result = import_takes_file(
            path, meta=meta, roteiro_md=roteiro, source_label=str(path)
        )
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    if body.enqueue and result.get("project") and not result.get("skipped"):
        try:
            job = await enqueue_generation(result["project"]["id"])
            result["job"] = job
        except Exception as exc:
            result["enqueue_error"] = str(exc)
    await broadcast(
        {
            "type": "inbox_imported",
            "project_id": (result.get("project") or {}).get("id"),
            "title": (result.get("project") or {}).get("title"),
        }
    )
    return result


# ---------- files / SSE ----------


@app.get("/api/events")
async def api_events() -> StreamingResponse:
    q = await subscribe()

    async def gen():
        try:
            yield sse_encode({"type": "connected"})
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield sse_encode(event)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            await unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/api/files/{path:path}")
def api_files(path: str) -> FileResponse:
    # allow deliverables and absolute under data
    candidates = [
        DELIVERABLES_DIR / path,
        PROJECTS_DIR / path,
        Path(path),
    ]
    for p in candidates:
        try:
            rp = p.resolve()
            if rp.exists() and rp.is_file():
                # safety: only under DATA
                from .config import DATA_DIR

                if str(DATA_DIR.resolve()) in str(rp) or str(DELIVERABLES_DIR.resolve()) in str(rp):
                    return FileResponse(rp)
                if Path(path).is_absolute() and rp.exists():
                    # review paths may be absolute under deliverables
                    if str(DELIVERABLES_DIR.resolve()) in str(rp):
                        return FileResponse(rp)
        except Exception:
            continue
    raise HTTPException(404, "Arquivo não encontrado")


@app.get("/api/media")
def api_media(path: str) -> FileResponse:
    from .config import DATA_DIR
    from .onboarding.setup import comfy_root

    p = Path(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(404)
    allowed_roots = [
        DATA_DIR.resolve(),
        DELIVERABLES_DIR.resolve(),
        (comfy_root() / "output").resolve(),
    ]
    rp = p.resolve()
    if not any(str(rp).startswith(str(root)) for root in allowed_roots):
        raise HTTPException(403, "Path não permitido")
    return FileResponse(rp, media_type="video/mp4")


# ---------- frontend ----------

if FRONTEND_DIST.exists():
    assets = FRONTEND_DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str = "") -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(404)
        index = FRONTEND_DIST / "index.html"
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.exists() and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)
else:

    @app.get("/")
    def root_fallback() -> dict[str, str]:
        return {
            "message": "Promptera Studio API. Build o frontend em frontend/dist ou use o Vite dev server.",
            "docs": "/docs",
        }
