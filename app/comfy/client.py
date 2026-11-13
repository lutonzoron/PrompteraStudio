from __future__ import annotations

import asyncio
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Awaitable

import httpx

from .. import db
from ..onboarding.setup import comfy_root


ProgressCb = Callable[[str, float], Awaitable[None] | None]

_PREFIX_RX = re.compile(
    r"(?:^|/)video/([^/]+)/t(\d{1,2})\b|(?:^|/)([^/]+)/t(\d{1,2})\b",
    re.I,
)
_CLIENT_RX = re.compile(
    r"^(?:promptera[-_])?(.+?)(?:[-_]t?(\d{1,2}))?$",
    re.I,
)


def _prefixes_from_prompt(prompt: Any) -> list[str]:
    out: list[str] = []
    if not isinstance(prompt, dict):
        return out
    for node in prompt.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs") or {}
        pref = inputs.get("filename_prefix")
        if isinstance(pref, str) and pref.strip():
            out.append(pref.strip())
    return out


def _parse_comfy_item(item: Any) -> dict[str, Any] | None:
    """Comfy /queue item: [number, prompt_id, prompt, extra_data, outputs]."""
    if not isinstance(item, (list, tuple)) or len(item) < 2:
        return None
    prompt_id = str(item[1] or "")
    prompt = item[2] if len(item) > 2 else {}
    extra = item[3] if len(item) > 3 and isinstance(item[3], dict) else {}
    client_id = str(extra.get("client_id") or "")
    prefixes = _prefixes_from_prompt(prompt)
    slug = None
    take = None
    for pref in prefixes:
        m = _PREFIX_RX.search(pref.replace("\\", "/"))
        if m:
            slug = (m.group(1) or m.group(3) or "").strip() or None
            take_s = m.group(2) or m.group(4)
            if take_s:
                take = int(take_s)
            break
    if slug is None and client_id:
        # milk-htf-8 / promptera-vila_lele_01_esconde_casco-2
        cid = client_id
        m_take = re.search(r"[-_](\d{1,2})$", cid)
        if m_take:
            take = take or int(m_take.group(1))
            cid = cid[: m_take.start()]
        for prefix in ("promptera-", "promptera_", "milk-htf", "milk_htf"):
            pass
        if cid.startswith("promptera-") or cid.startswith("promptera_"):
            slug = cid.split("-", 1)[-1] if cid.startswith("promptera-") else cid.split("_", 1)[-1]
        elif "milk" in cid.lower():
            slug = "milkshake_htf"
    create_time = extra.get("create_time")
    try:
        create_time = float(create_time) if create_time is not None else None
    except (TypeError, ValueError):
        create_time = None
    # Comfy often stores ms since epoch
    started_at = None
    if create_time and create_time > 1e12:
        started_at = create_time / 1000.0
    elif create_time and create_time > 1e9:
        started_at = create_time
    return {
        "prompt_id": prompt_id,
        "client_id": client_id,
        "slug": slug,
        "take": take,
        "prefixes": prefixes,
        "create_time": create_time,
        "started_at": started_at,
    }


class ComfyClient:
    def __init__(self, base: str | None = None) -> None:
        self.base = (base or db.get_setting("comfy_base") or "http://127.0.0.1:8188").rstrip("/")

    async def system_stats(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{self.base}/system_stats")
            r.raise_for_status()
            return r.json()

    async def queue_snapshot(self) -> dict[str, Any]:
        """Peek ComfyUI /queue with slug/take for the live prompt."""
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{self.base}/queue")
            r.raise_for_status()
            data = r.json()
        running_raw = data.get("queue_running") or []
        pending_raw = data.get("queue_pending") or []
        running_items = [x for x in (_parse_comfy_item(i) for i in running_raw) if x]
        pending_items = [x for x in (_parse_comfy_item(i) for i in pending_raw) if x]
        live = running_items[0] if running_items else None
        return {
            "online": True,
            "running": len(running_raw),
            "pending": len(pending_raw),
            "busy": bool(running_raw) or bool(pending_raw),
            "live": live,
            "running_items": running_items,
            "pending_items": pending_items,
        }

    async def queue_prompt(self, prompt: dict, client_id: str) -> str:
        async with httpx.AsyncClient(timeout=180.0) as client:
            r = await client.post(
                f"{self.base}/prompt",
                json={"prompt": prompt, "client_id": client_id},
            )
            r.raise_for_status()
            data = r.json()
        if data.get("node_errors"):
            raise RuntimeError(f"node_errors: {data['node_errors']}")
        return data["prompt_id"]

    async def history(self, prompt_id: str) -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(f"{self.base}/history/{prompt_id}")
            r.raise_for_status()
            data = r.json()
        return data.get(prompt_id)

    async def interrupt(self) -> None:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(f"{self.base}/interrupt")

    async def wait_prompt(
        self,
        prompt_id: str,
        *,
        label: str = "",
        timeout_s: int = 7200,
        poll_s: float = 10.0,
        on_progress: ProgressCb | None = None,
    ) -> dict[str, Any]:
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            entry = await self.history(prompt_id)
            if entry:
                status = entry.get("status") or {}
                if status.get("status_str") == "error" or status.get("completed") is False:
                    msgs = status.get("messages") or []
                    raise RuntimeError(f"{label} failed: {msgs[-5:]}")
                if status.get("completed") is True or status.get("status_str") == "success":
                    return entry
                # some builds omit completed flag when outputs present
                if entry.get("outputs"):
                    return entry
            if on_progress:
                res = on_progress(label, 0.5)
                if asyncio.iscoroutine(res):
                    await res
            await asyncio.sleep(poll_s)
        raise TimeoutError(f"{label} timed out after {timeout_s}s")


def start_comfyui() -> dict[str, Any]:
    root = comfy_root()
    main_py = root / "main.py"
    if not main_py.exists():
        return {"ok": False, "error": f"main.py não encontrado em {root}"}
    py = root / "venv" / "Scripts" / "python.exe"
    if not py.exists():
        py = root / ".venv" / "Scripts" / "python.exe"
    if not py.exists():
        py = Path(sys.executable)
    host = db.get_setting("comfy_listen") or "127.0.0.1"
    port = str(db.get_setting("comfy_port") or "8188")
    args = [
        str(py),
        str(main_py),
        "--listen",
        host,
        "--port",
        port,
        "--preview-method",
        "auto",
        "--disable-pinned-memory",
    ]
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS  # type: ignore[attr-defined]
    subprocess.Popen(
        args,
        cwd=str(root),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )
    return {"ok": True, "message": "ComfyUI iniciando", "cmd": args}
