from __future__ import annotations

import json
import re
import subprocess
from typing import Any

from . import db
from .config import (
    ENERGY_PSU_EFFICIENCY,
    ENERGY_SYSTEM_OVERHEAD_W,
    ENERGY_TARIFF_BRL_PER_KWH,
    ETA_SEC_BY_VRAM,
    ETA_SEC_PER_TAKE_DEFAULT,
    MACHINE_PROFILE_PATH,
)

_TDP_BY_NAME: list[tuple[re.Pattern[str], float]] = [
    (re.compile(r"3050\s*laptop|3050\s*ti\s*laptop|3050\s*max-?q", re.I), 60.0),
    (re.compile(r"3050", re.I), 115.0),
    (re.compile(r"3060\s*laptop|3060\s*max-?q", re.I), 80.0),
    (re.compile(r"3060", re.I), 170.0),
    (re.compile(r"4060\s*laptop", re.I), 90.0),
    (re.compile(r"4060", re.I), 115.0),
    (re.compile(r"4070", re.I), 200.0),
    (re.compile(r"4080", re.I), 320.0),
    (re.compile(r"4090", re.I), 450.0),
]


def _tdp_for_name(name: str) -> float | None:
    for pattern, watts in _TDP_BY_NAME:
        if pattern.search(name or ""):
            return watts
    return None


def _nvidia_smi_query() -> dict[str, Any] | None:
    try:
        proc = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,power.limit,power.draw",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    if proc.returncode != 0 or not (proc.stdout or "").strip():
        return None
    line = proc.stdout.strip().splitlines()[0]
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 1:
        return None
    name = parts[0]
    vram_mb = None
    power_limit = None
    power_draw = None
    if len(parts) >= 2:
        try:
            vram_mb = float(parts[1])
        except ValueError:
            vram_mb = None
    if len(parts) >= 3:
        try:
            power_limit = float(parts[2])
        except ValueError:
            power_limit = None
    if len(parts) >= 4:
        try:
            power_draw = float(parts[3])
        except ValueError:
            power_draw = None
    return {
        "gpu_name": name,
        "vram_mb": vram_mb,
        "power_limit_w": power_limit,
        "power_draw_w": power_draw,
    }


def wall_watts(
    gpu_power_w: float,
    overhead_w: float = ENERGY_SYSTEM_OVERHEAD_W,
    psu_efficiency: float = ENERGY_PSU_EFFICIENCY,
) -> float:
    eff = max(0.5, min(1.0, float(psu_efficiency)))
    return (float(gpu_power_w) + float(overhead_w)) / eff


def energy_kwh(machine_sec: float, watts: float) -> float:
    return max(0.0, float(machine_sec)) / 3600.0 * (float(watts) / 1000.0)


def cost_brl(kwh: float, tariff: float = ENERGY_TARIFF_BRL_PER_KWH) -> float:
    return max(0.0, float(kwh)) * float(tariff)


def detect_machine_profile(
    tariff: float | None = None,
    overhead_w: float | None = None,
    override_watts: float | None = None,
) -> dict[str, Any]:
    tariff = ENERGY_TARIFF_BRL_PER_KWH if tariff is None else float(tariff)
    overhead = ENERGY_SYSTEM_OVERHEAD_W if overhead_w is None else float(overhead_w)
    detected = _nvidia_smi_query() or {}
    gpu_name = detected.get("gpu_name") or "GPU desconhecida"
    gpu_w = detected.get("power_limit_w")
    if gpu_w is None or gpu_w <= 0:
        gpu_w = _tdp_for_name(gpu_name) or 100.0
    if override_watts is not None and override_watts > 0:
        watts = float(override_watts)
        source = "override"
    else:
        watts = wall_watts(float(gpu_w), overhead)
        source = "nvidia-smi" if detected else "tdp_table"
    vram_mb = detected.get("vram_mb")
    vram_gb = round(float(vram_mb) / 1024.0, 1) if vram_mb else None
    profile = {
        "gpu_name": gpu_name,
        "vram_mb": vram_mb,
        "vram_gb": vram_gb,
        "gpu_power_w": float(gpu_w),
        "power_draw_w": detected.get("power_draw_w"),
        "overhead_w": overhead,
        "psu_efficiency": ENERGY_PSU_EFFICIENCY,
        "watts": round(watts, 1),
        "tariff_brl_per_kwh": tariff,
        "tariff_label": "Tarifa configurável (R$/kWh)",
        "source": source,
    }
    return profile


def load_or_detect_profile() -> dict[str, Any]:
    saved = db.get_setting("machine_profile")
    if isinstance(saved, dict) and saved.get("watts"):
        # refresh live draw
        live = _nvidia_smi_query() or {}
        saved = dict(saved)
        if live.get("power_draw_w") is not None:
            saved["power_draw_w"] = live["power_draw_w"]
        if live.get("gpu_name"):
            saved["gpu_name"] = live["gpu_name"]
        return saved
    if MACHINE_PROFILE_PATH.exists():
        try:
            data = json.loads(MACHINE_PROFILE_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("watts"):
                db.set_setting("machine_profile", data)
                return data
        except (OSError, json.JSONDecodeError):
            pass
    profile = detect_machine_profile()
    save_profile(profile)
    return profile


def save_profile(profile: dict[str, Any]) -> dict[str, Any]:
    db.set_setting("machine_profile", profile)
    MACHINE_PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    MACHINE_PROFILE_PATH.write_text(
        json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return profile


def apply_machine_cost(
    *,
    watts: float | None = None,
    tariff: float | None = None,
) -> dict[str, Any]:
    current = load_or_detect_profile()
    profile = detect_machine_profile(
        tariff=tariff if tariff is not None else current.get("tariff_brl_per_kwh"),
        overhead_w=current.get("overhead_w"),
        override_watts=watts,
    )
    return save_profile(profile)


def sec_per_take(vram_gb: float | None = None) -> float:
    calibrated = db.get_setting("eta_sec_per_take")
    if isinstance(calibrated, (int, float)) and calibrated > 60:
        return float(calibrated)
    if vram_gb is None:
        profile = load_or_detect_profile()
        vram_gb = profile.get("vram_gb")
    if not vram_gb:
        return ETA_SEC_PER_TAKE_DEFAULT
    best = ETA_SEC_PER_TAKE_DEFAULT
    for tier, sec in sorted(ETA_SEC_BY_VRAM.items()):
        if vram_gb >= tier:
            best = sec
    return best


def eta_source() -> str:
    calibrated = db.get_setting("eta_sec_per_take")
    if isinstance(calibrated, (int, float)) and calibrated > 60:
        samples = db.get_setting("eta_samples") or 0
        return f"calibrado ({int(samples) if samples else 'avg'})"
    return "tabela VRAM"


def resolve_live_started_at(live: dict[str, Any] | None, now_ts: float | None = None) -> float | None:
    """Wall-clock start for the prompt currently running on Comfy.

    Comfy's create_time is when the prompt was *queued*, which can be many
    minutes before it actually starts — so we latch first-seen-as-running.
    """
    import time

    if not live or not live.get("prompt_id"):
        return None
    now_ts = time.time() if now_ts is None else float(now_ts)
    pid = str(live["prompt_id"])
    prev = db.get_setting("eta_live_prompt")
    if isinstance(prev, dict) and str(prev.get("prompt_id")) == pid and prev.get("first_seen_at"):
        return float(prev["first_seen_at"])
    queued_at = live.get("started_at")
    try:
        queued_at = float(queued_at) if queued_at is not None else None
    except (TypeError, ValueError):
        queued_at = None
    # If create_time is fresh (<2 min), trust it; otherwise this prompt just
    # became running after waiting in Comfy's queue.
    if queued_at and (now_ts - queued_at) < 120:
        first = queued_at
    else:
        first = now_ts
    db.set_setting("eta_live_prompt", {"prompt_id": pid, "first_seen_at": first, "slug": live.get("slug")})
    return first


def take_weight(take: dict[str, Any] | None, default_dur: float = 5.0) -> float:
    """Scale ETA by clip duration (5s baseline). Longer H3 takes cost more wall time."""
    if not take:
        return 1.0
    try:
        dur = float(take.get("duration") or default_dur)
    except (TypeError, ValueError):
        dur = default_dur
    return max(0.55, min(2.2, dur / default_dur))


def _fmt_min(sec: float) -> float:
    return round(max(0.0, sec) / 60.0, 1)


def _finish_label(remaining_sec: float, now: float | None = None) -> str:
    import time
    from datetime import datetime

    now = time.time() if now is None else float(now)
    finish = datetime.fromtimestamp(now + max(0.0, remaining_sec))
    return finish.strftime("%H:%M")


def estimate_generation(
    take_count: int,
    *,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    profile = profile or load_or_detect_profile()
    spt = sec_per_take(profile.get("vram_gb"))
    total_sec = max(0, int(take_count)) * spt
    watts = float(profile.get("watts") or 150)
    tariff = float(profile.get("tariff_brl_per_kwh") or ENERGY_TARIFF_BRL_PER_KWH)
    kwh = energy_kwh(total_sec, watts)
    return {
        "take_count": take_count,
        "sec_per_take": round(spt, 1),
        "total_sec": round(total_sec, 1),
        "total_min": _fmt_min(total_sec),
        "watts": watts,
        "energy_kwh": round(kwh, 4),
        "cost_brl": round(cost_brl(kwh, tariff), 2),
        "tariff_brl_per_kwh": tariff,
        "source": eta_source(),
        "finish_at": _finish_label(total_sec) if total_sec > 0 else None,
    }


def estimate_project(
    project: dict[str, Any],
    *,
    profile: dict[str, Any] | None = None,
    now_live: dict[str, Any] | None = None,
    job: dict[str, Any] | None = None,
    now_ts: float | None = None,
) -> dict[str, Any]:
    """Remaining-time estimate for one project (not full story from scratch)."""
    import time

    profile = profile or load_or_detect_profile()
    now_ts = time.time() if now_ts is None else float(now_ts)
    takes = project.get("takes") or []
    state = project.get("runner_state") or db.get_runner_state(project["id"])
    done = {int(x) for x in (state.get("completed") or [])}
    by_n = {int(t.get("n") or 0): t for t in takes if int(t.get("n") or 0) > 0}
    remaining_ns = [n for n in sorted(by_n) if n not in done]
    spt = sec_per_take(profile.get("vram_gb"))

    current_n = None
    if now_live and now_live.get("slug") == project.get("slug") and now_live.get("take"):
        current_n = int(now_live["take"])
    elif state.get("current_take"):
        current_n = int(state["current_take"])
    elif remaining_ns:
        current_n = remaining_ns[0]

    # Wall time already spent on the live take
    started_at = None
    is_live_here = bool(now_live and now_live.get("slug") == project.get("slug"))
    if is_live_here:
        started_at = resolve_live_started_at(now_live, now_ts)
    if started_at is None and job and str(job.get("project_id")) == str(project.get("id")):
        # Internal job clock only if this project is the one on Comfy (or Comfy idle)
        if is_live_here or not now_live:
            started_at = job.get("started_at")
    if started_at is None and is_live_here:
        started_at = state.get("take_started_at")

    current_budget = spt * take_weight(by_n.get(current_n or 0))
    elapsed = max(0.0, now_ts - float(started_at)) if started_at else 0.0
    # Don't let a stuck clock go negative; after 95% of budget keep a small tail
    if current_n and current_n in remaining_ns:
        if elapsed > 0:
            current_left = max(current_budget * 0.08, current_budget - elapsed)
        else:
            current_left = current_budget
    else:
        current_left = 0.0

    rest_sec = 0.0
    for n in remaining_ns:
        if n == current_n:
            continue
        rest_sec += spt * take_weight(by_n.get(n))

    total_sec = current_left + rest_sec
    watts = float(profile.get("watts") or 150)
    tariff = float(profile.get("tariff_brl_per_kwh") or ENERGY_TARIFF_BRL_PER_KWH)
    kwh = energy_kwh(total_sec, watts)
    pct_take = 0.0
    if current_n and current_budget > 0:
        pct_take = min(99.0, 100.0 * elapsed / current_budget) if elapsed else 0.0

    return {
        "take_count": len(remaining_ns),
        "takes_done": len(done),
        "takes_total": len(by_n) or len(takes),
        "current_take": current_n,
        "sec_per_take": round(spt, 1),
        "current_take_sec": round(current_left, 1),
        "current_take_min": _fmt_min(current_left),
        "current_take_pct": round(pct_take, 1),
        "current_elapsed_sec": round(elapsed, 1) if elapsed else 0.0,
        "rest_sec": round(rest_sec, 1),
        "total_sec": round(total_sec, 1),
        "total_min": _fmt_min(total_sec),
        "finish_at": _finish_label(total_sec, now_ts) if total_sec > 0 else None,
        "watts": watts,
        "energy_kwh": round(kwh, 4),
        "cost_brl": round(cost_brl(kwh, tariff), 2),
        "tariff_brl_per_kwh": tariff,
        "source": eta_source(),
    }


def estimate_queue(
    projects: list[dict[str, Any]],
    *,
    active_job: dict[str, Any] | None = None,
    now_live: dict[str, Any] | None = None,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Sum remaining work in queue order; expose live take ETA separately."""
    import time

    profile = profile or load_or_detect_profile()
    now_ts = time.time()
    ordered = sorted(projects, key=lambda p: int(p.get("queue_pos") or 9999))
    # Prefer Comfy-live project first in the timeline
    if now_live and now_live.get("slug"):
        live_slug = now_live["slug"]
        ordered = sorted(
            ordered,
            key=lambda p: (
                0 if p.get("slug") == live_slug else 1,
                int(p.get("queue_pos") or 9999),
            ),
        )

    per_project: list[dict[str, Any]] = []
    total_sec = 0.0
    take_count = 0
    current: dict[str, Any] | None = None

    for i, p in enumerate(ordered):
        if p.get("status") in {"done", "failed", "draft", "archived"}:
            continue
        # Only attribute the live job clock to the matching project
        job = active_job if active_job and str(active_job.get("project_id")) == str(p["id"]) else None
        live = now_live if now_live and now_live.get("slug") == p.get("slug") else None
        est = estimate_project(p, profile=profile, now_live=live, job=job, now_ts=now_ts)
        if est["take_count"] <= 0:
            continue
        # After the live project, later projects wait for full remaining of earlier ones
        if i > 0 and per_project:
            # already counted earlier remaining into total_sec; est is independent — OK to sum
            pass
        per_project.append(
            {
                "project_id": p["id"],
                "title": p.get("title"),
                "slug": p.get("slug"),
                **est,
            }
        )
        total_sec += float(est["total_sec"])
        take_count += int(est["take_count"])
        if current is None and (live or (job and job.get("status") == "running") or p.get("is_active")):
            current = {
                "project_id": p["id"],
                "title": p.get("title"),
                "slug": p.get("slug"),
                "take": est.get("current_take"),
                "sec": est.get("current_take_sec"),
                "min": est.get("current_take_min"),
                "pct": est.get("current_take_pct"),
                "finish_at": _finish_label(float(est.get("current_take_sec") or 0), now_ts),
            }

    # If nothing marked active, still expose first project's current take ETA
    if current is None and per_project:
        first = per_project[0]
        current = {
            "project_id": first["project_id"],
            "title": first.get("title"),
            "slug": first.get("slug"),
            "take": first.get("current_take"),
            "sec": first.get("current_take_sec"),
            "min": first.get("current_take_min"),
            "pct": first.get("current_take_pct"),
            "finish_at": _finish_label(float(first.get("current_take_sec") or 0), now_ts),
        }

    spt = sec_per_take(profile.get("vram_gb"))
    watts = float(profile.get("watts") or 150)
    tariff = float(profile.get("tariff_brl_per_kwh") or ENERGY_TARIFF_BRL_PER_KWH)
    kwh = energy_kwh(total_sec, watts)
    return {
        "take_count": take_count,
        "sec_per_take": round(spt, 1),
        "total_sec": round(total_sec, 1),
        "total_min": _fmt_min(total_sec),
        "finish_at": _finish_label(total_sec, now_ts) if total_sec > 0 else None,
        "watts": watts,
        "energy_kwh": round(kwh, 4),
        "cost_brl": round(cost_brl(kwh, tariff), 2),
        "tariff_brl_per_kwh": tariff,
        "source": eta_source(),
        "current": current,
        "projects": per_project,
    }


def record_take_duration(actual_sec: float, *, take_duration_sec: float | None = None) -> float:
    """Update moving average ETA from a completed take (normalized to 5s baseline)."""
    if actual_sec < 90:
        return sec_per_take()
    weight = 1.0
    if take_duration_sec and take_duration_sec > 0:
        weight = take_weight({"duration": take_duration_sec})
    normalized = float(actual_sec) / max(0.55, weight)
    # Clamp absurd outliers (failed/retry storms)
    normalized = max(180.0, min(2400.0, normalized))
    prev = db.get_setting("eta_sec_per_take")
    samples = int(db.get_setting("eta_samples") or 0)
    if isinstance(prev, (int, float)) and prev > 60 and samples > 0:
        # More samples → slower drift
        alpha = 0.35 if samples < 5 else 0.2
        new = (1.0 - alpha) * float(prev) + alpha * normalized
    else:
        new = normalized
    db.set_setting("eta_sec_per_take", round(new, 1))
    db.set_setting("eta_samples", samples + 1)
    return new


def record_take_interval_from_state(prev_last_ok: dict | None, new_last_ok: dict | None, take: dict | None = None) -> float | None:
    """Calibrate when external runner advances last_ok timestamps."""
    if not new_last_ok:
        return None
    try:
        new_ts = float(new_last_ok.get("ts") or 0)
    except (TypeError, ValueError):
        return None
    if new_ts <= 0:
        return None
    prev_ts = None
    if prev_last_ok:
        try:
            prev_ts = float(prev_last_ok.get("ts") or 0)
        except (TypeError, ValueError):
            prev_ts = None
    if not prev_ts or prev_ts <= 0:
        return None
    delta = new_ts - prev_ts
    if delta < 90:
        return None
    return record_take_duration(delta, take_duration_sec=(take or {}).get("duration"))
