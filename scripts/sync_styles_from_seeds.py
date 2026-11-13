"""Upsert all bundled style seeds into studio.db (create + refresh existing)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import db
from app.config import STYLE_BASES_DIR, ensure_dirs
from app.styles.service import ensure_seed_styles

# Optional: attach styles to known imported project slugs
PROJECT_STYLE = {
    "vila_lele_fazdeconta": "massinha_vila_lele",
    "vila_lele_3x30": "massinha_vila_lele",
    "milkshake_htf": "massinha_htf",
    "anime6": "anime_2d",
    "horror_1min": "anime_horror",
    "shorts_mystery_30s": "cartoon_instagram_br",
    "cartoon_ab": "cartoon_instagram_br",
    "pov_mystery_10s": "cartoon_instagram_br",
    "re_horror_1min": "biohazard_cinematic",
    "faith_2h": "faith_cinematic",
    "ru_nsfw_11h": "realista_nsfw",
    "lara_ru_30s": "realista_nsfw",
}


def main() -> None:
    ensure_dirs()
    db.init_db()
    seeds_path = STYLE_BASES_DIR / "seeds.json"
    seeds = json.loads(seeds_path.read_text(encoding="utf-8"))
    # Force upsert every seed (refresh text even if id exists)
    for s in seeds:
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
        print(f"UPSERT {s['id']} — {s['label']}")

    # Also ensure any future missing ones via service
    ensure_seed_styles()

    # Link Vila bank stories to massinha_vila_lele
    for p in db.list_projects():
        slug = p.get("slug") or ""
        style = PROJECT_STYLE.get(slug)
        if not style and slug.startswith("vila_lele_"):
            style = "massinha_vila_lele"
        if style and p.get("style_id") != style:
            db.update_project(p["id"], style_id=style)
            print(f"PROJECT {slug} → style {style}")

    styles = db.list_styles()
    print(f"\nTotal styles in DB: {len(styles)}")
    for s in sorted(styles, key=lambda x: x["label"].lower()):
        print(f"  - {s['id']}: {s['label']} [{s.get('model_pack_hint')}]")


if __name__ == "__main__":
    main()
