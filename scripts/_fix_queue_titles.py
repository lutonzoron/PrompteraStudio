"""One-shot: clean misleading status suffixes in titles + requeue orphans."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import db  # noqa: E402

RX = re.compile(
    r"\s*\((gerando agora|na fila[^)]*|pausad[oa][^)]*)\)\s*$",
    re.I,
)

db.init_db()
db.recover_orphaned_jobs()
n_jobs = db.ensure_jobs_for_queued_projects()

fixed = 0
for p in db.list_projects(include_archived=True):
    title = p.get("title") or ""
    clean = RX.sub("", title).strip()
    if clean != title:
        db.update_project(p["id"], title=clean)
        fixed += 1
        print("title:", title, "->", clean)

print("jobs_created", n_jobs, "titles_fixed", fixed)
for p in db.queued_projects():
    print(p["slug"], p["status"], p.get("queue_pos"), p["title"][:50])
