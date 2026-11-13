from __future__ import annotations

import os
import platform
import shutil
import subprocess
from typing import Any

from ..cost import _nvidia_smi_query, load_or_detect_profile


def _ram_gb() -> float | None:
    try:
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
        return round(stat.ullTotalPhys / (1024**3), 1)
    except Exception:
        return None


def _disk_free_gb(path: str) -> float | None:
    try:
        usage = shutil.disk_usage(path)
        return round(usage.free / (1024**3), 1)
    except Exception:
        return None


def _ffmpeg_ok() -> dict[str, Any]:
    exe = shutil.which("ffmpeg")
    return {"ok": bool(exe), "path": exe}


def hardware_report() -> dict[str, Any]:
    gpu = _nvidia_smi_query() or {}
    vram_gb = None
    if gpu.get("vram_mb"):
        vram_gb = round(float(gpu["vram_mb"]) / 1024.0, 1)
    ram_gb = _ram_gb()
    disk_gb = _disk_free_gb(os.environ.get("SystemDrive", "C:") + "\\")
    profile = load_or_detect_profile()

    if vram_gb is None:
        verdict = "unknown"
        message = "Não foi possível detectar GPU NVIDIA (nvidia-smi)."
        recommendations = [
            "Instale drivers NVIDIA e confirme nvidia-smi no PATH.",
            "H3 Continuity precisa ~12 GB VRAM (8 GB apertado).",
        ]
    elif vram_gb >= 12:
        verdict = "ok"
        message = f"VRAM {vram_gb} GB — adequado para MiniMax H3 Continuity."
        recommendations = [
            "Use 544×992, blocos Continuity ≤3–4 takes.",
            "Overlap 22, 8 steps (defaults da skill).",
        ]
    elif vram_gb >= 8:
        verdict = "tight"
        message = f"VRAM {vram_gb} GB — possível, mas apertado/lento."
        recommendations = [
            "Blocos Continuity curtos (2–3 takes).",
            "Evite filas longas overnight sem monitorar OOM.",
            "Feche outros apps GPU.",
        ]
    else:
        verdict = "insufficient"
        message = f"VRAM {vram_gb} GB — abaixo do mínimo prático (~8 GB)."
        recommendations = [
            "Considere GPU ≥8 GB (ideal 12+).",
            "Geração pode falhar por OOM.",
        ]

    if ram_gb is not None and ram_gb < 24:
        recommendations.append("RAM <32 GB: offload pode ficar lento.")
    if disk_gb is not None and disk_gb < 40:
        recommendations.append("Pouco disco livre — modelos H3 são grandes.")

    return {
        "os": platform.platform(),
        "gpu_name": gpu.get("gpu_name") or profile.get("gpu_name"),
        "vram_gb": vram_gb,
        "ram_gb": ram_gb,
        "disk_free_gb": disk_gb,
        "ffmpeg": _ffmpeg_ok(),
        "verdict": verdict,
        "message": message,
        "recommendations": recommendations,
        "machine_profile": profile,
    }
