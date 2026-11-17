from __future__ import annotations

import shutil
import subprocess
import os
import threading
from urllib.parse import urlparse
from pathlib import Path
from typing import Any

import httpx

from .. import db
from ..config import (
    COMFYUI_REPO,
    COMFYUI_ROOT,
    DASIWA_REPO,
    MODEL_DOWNLOAD_URLS,
    MODEL_MIN_BYTES,
    MODEL_PATHS,
    WORKFLOWS_DIR,
)
from ..llm.providers import llm_config
from .hardware import hardware_report

_download_lock = threading.Lock()


def model_download_url(key: str) -> str | None:
    return (db.get_setting('model_download_urls') or {}).get(key) or MODEL_DOWNLOAD_URLS.get(key)


def set_model_download_url(key: str, url: str) -> None:
    if key not in MODEL_PATHS:
        raise ValueError('Modelo desconhecido')
    parsed = urlparse(url)
    if url and (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password):
        raise ValueError('Informe um link direto HTTPS, sem credenciais na URL.')
    urls = dict(db.get_setting('model_download_urls') or {})
    if url:
        urls[key] = url
    else:
        urls.pop(key, None)
    db.set_setting('model_download_urls', urls)


def comfy_root() -> Path:
    cfg = db.get_setting("comfyui_root")
    if cfg:
        return Path(cfg)
    return COMFYUI_ROOT


def model_file(key: str) -> Path:
    folder, name = MODEL_PATHS[key]
    return comfy_root() / "models" / folder / name


def model_status() -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, (folder, name) in MODEL_PATHS.items():
        path = comfy_root() / "models" / folder / name
        exists = path.exists()
        size = path.stat().st_size if exists else 0
        min_b = MODEL_MIN_BYTES.get(key, 1)
        url = model_download_url(key)
        out[key] = {
            "key": key,
            "name": name,
            "folder": folder,
            "path": str(path),
            "exists": exists,
            "size": size,
            "ok": exists and size >= min_b,
            "required_for": "nsfw" if "nsfw" in key else ("both" if key.startswith("vae") else "sfw"),
            "can_auto_download": bool(url),
            "download_url": url,
            "label": {'unet_sfw': 'MiniMax H3 · modelo SFW', 'unet_nsfw': 'MiniMax H3 · modelo NSFW',
                      'clip_sfw': 'H3 · encoder de texto SFW', 'clip_nsfw': 'H3 · encoder de texto NSFW',
                      'vae_v': 'H3 · VAE de vídeo (compartilhado)', 'vae_a': 'H3 · VAE de áudio (compartilhado)'}[key],
            "download_hint": (
                f"Coloque o arquivo em models/{folder}/{name}"
                + (" (download automático disponível)." if url else " (NSFW: baixe manualmente).")
            ),
        }
    sfw_ok = all(out[k]["ok"] for k in ("unet_sfw", "clip_sfw", "vae_v", "vae_a"))
    nsfw_ok = all(out[k]["ok"] for k in ("unet_nsfw", "clip_nsfw", "vae_v", "vae_a"))
    return {"models": out, "sfw_ready": sfw_ok, "nsfw_ready": nsfw_ok}


def ensure_model_dirs() -> list[str]:
    created: list[str] = []
    for folder, _name in MODEL_PATHS.values():
        path = comfy_root() / "models" / folder
        if not path.exists():
            path.mkdir(parents=True, exist_ok=True)
            created.append(str(path))
        else:
            path.mkdir(parents=True, exist_ok=True)
    return created


def download_model(key: str) -> dict[str, Any]:
    if not _download_lock.acquire(blocking=False):
        return {'ok': False, 'error': 'Já existe um download em andamento. Aguarde sua conclusão.'}
    try:
        return _download_model(key)
    finally:
        _download_lock.release()


def _download_model(key: str) -> dict[str, Any]:
    """Download one model file if a public HF URL is configured."""
    if key not in MODEL_PATHS:
        return {"ok": False, "key": key, "error": "Modelo desconhecido"}
    url = model_download_url(key)
    if not url:
        return {
            "ok": False,
            "key": key,
            "error": "Configure o link direto HTTPS deste modelo em Configurações → ComfyUI → Modelos H3 e tente novamente.",
            "path": str(model_file(key)),
        }
    dest = model_file(key)
    if dest.exists() and dest.stat().st_size >= MODEL_MIN_BYTES.get(key, 1):
        return {"ok": True, "key": key, "message": "Já instalado", "path": str(dest)}
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        headers = {}
        if urlparse(url).hostname == 'huggingface.co' and os.environ.get('HF_TOKEN'):
            headers['Authorization'] = 'Bearer ' + os.environ['HF_TOKEN']
        with httpx.stream("GET", url, headers=headers, follow_redirects=True, timeout=httpx.Timeout(60.0, read=120.0)) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_bytes(1024 * 1024):
                    f.write(chunk)
            expected = r.headers.get('content-length')
            size = tmp.stat().st_size
            if size < MODEL_MIN_BYTES.get(key, 1) or (expected and size != int(expected)):
                raise ValueError('Download incompleto ou arquivo menor que o esperado. Confira o link direto e tente novamente.')
            # Safetensors starts with a little-endian JSON header length.
            with tmp.open('rb') as downloaded:
                header_size = int.from_bytes(downloaded.read(8), 'little')
                if not 2 <= header_size <= min(size - 8, 100_000_000) or downloaded.read(1) != b'{':
                    raise ValueError('O link não retornou um arquivo safetensors válido. Use o link direto do arquivo, não a página do modelo.')
        tmp.replace(dest)
    except Exception as exc:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        if isinstance(exc, httpx.HTTPStatusError):
            code = exc.response.status_code
            hint = ('Acesso negado: aceite os termos no Hugging Face e configure HF_TOKEN no ambiente do Promptera.'
                    if code in (401, 403) else 'Arquivo não encontrado: atualize o link direto nas configurações.'
                    if code == 404 else 'Falha no servidor de download. Tente novamente mais tarde.')
            error = f'HTTP {code}. {hint}'
        else:
            error = f'{exc} Confira a conexão, o espaço em disco e o link em Configurações → ComfyUI.'
        return {"ok": False, "key": key, "error": error, "path": str(dest)}
    return {"ok": True, "key": key, "message": "Baixado", "path": str(dest), "size": dest.stat().st_size}


def download_model_pack(pack: str) -> dict[str, Any]:
    if pack not in ('sfw', 'nsfw'):
        raise ValueError('Pacote desconhecido')
    keys = ('vae_v', 'vae_a', f'unet_{pack}', f'clip_{pack}')
    results = [download_model(key) for key in keys]
    return {'ok': all(r['ok'] for r in results), 'results': results, 'models': model_status()}


def dependency_report() -> dict[str, Any]:
    root = comfy_root()
    models = model_status()
    wf_dir = root / "user" / "default" / "workflows"
    bundled = list(WORKFLOWS_DIR.glob("*.json")) if WORKFLOWS_DIR.exists() else []
    present = 0
    if wf_dir.exists():
        names = {p.name for p in wf_dir.glob("*.json")}
        present = sum(1 for b in bundled if b.name in names)
    hw = hardware_report()
    return {
        "comfyui_root": str(root),
        "comfyui": {
            "ok": (root / "main.py").exists(),
            "venv": (root / "venv").exists() or (root / ".venv").exists(),
        },
        "dasiwa": {"ok": dasiwa_installed()},
        "workflows": {
            "ok": present >= max(1, len(bundled)) if bundled else True,
            "present": present,
            "expected": len(bundled),
        },
        "ffmpeg": hw.get("ffmpeg") or {"ok": False},
        "models": models,
    }


def ensure_comfy_stack(*, download_sfw: bool = False) -> dict[str, Any]:
    """Install/fix what we can: Comfy, DaSiWa, workflows, model dirs, optional SFW downloads."""
    actions: list[dict[str, Any]] = []
    root = comfy_root()
    if not (root / "main.py").exists():
        actions.append({"step": "clone_comfy", **clone_comfyui(root)})
    else:
        actions.append({"step": "clone_comfy", "ok": True, "message": "ComfyUI ok"})
    if not dasiwa_installed():
        actions.append({"step": "dasiwa", **clone_dasiwa()})
    else:
        actions.append({"step": "dasiwa", "ok": True, "message": "DaSiWa ok"})
    copied = ensure_workflows_copied()
    actions.append(
        {
            "step": "workflows",
            "ok": True,
            "message": f"{len(copied)} workflows",
            "copied": copied,
        }
    )
    created = ensure_model_dirs()
    actions.append({"step": "model_dirs", "ok": True, "created": created})
    if download_sfw:
        for key in ("vae_v", "vae_a", "unet_sfw", "clip_sfw"):
            st = model_status()["models"][key]
            if st["ok"]:
                actions.append({"step": f"model:{key}", "ok": True, "message": "Já ok"})
            else:
                actions.append({"step": f"model:{key}", **download_model(key)})
    report = dependency_report()
    ok = (
        report["comfyui"]["ok"]
        and report["dasiwa"]["ok"]
        and report["workflows"]["ok"]
        and (report["models"]["sfw_ready"] if download_sfw else True)
    )
    return {"ok": ok, "actions": actions, "report": report}


def dasiwa_installed() -> bool:
    node_dir = comfy_root() / "custom_nodes" / "ComfyUI-DaSiWa-Nodes"
    return node_dir.exists()


async def comfy_status() -> dict[str, Any]:
    root = comfy_root()
    base = db.get_setting("comfy_base") or "http://127.0.0.1:8188"
    online = False
    stats = None
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{base.rstrip('/')}/system_stats")
            if r.status_code == 200:
                online = True
                stats = r.json()
    except Exception:
        online = False
    return {
        "root": str(root),
        "exists": root.exists(),
        "main_py": (root / "main.py").exists(),
        "venv": (root / "venv").exists() or (root / ".venv").exists(),
        "dasiwa": dasiwa_installed(),
        "base": base,
        "online": online,
        "stats": stats,
        "models": model_status(),
    }


def ensure_workflows_copied() -> list[str]:
    """Copy bundled workflows into ComfyUI/user/default/workflows if possible."""
    root = comfy_root()
    targets = [
        root / "user" / "default" / "workflows",
        root / "workflows",
    ]
    dest = None
    for t in targets:
        try:
            t.mkdir(parents=True, exist_ok=True)
            dest = t
            break
        except OSError:
            continue
    if dest is None or not WORKFLOWS_DIR.exists():
        return []
    copied = []
    for src in WORKFLOWS_DIR.glob("*.json"):
        dst = dest / src.name
        shutil.copy2(src, dst)
        copied.append(str(dst))
    return copied


def clone_comfyui(target: Path | None = None) -> dict[str, Any]:
    target = target or comfy_root()
    if (target / "main.py").exists():
        db.set_setting("comfyui_root", str(target))
        return {"ok": True, "message": "ComfyUI já existe", "path": str(target)}
    target.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["git", "clone", "--depth", "1", COMFYUI_REPO, str(target)],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return {"ok": False, "error": proc.stderr or proc.stdout}
    db.set_setting("comfyui_root", str(target))
    return {"ok": True, "message": "ComfyUI clonado", "path": str(target)}


def clone_dasiwa() -> dict[str, Any]:
    root = comfy_root()
    custom = root / "custom_nodes"
    custom.mkdir(parents=True, exist_ok=True)
    dest = custom / "ComfyUI-DaSiWa-Nodes"
    if dest.exists():
        return {"ok": True, "message": "DaSiWa já instalado", "path": str(dest)}
    proc = subprocess.run(
        ["git", "clone", "--depth", "1", DASIWA_REPO, str(dest)],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return {"ok": False, "error": proc.stderr or proc.stdout}
    return {"ok": True, "message": "DaSiWa clonado", "path": str(dest)}


def onboarding_status() -> dict[str, Any]:
    llm = llm_config()
    provider = (llm.get("provider") or "").lower()
    if provider in {"ollama"}:
        llm_ok = bool(llm.get("model") or True)
    elif provider in {"openai_compatible", "compatible", "lmstudio", "local"}:
        llm_ok = bool(llm.get("base_url"))
    elif provider in {"openai", "anthropic"}:
        llm_ok = bool(llm.get("api_key"))
    else:
        llm_ok = False
    hw = hardware_report()
    models = model_status()
    root = comfy_root()
    steps = {
        "llm": {"done": llm_ok, "label": "AI API"},
        "hardware": {
            "done": hw["verdict"] in {"ok", "tight", "unknown"},
            "label": "Hardware",
            "verdict": hw["verdict"],
        },
        "comfyui": {
            "done": (root / "main.py").exists(),
            "label": "ComfyUI",
        },
        "dasiwa": {"done": dasiwa_installed(), "label": "DaSiWa Continuity"},
        "models_sfw": {"done": models["sfw_ready"], "label": "SFW models"},
        "ffmpeg": {"done": hw["ffmpeg"]["ok"], "label": "ffmpeg"},
        "cost": {
            "done": bool(db.get_setting("machine_profile")),
            "label": "Energy cost",
        },
        "styles": {
            "done": len(db.list_styles()) > 0,
            "label": "Styles",
        },
    }
    essential = ["llm", "comfyui", "dasiwa", "models_sfw", "ffmpeg"]
    complete = all(steps[k]["done"] for k in essential)
    return {
        "complete": complete,
        "steps": steps,
        "llm": {k: v for k, v in llm.items() if k != "api_key"}
        | {"has_api_key": bool(llm.get("api_key"))},
        "hardware": hw,
        "models": models,
        "comfyui_root": str(root),
    }
