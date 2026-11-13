from __future__ import annotations

import asyncio
import json
from typing import Any

_listeners: list[asyncio.Queue] = []
_lock = asyncio.Lock()


async def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    async with _lock:
        _listeners.append(q)
    return q


async def unsubscribe(q: asyncio.Queue) -> None:
    async with _lock:
        if q in _listeners:
            _listeners.remove(q)


async def broadcast(event: dict[str, Any]) -> None:
    payload = dict(event)
    async with _lock:
        dead: list[asyncio.Queue] = []
        for q in _listeners:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            if q in _listeners:
                _listeners.remove(q)


def sse_encode(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
