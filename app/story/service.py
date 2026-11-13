from __future__ import annotations

import json
import re
from typing import Any

from .. import db
from ..cost import estimate_generation
from ..llm.prompts import DICE_SYSTEM, STORY_SYSTEM
from ..llm.providers import get_provider


def _slug_prefix(slug: str, session: str, n: int) -> str:
    sess = re.sub(r"[^\w]+", "_", session)[:40]
    return f"video/{slug}/{sess}_t{n:02d}"


def _normalize_takes(
    takes: list[dict[str, Any]],
    *,
    slug: str,
    seed_base: int,
    style_lock: str,
    craft: str,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, t in enumerate(takes):
        n = int(t.get("n") or (i + 1))
        kind = (t.get("kind") or "new").lower()
        if kind not in {"new", "continue"}:
            kind = "new"
        session = str(t.get("session") or f"block_{n}")
        duration = float(t.get("duration") or 5)
        duration = max(2.0, min(15.0, duration))
        seed = int(t.get("seed") or (seed_base + n))
        prompt = (t.get("prompt") or "").strip()
        if style_lock and "visual style lock:" not in prompt.lower():
            extra = style_lock
            if craft:
                extra = f"{extra}\n\n{craft}"
            prompt = f"{extra}\n\n{prompt}".strip()
        out.append(
            {
                "n": n,
                "kind": kind,
                "session": session,
                "seed": seed,
                "duration": duration,
                "prefix": t.get("prefix") or _slug_prefix(slug, session, n),
                "prompt": prompt,
                "title": t.get("title") or f"Take {n}",
            }
        )
    return out


async def generate_dice_brief(*, model_pack: str = "sfw") -> dict[str, Any]:
    provider = get_provider()
    user = f"model_pack={model_pack}. Invent one fresh idea."
    data = await provider.chat_json(
        DICE_SYSTEM,
        user,
        {"brief": "...", "title": "...", "tone": "..."},
    )
    return {
        "brief": data.get("brief") or "",
        "title": data.get("title") or "História aleatória",
        "tone": data.get("tone") or "",
    }


async def generate_story(
    *,
    brief: str,
    max_duration_sec: float,
    style_id: str | None,
    slug: str,
    seed_base: int = 2000,
    model_pack: str = "sfw",
    title: str | None = None,
) -> dict[str, Any]:
    style = db.get_style(style_id) if style_id else None
    style_lock = (style or {}).get("lock_en") or ""
    craft = (style or {}).get("craft_rules_en") or ""
    bible = (style or {}).get("bible_hint_pt") or ""

    provider = get_provider()
    user = (
        f"BRIEF (Portuguese):\n{brief}\n\n"
        f"max_duration_sec: {max_duration_sec}\n"
        f"model_pack: {model_pack}\n"
        f"slug for prefixes: {slug}\n"
        f"seed_base: {seed_base}\n"
        f"STYLE bible (PT): {bible}\n"
        f"STYLE lock_en (must inject in every prompt):\n{style_lock}\n"
        f"STYLE craft:\n{craft}\n"
    )
    if title:
        user += f"Preferred title: {title}\n"

    schema = {
        "title": "...",
        "synopsis": "...",
        "roteiro_md": "...",
        "takes": [
            {
                "n": 1,
                "kind": "new",
                "session": "block_a",
                "seed": 2001,
                "duration": 5,
                "prefix": "video/slug/A_t01",
                "prompt": "...",
            }
        ],
        "total_duration_sec": 30,
    }
    data = await provider.chat_json(STORY_SYSTEM, user, schema)
    takes = _normalize_takes(
        list(data.get("takes") or []),
        slug=slug,
        seed_base=seed_base,
        style_lock=style_lock,
        craft=craft,
    )
    total = sum(float(t["duration"]) for t in takes)
    # If over max, trim from the end
    while takes and total > float(max_duration_sec) + 0.5:
        dropped = takes.pop()
        total -= float(dropped["duration"])
    estimate = estimate_generation(len(takes))
    return {
        "title": data.get("title") or title or "Sem título",
        "synopsis": data.get("synopsis") or "",
        "roteiro_md": data.get("roteiro_md") or "",
        "takes": takes,
        "total_duration_sec": total,
        "estimate": estimate,
    }


def validate_takes(takes: list[dict[str, Any]], max_duration_sec: float) -> list[str]:
    errors: list[str] = []
    if not takes:
        errors.append("Nenhum take")
        return errors
    total = 0.0
    sessions_seen: set[str] = set()
    for t in takes:
        kind = t.get("kind")
        session = t.get("session") or ""
        dur = float(t.get("duration") or 5)
        if kind not in {"new", "continue"}:
            errors.append(f"Take {t.get('n')}: kind inválido")
        if not (t.get("prompt") or "").strip():
            errors.append(f"Take {t.get('n')}: prompt vazio")
        if dur < 2 or dur > 15:
            errors.append(f"Take {t.get('n')}: duration fora de 2–15")
        if kind == "new":
            sessions_seen.add(session)
        elif session not in sessions_seen and kind == "continue":
            # allow if earlier new in list
            earlier_new = any(
                x.get("session") == session and x.get("kind") == "new" for x in takes
            )
            if not earlier_new:
                errors.append(f"Take {t.get('n')}: CONTINUE sem NEW na session {session}")
        total += dur
    if total > float(max_duration_sec) + 1.0:
        errors.append(f"Duração total {total:.0f}s > máximo {max_duration_sec:.0f}s")
    return errors
