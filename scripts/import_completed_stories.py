"""Import completed stories into Promptera history (status=done)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import db
from app.config import ensure_dirs
from app.inbox.service import ensure_inbox, import_takes_file
from app.styles.service import ensure_seed_styles

SOURCE = Path(r"c:\Projetos\teste comfyui nsfw")
STATE_DIR = SOURCE / "download_logs"

COMPLETED = [
    {
        "takes": "vila_lele_fazdeconta_takes.json",
        "roteiro": "roteiro_vila_lele_fazdeconta.md",
        "slug": "vila_lele_fazdeconta",
        "title": "Vila Lelé — Faz de conta",
        "model_pack": "sfw",
        "state": "vila_lele_fazdeconta_state.json",
    },
    {
        "takes": "anime6_takes.json",
        "roteiro": "roteiro_anime_6takes_continuity.md",
        "slug": "anime6",
        "title": "Anime 6 takes",
        "model_pack": "sfw",
        "state": "anime6_state.json",
    },
    {
        "takes": "faith_2h_takes.json",
        "roteiro": "roteiro_religioso_2h_continuity.md",
        "slug": "faith_2h",
        "title": "Faith 2h",
        "model_pack": "sfw",
        "state": "faith_2h_state.json",
    },
    {
        "takes": "horror_1min_takes.json",
        "roteiro": "roteiro_horror_anime_1min.md",
        "slug": "horror_1min",
        "title": "Horror Anime 1min",
        "model_pack": "sfw",
        "state": "horror_1min_state.json",
    },
    {
        "takes": "pov_mystery_10s_takes.json",
        "roteiro": None,
        "slug": "pov_mystery_10s",
        "title": "POV Mystery 10s",
        "model_pack": "sfw",
        "state": "pov_mystery_10s_state.json",
    },
    {
        "takes": "ru_nsfw_11h_takes.json",
        "roteiro": "roteiro_ru_nsfw_11h.md",
        "slug": "ru_nsfw_11h",
        "title": "RU NSFW 11h",
        "model_pack": "nsfw",
        "state": "ru_nsfw_11h_state.json",
    },
]


def _completed(state_name: str) -> list[int]:
    for p in [STATE_DIR / state_name, *STATE_DIR.glob(f"*{state_name.replace('_state.json','')}*state*.json")]:
        if p.exists():
            try:
                return [int(x) for x in (json.loads(p.read_text(encoding="utf-8")).get("completed") or [])]
            except Exception:
                pass
    return []


def main() -> None:
    ensure_dirs()
    ensure_inbox()
    db.init_db()
    ensure_seed_styles()
    for item in COMPLETED:
        tp = SOURCE / item["takes"]
        if not tp.exists():
            print("missing", item["takes"])
            continue
        takes = json.loads(tp.read_text(encoding="utf-8"))
        done = _completed(item["state"])
        if not done:
            done = [int(t.get("n") or i + 1) for i, t in enumerate(takes)]
        roteiro = ""
        if item.get("roteiro") and (SOURCE / item["roteiro"]).exists():
            roteiro = (SOURCE / item["roteiro"]).read_text(encoding="utf-8")
        meta = {
            "title": item["title"],
            "slug": item["slug"],
            "model_pack": item["model_pack"],
            "review_mode": "automatico",
            "brief": f"Histórico importado (concluída): {tp.name}",
            "completed": done,
        }
        r = import_takes_file(tp, meta=meta, roteiro_md=roteiro, source_label=str(tp))
        if r.get("skipped"):
            print("EXISTS", item["slug"])
            continue
        pid = r["project"]["id"]
        master = SOURCE / "deliverables" / item["slug"]
        masters = list(master.glob("*master*.mp4")) if master.exists() else []
        stats = {"imported_done": True}
        if masters:
            stats["master"] = str(masters[0])
        db.update_project(pid, status="done", stats=stats)
        print("OK done", item["slug"], "takes", len(takes))


if __name__ == "__main__":
    main()
