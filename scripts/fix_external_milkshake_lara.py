"""Re-attach milkshake/lara as external runners and sync status from disk."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import db
from app.config import ensure_dirs
from app.external_sync import attach_external_meta, sync_project_from_external


def main() -> None:
    ensure_dirs()
    db.init_db()

    milk = db.get_project_by_slug("milkshake_htf")
    lara = db.get_project_by_slug("lara_ru_30s")
    if not milk or not lara:
        raise SystemExit("milkshake_htf or lara_ru_30s missing — import first")

    attach_external_meta(
        milk["id"],
        slug="milkshake_htf",
        state_name="milkshake_htf_state.json",
        log_name="milkshake_htf_runner.log",
        markers=["FAZDECONTA_ALL_DONE", "MILKSHAKE_HTF_ALL_DONE"],
        extra={"format": "1024x576"},
    )
    db.update_project(
        milk["id"],
        title="Milkshake HTF",
        width=1024,
        height=576,
        model_pack="nsfw",
        style_id="massinha_htf",
        review_mode="automatico",
        queue_pos=1,
        error=None,
    )

    attach_external_meta(
        lara["id"],
        slug="lara_ru_30s",
        state_name="lara_ru_30s_state.json",
        log_name="lara_ru_30s_runner.log",
        markers=["LARA_RU_30S_ALL_DONE"],
        waiting_for="milkshake_htf",
        extra={"format": "544x992"},
    )
    db.update_project(
        lara["id"],
        title="Lara RU 30s",
        width=544,
        height=992,
        model_pack="nsfw",
        style_id="realista_nsfw",
        review_mode="automatico",
        queue_pos=2,
        error=None,
    )

    for slug in ("milkshake_htf", "lara_ru_30s"):
        p = db.get_project_by_slug(slug)
        summary = sync_project_from_external(p)  # type: ignore[arg-type]
        p2 = db.get_project_by_slug(slug)
        print(slug, "->", p2["status"], "progress", p2.get("progress"), "summary", summary)


if __name__ == "__main__":
    main()
