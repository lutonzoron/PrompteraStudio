from __future__ import annotations

import json
import uuid
from typing import Any

from .. import db
from ..config import STYLE_BASES_DIR
from ..llm.prompts import STYLE_ADAPT_SYSTEM
from ..llm.providers import get_provider


def ensure_seed_styles() -> int:
    """Load bundled style bases into DB if empty / missing ids."""
    seeds_path = STYLE_BASES_DIR / "seeds.json"
    if not seeds_path.exists():
        return 0
    seeds = json.loads(seeds_path.read_text(encoding="utf-8"))
    created = 0
    for s in seeds:
        if db.get_style(s["id"]):
            continue
        db.upsert_style(
            {
                "id": s["id"],
                "label": s["label"],
                "lock_en": s.get("lock_en") or "",
                "bible_hint_pt": s.get("bible_hint_pt") or "",
                "craft_rules_en": s.get("craft_rules_en") or "",
                "anti_drift_en": s.get("anti_drift_en") or "",
                "negatives": s.get("negatives") or "",
                "model_pack_hint": s.get("model_pack_hint") or "sfw",
                "created_from_base_id": None,
            }
        )
        created += 1
    return created


async def adapt_style(
    *,
    description: str,
    base_style_id: str | None = None,
    label: str | None = None,
) -> dict[str, Any]:
    styles = db.list_styles()
    if not styles:
        ensure_seed_styles()
        styles = db.list_styles()
    base = None
    if base_style_id:
        base = db.get_style(base_style_id)
    if not base:
        # pick first as structural template
        base = styles[0] if styles else None
    if not base:
        raise RuntimeError("Nenhum estilo base disponível")

    provider = get_provider()
    user = (
        f"BASE STYLE:\n{json.dumps({k: base.get(k) for k in ('id','label','lock_en','bible_hint_pt','craft_rules_en','anti_drift_en','negatives','model_pack_hint')}, ensure_ascii=False, indent=2)}\n\n"
        f"USER REQUEST (new style):\n{description}\n"
    )
    if label:
        user += f"\nPreferred label: {label}\n"

    schema = {
        "label": "string",
        "lock_en": "Visual style lock: ...",
        "bible_hint_pt": "...",
        "craft_rules_en": "...",
        "anti_drift_en": "...",
        "negatives": "...",
        "model_pack_hint": "sfw",
        "diff_from_base": "...",
    }
    data = await provider.chat_json(STYLE_ADAPT_SYSTEM, user, schema)
    new_id = str(uuid.uuid4())
    style = db.upsert_style(
        {
            "id": new_id,
            "label": label or data.get("label") or description[:40],
            "lock_en": data.get("lock_en") or "",
            "bible_hint_pt": data.get("bible_hint_pt") or "",
            "craft_rules_en": data.get("craft_rules_en") or "",
            "anti_drift_en": data.get("anti_drift_en") or "",
            "negatives": data.get("negatives") or "",
            "model_pack_hint": data.get("model_pack_hint") or "sfw",
            "created_from_base_id": base["id"],
        }
    )
    style["diff_from_base"] = data.get("diff_from_base")
    return style


def duplicate_style(style_id: str, new_label: str | None = None) -> dict[str, Any]:
    src = db.get_style(style_id)
    if not src:
        raise RuntimeError("Estilo não encontrado")
    return db.upsert_style(
        {
            "id": str(uuid.uuid4()),
            "label": new_label or f"{src['label']} (cópia)",
            "lock_en": src.get("lock_en") or "",
            "bible_hint_pt": src.get("bible_hint_pt") or "",
            "craft_rules_en": src.get("craft_rules_en") or "",
            "anti_drift_en": src.get("anti_drift_en") or "",
            "negatives": src.get("negatives") or "",
            "model_pack_hint": src.get("model_pack_hint") or "sfw",
            "created_from_base_id": src["id"],
        }
    )
