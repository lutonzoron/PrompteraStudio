from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("PROMPTERA_DATA", str(ROOT / "data")))
BUNDLED_DIR = ROOT / "bundled"
WORKFLOWS_DIR = BUNDLED_DIR / "workflows"
STYLE_BASES_DIR = BUNDLED_DIR / "style_bases"
FRONTEND_DIST = ROOT / "frontend" / "dist"

DB_PATH = DATA_DIR / "studio.db"
SETTINGS_PATH = DATA_DIR / "settings.json"
MACHINE_PROFILE_PATH = DATA_DIR / "machine_profile.json"
DELIVERABLES_DIR = DATA_DIR / "deliverables"
PROJECTS_DIR = DATA_DIR / "projects"

HOST = os.environ.get("PROMPTERA_HOST", "127.0.0.1")
PORT = int(os.environ.get("PROMPTERA_PORT", "8790"))

COMFY_BASE = os.environ.get("PROMPTERA_COMFY_BASE", "http://127.0.0.1:8188")
COMFYUI_ROOT = Path(os.environ.get("PROMPTERA_COMFYUI_ROOT", r"C:\Projetos\Comfyui"))

# Defaults from skill
DEFAULT_WIDTH = 544
DEFAULT_HEIGHT = 992
DEFAULT_FPS = 24
DEFAULT_STEPS = 8
DEFAULT_OVERLAP = 22
DEFAULT_DURATION = 5.0
DURATION_MIN = 2.0
DURATION_MAX = 15.0

# Model packs
MODELS_SFW = {
    "unet": "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    "clip": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "vae_v": "minimax_h3_video_vae_fp16.safetensors",
    "vae_a": "minimax_h3_audio_vae_fp32.safetensors",
}
MODELS_NSFW = {
    # Windows ComfyUI lists nested UNET paths with backslashes
    "unet": r"MINIMAXH3\10Eros_Max_SingularityV2_PRISM2_PikaFlex_0.85_int8HQ.safetensors",
    "clip": "minimaxH3_qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors",
    "vae_v": "minimax_h3_video_vae_fp16.safetensors",
    "vae_a": "minimax_h3_audio_vae_fp32.safetensors",
}

MODEL_PATHS = {
    "unet_sfw": ("diffusion_models", MODELS_SFW["unet"]),
    "clip_sfw": ("text_encoders", MODELS_SFW["clip"]),
    "unet_nsfw": ("diffusion_models", MODELS_NSFW["unet"]),
    "clip_nsfw": ("text_encoders", MODELS_NSFW["clip"]),
    "vae_v": ("vae", MODELS_SFW["vae_v"]),
    "vae_a": ("vae", MODELS_SFW["vae_a"]),
}

# Optional HuggingFace resolve URLs for auto-download (NSFW packs are usually manual).
MODEL_DOWNLOAD_URLS = {
    "unet_sfw": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    "clip_sfw": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "vae_v": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors",
    "vae_a": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors",
}

# Expected minimum sizes (bytes) for health checks
MODEL_MIN_BYTES = {
    "unet_sfw": 4_000_000_000,
    "clip_sfw": 4_000_000_000,
    "unet_nsfw": 4_000_000_000,
    "clip_nsfw": 4_000_000_000,
    "vae_v": 100_000_000,
    "vae_a": 50_000_000,
}

ENERGY_TARIFF_BRL_PER_KWH = 0.96
ENERGY_SYSTEM_OVERHEAD_W = 80.0
ENERGY_PSU_EFFICIENCY = 0.9

# ETA seed (seconds per take) by VRAM tier
ETA_SEC_PER_TAKE_DEFAULT = 480.0  # ~8 min
ETA_SEC_BY_VRAM = {
    8: 720.0,
    12: 480.0,
    16: 420.0,
    24: 360.0,
}

DASIWA_REPO = "https://github.com/darksidewalker/ComfyUI-DaSiWa-Nodes.git"
COMFYUI_REPO = "https://github.com/comfyanonymous/ComfyUI.git"


def ensure_dirs() -> None:
    for p in (DATA_DIR, DELIVERABLES_DIR, PROJECTS_DIR, STYLE_BASES_DIR):
        p.mkdir(parents=True, exist_ok=True)
