from __future__ import annotations

import json
import re
import shutil
import time
from pathlib import Path
from typing import Any

from .. import db
from ..config import DATA_DIR, ensure_dirs
from ..story.service import validate_takes

INBOX_DIR = DATA_DIR / "inbox"
PROCESSED_DIR = INBOX_DIR / "_processed"
FAILED_DIR = INBOX_DIR / "_failed"

# Heuristic NSFW markers in prompts / slugs
_NSFW_RE = re.compile(
    r"nsfw|10eros|heretic|penis|vagina|explicit|sex|nude|porn|cowgirl|thrust",
    re.I,
)


def ensure_inbox() -> None:
    ensure_dirs()
    for p in (INBOX_DIR, PROCESSED_DIR, FAILED_DIR):
        p.mkdir(parents=True, exist_ok=True)
    readme = INBOX_DIR / "README.md"
    if not readme.exists():
        readme.write_text(
            """# Inbox — histórias de qualquer IA (Cursor / Claude / Copilot / …)

Spec completa no repositório: **AI_STORY_INBOX.md** (e AGENTS.md).

Pacote por história:

```
inbox/
  minha_historia/
    takes.json     # obrigatório
    meta.json      # opcional
    roteiro.md     # opcional
```

Ou `*.takes.json` / `*_takes.json` na raiz. Import automático ~5s → `_processed/`.
""",
            encoding="utf-8",
        )


def _slugify(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"[-\s]+", "-", s).strip("-")
    return s[:60] or f"story-{int(time.time())}"


def _load_takes(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "takes" in data:
        data = data["takes"]
    if not isinstance(data, list):
        raise ValueError("takes.json deve ser uma lista")
    return data


def _guess_model_pack(takes: list[dict[str, Any]], slug: str = "") -> str:
    blob = slug + " " + " ".join(str(t.get("prompt") or "")[:400] for t in takes[:3])
    return "nsfw" if _NSFW_RE.search(blob) else "sfw"


def _normalize_imported_takes(takes: list[dict[str, Any]], slug: str) -> list[dict[str, Any]]:
    out = []
    for i, t in enumerate(takes):
        n = int(t.get("n") or (i + 1))
        kind = (t.get("kind") or "new").lower()
        if kind not in {"new", "continue"}:
            kind = "new"
        session = str(t.get("session") or f"block_{n}")
        duration = float(t.get("duration") or 5)
        duration = max(2.0, min(15.0, duration))
        prefix = t.get("prefix") or f"video/{slug}/t{n:02d}"
        out.append(
            {
                "n": n,
                "kind": kind,
                "session": session,
                "seed": int(t.get("seed") or (2000 + n)),
                "duration": duration,
                "prefix": prefix,
                "prompt": (t.get("prompt") or "").strip(),
                "title": t.get("title") or f"Take {n}",
            }
        )
    return out


def import_takes_file(
    takes_path: Path,
    *,
    meta: dict[str, Any] | None = None,
    roteiro_md: str = "",
    move_to_processed: bool = False,
    source_label: str | None = None,
) -> dict[str, Any]:
    ensure_inbox()
    takes_path = Path(takes_path)
    meta = dict(meta or {})
    raw = _load_takes(takes_path)
    slug = meta.get("slug") or _slugify(takes_path.stem.replace("_takes", "").replace(".takes", ""))
    title = meta.get("title") or slug.replace("-", " ").replace("_", " ").title()
    takes = _normalize_imported_takes(raw, slug)
    model_pack = meta.get("model_pack") or _guess_model_pack(takes, slug)
    max_dur = float(meta.get("max_duration_sec") or sum(float(t["duration"]) for t in takes) or 60)
    review_mode = meta.get("review_mode") or "automatico"

    # Skip duplicate slug if already exists with same take count
    existing = db.get_project_by_slug(slug)
    if existing and len(existing.get("takes") or []) == len(takes):
        return {
            "ok": True,
            "skipped": True,
            "reason": "slug já existe com mesmo nº de takes",
            "project": existing,
        }

    warnings = validate_takes(takes, max_dur + 30)  # loose on import
    project = db.create_project(
        {
            "title": title,
            "brief": meta.get("brief") or f"Importado: {source_label or takes_path.name}",
            "slug": slug,
            "status": "draft",
            "review_mode": review_mode,
            "model_pack": model_pack,
            "style_id": meta.get("style_id"),
            "max_duration_sec": max_dur,
            "synopsis": meta.get("synopsis") or "",
            "roteiro_md": roteiro_md or meta.get("roteiro_md") or "",
            "takes": takes,
            "seed_base": int(meta.get("seed_base") or 2000),
        }
    )

    # Persist runner completed state if provided
    completed = meta.get("completed")
    if isinstance(completed, list) and completed:
        db.save_runner_state(project["id"], {"completed": completed, "last_ok": None, "imported": True})

    if move_to_processed:
        dest = PROCESSED_DIR / f"{slug}_{int(time.time())}"
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(takes_path, dest / "takes.json")
        if roteiro_md:
            (dest / "roteiro.md").write_text(roteiro_md, encoding="utf-8")
        (dest / "meta.json").write_text(
            json.dumps({**meta, "imported_project_id": project["id"]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    return {
        "ok": True,
        "skipped": False,
        "project": project,
        "warnings": warnings,
        "takes_count": len(takes),
        "model_pack": model_pack,
    }


def import_pack_dir(pack_dir: Path, *, move: bool = True) -> dict[str, Any]:
    ensure_inbox()
    pack_dir = Path(pack_dir)
    if not pack_dir.is_dir():
        raise ValueError(f"Não é pasta: {pack_dir}")

    takes_path = None
    for name in ("takes.json", "takes.JSON"):
        if (pack_dir / name).exists():
            takes_path = pack_dir / name
            break
    if takes_path is None:
        candidates = list(pack_dir.glob("*takes*.json"))
        if candidates:
            takes_path = candidates[0]
    if takes_path is None:
        raise ValueError(f"takes.json não encontrado em {pack_dir}")

    meta: dict[str, Any] = {}
    meta_path = pack_dir / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))

    roteiro = ""
    for name in ("roteiro.md", "roteiro.MD", "story.md"):
        p = pack_dir / name
        if p.exists():
            roteiro = p.read_text(encoding="utf-8")
            break
    if not roteiro:
        mds = [p for p in pack_dir.glob("*.md") if p.name.lower() != "readme.md"]
        if mds:
            roteiro = mds[0].read_text(encoding="utf-8")

    if not meta.get("slug"):
        meta["slug"] = _slugify(pack_dir.name)
    if not meta.get("title"):
        meta["title"] = pack_dir.name.replace("_", " ").replace("-", " ").title()

    result = import_takes_file(
        takes_path,
        meta=meta,
        roteiro_md=roteiro,
        source_label=str(pack_dir),
    )

    if move and not result.get("skipped"):
        dest = PROCESSED_DIR / f"{pack_dir.name}_{int(time.time())}"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(pack_dir), str(dest))
        result["moved_to"] = str(dest)
    elif move and result.get("skipped"):
        # still move to avoid reimport loop
        dest = PROCESSED_DIR / f"{pack_dir.name}_skip_{int(time.time())}"
        if pack_dir.exists():
            shutil.move(str(pack_dir), str(dest))
            result["moved_to"] = str(dest)

    return result


def list_inbox() -> dict[str, Any]:
    ensure_inbox()
    pending_dirs = [
        p.name
        for p in INBOX_DIR.iterdir()
        if p.is_dir() and not p.name.startswith("_")
    ]
    pending_files = [
        p.name
        for p in INBOX_DIR.glob("*.json")
        if p.is_file()
    ]
    return {
        "inbox_dir": str(INBOX_DIR),
        "pending_dirs": pending_dirs,
        "pending_files": pending_files,
        "processed_count": len(list(PROCESSED_DIR.iterdir())) if PROCESSED_DIR.exists() else 0,
    }


def scan_and_import_inbox() -> list[dict[str, Any]]:
    """Import all pending packs/files in inbox."""
    ensure_inbox()
    results: list[dict[str, Any]] = []

    for p in sorted(INBOX_DIR.iterdir()):
        if p.name.startswith("_") or p.name == "README.md":
            continue
        try:
            if p.is_dir():
                results.append(import_pack_dir(p, move=True))
            elif p.suffix.lower() == ".json" and (
                "takes" in p.name.lower() or p.name.lower() == "takes.json"
            ):
                meta = {"slug": _slugify(p.stem.replace("_takes", "").replace(".takes", ""))}
                r = import_takes_file(p, meta=meta, move_to_processed=True, source_label=p.name)
                # move original
                dest = PROCESSED_DIR / f"{p.stem}_{int(time.time())}{p.suffix}"
                try:
                    shutil.move(str(p), str(dest))
                except OSError:
                    pass
                results.append(r)
        except Exception as exc:
            fail = FAILED_DIR / f"{p.name}_{int(time.time())}"
            try:
                if p.is_dir():
                    shutil.move(str(p), str(fail))
                else:
                    fail.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(p), str(fail / p.name))
                    (fail / "error.txt").write_text(str(exc), encoding="utf-8")
            except OSError:
                pass
            results.append({"ok": False, "error": str(exc), "path": str(p)})

    return results
