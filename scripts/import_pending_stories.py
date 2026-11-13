"""Import pending Continuity stories from teste comfyui nsfw into Promptera Studio."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import db  # noqa: E402
from app.config import ensure_dirs  # noqa: E402
from app.inbox.service import ensure_inbox, import_takes_file  # noqa: E402
from app.styles.service import ensure_seed_styles  # noqa: E402

SOURCE = Path(r"c:\Projetos\teste comfyui nsfw")
STATE_DIR = SOURCE / "download_logs"

# Stories with takes.json that still have work left (or never started).
# completed_done: skip if fully done unless force.
PENDING = [
    {
        "takes": "lara_ru_30s_takes.json",
        "roteiro": "roteiro_lara_ru_30s.md",
        "slug": "lara_ru_30s",
        "title": "Lara RU 30s",
        "model_pack": "nsfw",
        "state": "lara_ru_30s_state.json",
    },
    {
        "takes": "milkshake_htf_takes.json",
        "roteiro": "roteiro_milkshake_htf.md",
        "slug": "milkshake_htf",
        "title": "Milkshake HTF",
        "model_pack": "nsfw",
        "state": "milkshake_htf_state.json",
    },
    {
        "takes": "vila_lele_takes.json",
        "roteiro": "roteiro_vila_lele_3x30.md",
        "slug": "vila_lele_3x30",
        "title": "Vila Lelé 3x30",
        "model_pack": "sfw",
        "state": "vila_lele_state.json",
    },
    {
        "takes": "shorts_mystery_30s_takes.json",
        "roteiro": "roteiro_shorts_mystery_30s.md",
        "slug": "shorts_mystery_30s",
        "title": "Shorts Mystery 30s",
        "model_pack": "sfw",
        "state": "shorts_mystery_30s_state.json",
    },
    {
        "takes": "cartoon_ab_takes.json",
        "roteiro": "roteiro_cartoon_ab_ig.md",
        "slug": "cartoon_ab",
        "title": "Cartoon AB",
        "model_pack": "sfw",
        "state": "cartoon_ab_state.json",
    },
    {
        "takes": "re_1min_takes.json",
        "roteiro": "roteiro_re_horror_1min.md",
        "slug": "re_horror_1min",
        "title": "RE Horror 1min",
        "model_pack": "sfw",
        "state": "re_1min_state.json",
    },
    {
        "takes": "roteiro_5min_takes.json",
        "roteiro": "roteiro_5min_continuity.md",
        "slug": "roteiro_5min",
        "title": "Roteiro 5min Continuity",
        "model_pack": "sfw",
        "state": "roteiro_5min_state.json",
    },
]


def _load_completed(state_name: str | None) -> list[int]:
    if not state_name:
        return []
    # try exact + glob
    candidates = [STATE_DIR / state_name]
    candidates.extend(STATE_DIR.glob(f"*{state_name.replace('_state.json', '')}*state*.json"))
    for p in candidates:
        if not p.exists():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            done = data.get("completed") or []
            return [int(x) for x in done]
        except Exception:
            continue
    return []


def main() -> None:
    ensure_dirs()
    ensure_inbox()
    db.init_db()
    ensure_seed_styles()

    imported = []
    skipped = []
    for item in PENDING:
        takes_path = SOURCE / item["takes"]
        if not takes_path.exists():
            print(f"SKIP missing {item['takes']}")
            skipped.append(item["slug"])
            continue
        takes = json.loads(takes_path.read_text(encoding="utf-8"))
        n_takes = len(takes)
        completed = _load_completed(item.get("state"))
        # still import even if partially done — runner can resume
        if completed and len(completed) >= n_takes:
            print(f"SKIP fully done {item['slug']} ({len(completed)}/{n_takes})")
            skipped.append(item["slug"])
            continue

        roteiro = ""
        rp = SOURCE / item["roteiro"] if item.get("roteiro") else None
        if rp and rp.exists():
            roteiro = rp.read_text(encoding="utf-8")

        meta = {
            "title": item["title"],
            "slug": item["slug"],
            "model_pack": item["model_pack"],
            "review_mode": "automatico",
            "brief": f"Importado de {takes_path}",
            "completed": completed,
        }
        result = import_takes_file(
            takes_path,
            meta=meta,
            roteiro_md=roteiro,
            source_label=str(takes_path),
        )
        if result.get("skipped"):
            print(f"EXISTS {item['slug']}")
            skipped.append(item["slug"])
        else:
            print(
                f"OK {item['slug']} takes={result['takes_count']} "
                f"pack={result['model_pack']} done_so_far={completed}"
            )
            imported.append(item["slug"])

    print(f"\nImported: {len(imported)} | Skipped: {len(skipped)}")
    print("Imported:", ", ".join(imported) or "—")
    print("Skipped:", ", ".join(skipped) or "—")


if __name__ == "__main__":
    main()
