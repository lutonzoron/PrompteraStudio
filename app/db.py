from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .config import DB_PATH, PROJECTS_DIR, ensure_dirs

_lock = threading.RLock()


def _conn() -> sqlite3.Connection:
    ensure_dirs()
    c = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def _row(r: sqlite3.Row | None) -> dict[str, Any] | None:
    if r is None:
        return None
    d = dict(r)
    for k in list(d.keys()):
        if k.endswith("_json") and isinstance(d[k], str):
            try:
                d[k.replace("_json", "")] = json.loads(d[k])
            except json.JSONDecodeError:
                d[k.replace("_json", "")] = None
    return d


def init_db() -> None:
    with _lock:
        c = _conn()
        try:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS styles (
                    id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    lock_en TEXT NOT NULL DEFAULT '',
                    bible_hint_pt TEXT NOT NULL DEFAULT '',
                    craft_rules_en TEXT NOT NULL DEFAULT '',
                    anti_drift_en TEXT NOT NULL DEFAULT '',
                    negatives TEXT NOT NULL DEFAULT '',
                    model_pack_hint TEXT NOT NULL DEFAULT 'sfw',
                    created_from_base_id TEXT,
                    archived INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    slug TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    brief TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'draft',
                    review_mode TEXT NOT NULL DEFAULT 'automatico',
                    model_pack TEXT NOT NULL DEFAULT 'sfw',
                    style_id TEXT,
                    max_duration_sec REAL NOT NULL DEFAULT 60,
                    width INTEGER NOT NULL DEFAULT 544,
                    height INTEGER NOT NULL DEFAULT 992,
                    steps INTEGER NOT NULL DEFAULT 8,
                    synopsis TEXT NOT NULL DEFAULT '',
                    roteiro_md TEXT NOT NULL DEFAULT '',
                    takes_json TEXT NOT NULL DEFAULT '[]',
                    queue_pos INTEGER,
                    seed_base INTEGER NOT NULL DEFAULT 2000,
                    stats_json TEXT NOT NULL DEFAULT '{}',
                    review_take INTEGER,
                    review_full_path TEXT,
                    review_current_path TEXT,
                    error TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    FOREIGN KEY (style_id) REFERENCES styles(id)
                );

                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    status TEXT NOT NULL DEFAULT 'queued',
                    progress REAL NOT NULL DEFAULT 0,
                    message TEXT NOT NULL DEFAULT '',
                    priority INTEGER NOT NULL DEFAULT 100,
                    created_at REAL NOT NULL,
                    started_at REAL,
                    finished_at REAL,
                    duration_sec REAL,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS runner_state (
                    project_id TEXT PRIMARY KEY,
                    state_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, priority, created_at);
                CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, queue_pos);
                """
            )
            c.commit()
        finally:
            c.close()


# --- settings ---

def get_setting(key: str, default: Any = None) -> Any:
    with _lock:
        c = _conn()
        try:
            r = c.execute("SELECT value_json FROM settings WHERE key=?", (key,)).fetchone()
            if not r:
                return default
            return json.loads(r["value_json"])
        finally:
            c.close()


def set_setting(key: str, value: Any) -> None:
    with _lock:
        c = _conn()
        try:
            c.execute(
                "INSERT INTO settings(key, value_json) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
                (key, json.dumps(value, ensure_ascii=False)),
            )
            c.commit()
        finally:
            c.close()


def all_settings() -> dict[str, Any]:
    with _lock:
        c = _conn()
        try:
            rows = c.execute("SELECT key, value_json FROM settings").fetchall()
            return {r["key"]: json.loads(r["value_json"]) for r in rows}
        finally:
            c.close()


# --- styles ---

def list_styles(include_archived: bool = False) -> list[dict[str, Any]]:
    with _lock:
        c = _conn()
        try:
            q = "SELECT * FROM styles"
            if not include_archived:
                q += " WHERE archived=0"
            q += " ORDER BY label COLLATE NOCASE"
            return [_row(r) for r in c.execute(q).fetchall()]  # type: ignore[misc]
        finally:
            c.close()


def get_style(style_id: str) -> dict[str, Any] | None:
    with _lock:
        c = _conn()
        try:
            return _row(c.execute("SELECT * FROM styles WHERE id=?", (style_id,)).fetchone())
        finally:
            c.close()


def upsert_style(data: dict[str, Any]) -> dict[str, Any]:
    now = time.time()
    sid = data.get("id") or str(uuid.uuid4())
    with _lock:
        c = _conn()
        try:
            existing = c.execute("SELECT id FROM styles WHERE id=?", (sid,)).fetchone()
            fields = {
                "id": sid,
                "label": data["label"],
                "lock_en": data.get("lock_en") or "",
                "bible_hint_pt": data.get("bible_hint_pt") or "",
                "craft_rules_en": data.get("craft_rules_en") or "",
                "anti_drift_en": data.get("anti_drift_en") or "",
                "negatives": data.get("negatives") or "",
                "model_pack_hint": data.get("model_pack_hint") or "sfw",
                "created_from_base_id": data.get("created_from_base_id"),
                "archived": 1 if data.get("archived") else 0,
                "updated_at": now,
            }
            if existing:
                c.execute(
                    """UPDATE styles SET label=?, lock_en=?, bible_hint_pt=?, craft_rules_en=?,
                       anti_drift_en=?, negatives=?, model_pack_hint=?, created_from_base_id=?,
                       archived=?, updated_at=? WHERE id=?""",
                    (
                        fields["label"],
                        fields["lock_en"],
                        fields["bible_hint_pt"],
                        fields["craft_rules_en"],
                        fields["anti_drift_en"],
                        fields["negatives"],
                        fields["model_pack_hint"],
                        fields["created_from_base_id"],
                        fields["archived"],
                        fields["updated_at"],
                        sid,
                    ),
                )
            else:
                c.execute(
                    """INSERT INTO styles(id,label,lock_en,bible_hint_pt,craft_rules_en,anti_drift_en,
                       negatives,model_pack_hint,created_from_base_id,archived,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        sid,
                        fields["label"],
                        fields["lock_en"],
                        fields["bible_hint_pt"],
                        fields["craft_rules_en"],
                        fields["anti_drift_en"],
                        fields["negatives"],
                        fields["model_pack_hint"],
                        fields["created_from_base_id"],
                        fields["archived"],
                        now,
                        now,
                    ),
                )
            c.commit()
            return get_style(sid)  # type: ignore[return-value]
        finally:
            c.close()


def archive_style(style_id: str) -> None:
    with _lock:
        c = _conn()
        try:
            c.execute(
                "UPDATE styles SET archived=1, updated_at=? WHERE id=?",
                (time.time(), style_id),
            )
            c.commit()
        finally:
            c.close()


# --- projects ---

def _project_row(r: sqlite3.Row | None) -> dict[str, Any] | None:
    d = _row(r)
    if not d:
        return None
    if "takes" not in d and "takes_json" in d:
        try:
            d["takes"] = json.loads(d["takes_json"] or "[]")
        except json.JSONDecodeError:
            d["takes"] = []
    if "stats" not in d:
        try:
            d["stats"] = json.loads(d.get("stats_json") or "{}")
        except json.JSONDecodeError:
            d["stats"] = {}
    return d


def list_projects(include_archived: bool = False) -> list[dict[str, Any]]:
    with _lock:
        c = _conn()
        try:
            if include_archived:
                rows = c.execute(
                    "SELECT * FROM projects ORDER BY updated_at DESC"
                ).fetchall()
            else:
                rows = c.execute(
                    "SELECT * FROM projects WHERE status != 'archived' "
                    "ORDER BY updated_at DESC"
                ).fetchall()
            states = {
                r["project_id"]: json.loads(r["state_json"] or "{}")
                for r in c.execute("SELECT project_id, state_json FROM runner_state").fetchall()
            }
            out = []
            for r in rows:
                d = _project_row(r)
                if not d:
                    continue
                state = states.get(d["id"]) or {}
                done = set(state.get("completed") or [])
                takes = d.get("takes") or []
                d["progress"] = {
                    "completed": len(done),
                    "total": len(takes),
                    "completed_ns": sorted(done),
                }
                from .masters import resolve_master_path

                master_path = resolve_master_path(d)
                d["has_master"] = master_path is not None
                poster_file = PROJECTS_DIR / d["id"] / "poster.jpg"
                d["has_poster"] = poster_file.exists()
                d["poster_url"] = f"/api/projects/{d['id']}/poster"
                d["master_url"] = f"/api/projects/{d['id']}/master" if d["has_master"] else None
                out.append(d)
            return out
        finally:
            c.close()


def get_project(project_id: str) -> dict[str, Any] | None:
    with _lock:
        c = _conn()
        try:
            return _project_row(
                c.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
            )
        finally:
            c.close()


def get_project_by_slug(slug: str) -> dict[str, Any] | None:
    with _lock:
        c = _conn()
        try:
            return _project_row(
                c.execute("SELECT * FROM projects WHERE slug=?", (slug,)).fetchone()
            )
        finally:
            c.close()


def create_project(data: dict[str, Any]) -> dict[str, Any]:
    now = time.time()
    pid = str(uuid.uuid4())
    slug = data.get("slug") or _slugify(data.get("title") or "video")
    # ensure unique slug
    base = slug
    n = 1
    while get_project_by_slug(slug):
        n += 1
        slug = f"{base}-{n}"
    with _lock:
        c = _conn()
        try:
            c.execute(
                """INSERT INTO projects(
                    id,slug,title,brief,status,review_mode,model_pack,style_id,
                    max_duration_sec,width,height,steps,synopsis,roteiro_md,takes_json,
                    seed_base,stats_json,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    pid,
                    slug,
                    data.get("title") or "Sem título",
                    data.get("brief") or "",
                    data.get("status") or "draft",
                    data.get("review_mode") or "automatico",
                    data.get("model_pack") or "sfw",
                    data.get("style_id"),
                    float(data.get("max_duration_sec") or 60),
                    int(data.get("width") or 544),
                    int(data.get("height") or 992),
                    int(data.get("steps") or 8),
                    data.get("synopsis") or "",
                    data.get("roteiro_md") or "",
                    json.dumps(data.get("takes") or [], ensure_ascii=False),
                    int(data.get("seed_base") or 2000),
                    json.dumps(data.get("stats") or {}, ensure_ascii=False),
                    now,
                    now,
                ),
            )
            c.commit()
        finally:
            c.close()
    return get_project(pid)  # type: ignore[return-value]


def update_project(project_id: str, **fields: Any) -> dict[str, Any] | None:
    if not fields:
        return get_project(project_id)
    allowed = {
        "title",
        "brief",
        "status",
        "review_mode",
        "model_pack",
        "style_id",
        "max_duration_sec",
        "width",
        "height",
        "steps",
        "synopsis",
        "roteiro_md",
        "takes",
        "queue_pos",
        "seed_base",
        "stats",
        "review_take",
        "review_full_path",
        "review_current_path",
        "error",
        "slug",
    }
    cols: list[str] = []
    vals: list[Any] = []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k == "takes":
            cols.append("takes_json=?")
            vals.append(json.dumps(v or [], ensure_ascii=False))
        elif k == "stats":
            cols.append("stats_json=?")
            vals.append(json.dumps(v or {}, ensure_ascii=False))
        else:
            cols.append(f"{k}=?")
            vals.append(v)
    if not cols:
        return get_project(project_id)
    cols.append("updated_at=?")
    vals.append(time.time())
    vals.append(project_id)
    with _lock:
        c = _conn()
        try:
            c.execute(f"UPDATE projects SET {', '.join(cols)} WHERE id=?", vals)
            c.commit()
        finally:
            c.close()
    return get_project(project_id)


def archive_project(project_id: str) -> dict[str, Any] | None:
    return update_project(project_id, status="archived", queue_pos=None)


def delete_project(project_id: str, *, hard: bool = False) -> None:
    """Default: soft-archive. hard=True removes permanently."""
    if not hard:
        archive_project(project_id)
        return
    with _lock:
        c = _conn()
        try:
            c.execute("DELETE FROM jobs WHERE project_id=?", (project_id,))
            c.execute("DELETE FROM runner_state WHERE project_id=?", (project_id,))
            c.execute("DELETE FROM projects WHERE id=?", (project_id,))
            c.commit()
        finally:
            c.close()


def projects_awaiting_review() -> list[dict[str, Any]]:
    with _lock:
        c = _conn()
        try:
            rows = c.execute(
                "SELECT * FROM projects WHERE status='awaiting_review' ORDER BY updated_at"
            ).fetchall()
            return [_project_row(r) for r in rows]  # type: ignore[misc]
        finally:
            c.close()


def queued_projects() -> list[dict[str, Any]]:
    with _lock:
        c = _conn()
        try:
            rows = c.execute(
                """SELECT * FROM projects
                   WHERE status IN ('queued','generating','awaiting_review','paused')
                   ORDER BY COALESCE(queue_pos, 9999), updated_at"""
            ).fetchall()
            return [_project_row(r) for r in rows]  # type: ignore[misc]
        finally:
            c.close()


# --- jobs ---

def enqueue_job(
    project_id: str,
    kind: str,
    payload: dict[str, Any] | None = None,
    priority: int = 100,
) -> dict[str, Any]:
    jid = str(uuid.uuid4())
    now = time.time()
    with _lock:
        c = _conn()
        try:
            c.execute(
                """INSERT INTO jobs(id,project_id,kind,payload_json,status,priority,created_at)
                   VALUES(?,?,?,?,?,?,?)""",
                (
                    jid,
                    project_id,
                    kind,
                    json.dumps(payload or {}, ensure_ascii=False),
                    "queued",
                    priority,
                    now,
                ),
            )
            c.commit()
        finally:
            c.close()
    return get_job(jid)  # type: ignore[return-value]


def get_job(job_id: str) -> dict[str, Any] | None:
    with _lock:
        c = _conn()
        try:
            r = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            d = _row(r)
            if d and "payload" not in d:
                try:
                    d["payload"] = json.loads(d.get("payload_json") or "{}")
                except json.JSONDecodeError:
                    d["payload"] = {}
            return d
        finally:
            c.close()


def update_job(job_id: str, **fields: Any) -> None:
    cols, vals = [], []
    for k, v in fields.items():
        if k == "payload":
            cols.append("payload_json=?")
            vals.append(json.dumps(v, ensure_ascii=False))
        else:
            cols.append(f"{k}=?")
            vals.append(v)
    if not cols:
        return
    vals.append(job_id)
    with _lock:
        c = _conn()
        try:
            c.execute(f"UPDATE jobs SET {', '.join(cols)} WHERE id=?", vals)
            c.commit()
        finally:
            c.close()


def next_queued_job() -> dict[str, Any] | None:
    with _lock:
        c = _conn()
        try:
            r = c.execute(
                """SELECT * FROM jobs WHERE status='queued'
                   ORDER BY priority ASC, created_at ASC LIMIT 1"""
            ).fetchone()
            d = _row(r)
            if d and "payload" not in d:
                try:
                    d["payload"] = json.loads(d.get("payload_json") or "{}")
                except json.JSONDecodeError:
                    d["payload"] = {}
            return d
        finally:
            c.close()


def active_job() -> dict[str, Any] | None:
    with _lock:
        c = _conn()
        try:
            r = c.execute(
                """SELECT * FROM jobs WHERE status IN ('running','awaiting_review')
                   ORDER BY started_at DESC LIMIT 1"""
            ).fetchone()
            d = _row(r)
            if d and "payload" not in d:
                try:
                    d["payload"] = json.loads(d.get("payload_json") or "{}")
                except json.JSONDecodeError:
                    d["payload"] = {}
            return d
        finally:
            c.close()


def list_jobs(limit: int = 50) -> list[dict[str, Any]]:
    with _lock:
        c = _conn()
        try:
            rows = c.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            out = []
            for r in rows:
                d = _row(r)
                if d:
                    try:
                        d["payload"] = json.loads(d.get("payload_json") or "{}")
                    except json.JSONDecodeError:
                        d["payload"] = {}
                    out.append(d)
            return out
        finally:
            c.close()


def jobs_for_project(project_id: str) -> list[dict[str, Any]]:
    with _lock:
        c = _conn()
        try:
            rows = c.execute(
                "SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC",
                (project_id,),
            ).fetchall()
            out = []
            for r in rows:
                d = _row(r)
                if d:
                    try:
                        d["payload"] = json.loads(d.get("payload_json") or "{}")
                    except json.JSONDecodeError:
                        d["payload"] = {}
                    out.append(d)
            return out
        finally:
            c.close()


def recover_orphaned_jobs() -> int:
    """After restart: put interrupted work back in the queue (not 'paused').

    'paused' is reserved for an explicit user pause. Orphaned generating jobs
    used to be marked paused, which looked like generation was intentionally
    stopped and left the worker with nothing to run.

    External-runner projects are left alone (synced from outside state files).
    """
    with _lock:
        c = _conn()
        try:
            # Cancel jobs tied to external projects instead of requeueing them
            ext_rows = c.execute(
                "SELECT id, stats_json FROM projects"
            ).fetchall()
            ext_ids = set()
            for r in ext_rows:
                try:
                    if json.loads(r["stats_json"] or "{}").get("external_runner"):
                        ext_ids.add(r["id"])
                except json.JSONDecodeError:
                    pass
            for pid in ext_ids:
                c.execute(
                    """UPDATE jobs SET status='cancelled',
                       message='Externo — não retomar no worker'
                       WHERE project_id=? AND status IN ('queued','running','paused','awaiting_review')""",
                    (pid,),
                )

            cur = c.execute(
                """UPDATE jobs SET status='queued', message='Retomado após reinício do servidor'
                   WHERE status IN ('running', 'paused')
                   AND project_id NOT IN (
                     SELECT id FROM projects WHERE stats_json LIKE '%\"external_runner\": true%'
                        OR stats_json LIKE '%\"external_runner\":true%'
                   )"""
            )
            c.execute(
                """UPDATE projects SET status='queued'
                   WHERE status IN ('generating', 'paused')
                   AND (stats_json NOT LIKE '%\"external_runner\": true%'
                        AND stats_json NOT LIKE '%\"external_runner\":true%')"""
            )
            c.commit()
            return cur.rowcount
        finally:
            c.close()


def ensure_jobs_for_queued_projects() -> int:
    """Create generate_video jobs for queue projects that have none pending.

    Skips projects marked external_runner (driven by outside Continuity runners).
    """
    created = 0
    with _lock:
        c = _conn()
        try:
            rows = c.execute(
                """SELECT id, stats_json FROM projects
                   WHERE status IN ('queued', 'generating', 'paused')"""
            ).fetchall()
            for r in rows:
                pid = r["id"]
                try:
                    stats = json.loads(r["stats_json"] or "{}")
                except json.JSONDecodeError:
                    stats = {}
                if stats.get("external_runner"):
                    continue
                # also skip if runner_state says external
                rs = c.execute(
                    "SELECT state_json FROM runner_state WHERE project_id=?", (pid,)
                ).fetchone()
                if rs:
                    try:
                        if json.loads(rs["state_json"] or "{}").get("external"):
                            continue
                    except json.JSONDecodeError:
                        pass
                existing = c.execute(
                    """SELECT id FROM jobs
                       WHERE project_id=? AND status IN ('queued','running','paused','awaiting_review')
                       LIMIT 1""",
                    (pid,),
                ).fetchone()
                if existing:
                    continue
                jid = str(uuid.uuid4())
                c.execute(
                    """INSERT INTO jobs(id,project_id,kind,payload_json,status,priority,created_at)
                       VALUES(?,?,?,?,?,?,?)""",
                    (
                        jid,
                        pid,
                        "generate_video",
                        "{}",
                        "queued",
                        100,
                        time.time(),
                    ),
                )
                c.execute(
                    "UPDATE projects SET status='queued' WHERE id=? AND status='paused'",
                    (pid,),
                )
                created += 1
            c.commit()
            return created
        finally:
            c.close()


def requeue_paused() -> int:
    """Explicit resume: paused jobs/projects → queued."""
    with _lock:
        c = _conn()
        try:
            cur = c.execute(
                "UPDATE jobs SET status='queued', message='Retomado' WHERE status='paused'"
            )
            c.execute("UPDATE projects SET status='queued' WHERE status='paused'")
            c.commit()
            return cur.rowcount
        finally:
            c.close()


# --- runner state ---

def get_runner_state(project_id: str) -> dict[str, Any]:
    with _lock:
        c = _conn()
        try:
            r = c.execute(
                "SELECT state_json FROM runner_state WHERE project_id=?", (project_id,)
            ).fetchone()
            if not r:
                return {"completed": [], "last_ok": None}
            return json.loads(r["state_json"])
        finally:
            c.close()


def save_runner_state(project_id: str, state: dict[str, Any]) -> None:
    with _lock:
        c = _conn()
        try:
            c.execute(
                """INSERT INTO runner_state(project_id, state_json) VALUES(?,?)
                   ON CONFLICT(project_id) DO UPDATE SET state_json=excluded.state_json""",
                (project_id, json.dumps(state, ensure_ascii=False)),
            )
            c.commit()
        finally:
            c.close()


def _slugify(text: str) -> str:
    import re

    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"[-\s]+", "-", s).strip("-")
    return s[:60] or "video"
