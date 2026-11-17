"""One-shot: list projects and apply inferred categories where needed."""
from __future__ import annotations

from app import db
from app.categories import infer_category, default_footage_time


def main() -> None:
    projects = db.list_projects(include_archived=True)
    print(f"projects={len(projects)}")
    changed = 0
    for p in projects:
        slug = p.get("slug") or ""
        title = p.get("title") or ""
        current = p.get("category") or "general"
        inferred = infer_category(slug, title)
        flag = "" if current == inferred else f" UPDATE->{inferred}"
        print(f"{current:8} infer={inferred:8} {slug[:50]:50} {title[:50]}{flag}")
        if current != inferred:
            patch = {"category": inferred, "cctv_timestamp_enabled": False}
            if inferred == "footage" and not p.get("cctv_timestamp_start"):
                patch["cctv_timestamp_start"] = default_footage_time(slug)
            db.update_project(p["id"], **patch)
            changed += 1
    print(f"updated={changed}")


if __name__ == "__main__":
    main()
