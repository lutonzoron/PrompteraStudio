from __future__ import annotations

import json
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from .. import db
from ..comfy.client import ComfyClient
from ..config import (
    DEFAULT_DURATION,
    DEFAULT_HEIGHT,
    DEFAULT_OVERLAP,
    DEFAULT_STEPS,
    DEFAULT_WIDTH,
    DELIVERABLES_DIR,
    DURATION_MAX,
    DURATION_MIN,
    MODELS_NSFW,
    MODELS_SFW,
)
from ..onboarding.setup import comfy_root
from .review import prepare_review_clips, quarantine_latest_ready

ProgressFn = Callable[[str, float, dict[str, Any] | None], Awaitable[None]]
ReviewWaitFn = Callable[[dict[str, Any]], Awaitable[str]]


def take_duration(take: dict, default: float = DEFAULT_DURATION) -> float:
    raw = take.get("duration", default)
    d = float(raw)
    if d < DURATION_MIN or d > DURATION_MAX:
        raise ValueError(f"take {take.get('n')} duration={d} out of range")
    return d


def ckpt_root() -> Path:
    return comfy_root() / "output" / "df_h3_continuity"


def output_root() -> Path:
    return comfy_root() / "output"


def latest_ready_clip(session: str) -> str:
    root = ckpt_root() / session
    if not root.exists():
        raise FileNotFoundError(f"No session dir {root}")
    ready = []
    for clip_dir in root.iterdir():
        if not clip_dir.is_dir() or clip_dir.name.startswith("_"):
            continue
        meta_path = clip_dir / "clip.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        status = meta.get("status")
        has_latent = (clip_dir / "latent.safetensors").exists() or (
            clip_dir / "delta.safetensors"
        ).exists()
        if status in {"staged", "broken"}:
            continue
        if status == "ready" or (has_latent and status not in {"staged", "broken"}):
            ready.append((meta_path.stat().st_mtime, clip_dir.name))
    if not ready:
        raise RuntimeError(f"No ready checkpoint in {root}")
    ready.sort(key=lambda x: x[0], reverse=True)
    return ready[0][1]


def find_output_mp4(prefix: str, after_ts: float) -> Path | None:
    """Find newest mp4 under Comfy output matching prefix path fragments."""
    root = output_root()
    if not root.exists():
        return None
    parts = [p for p in prefix.replace("\\", "/").split("/") if p]
    candidates: list[tuple[float, Path]] = []
    for p in root.rglob("*.mp4"):
        if p.stat().st_mtime < after_ts - 2:
            continue
        s = str(p).replace("\\", "/")
        if parts and not all(part in s for part in parts[-2:]):
            # loose match on last two segments
            if parts[-1] not in s:
                continue
        candidates.append((p.stat().st_mtime, p))
    if not candidates:
        # fallback: newest mp4 after timestamp
        for p in root.rglob("*.mp4"):
            if p.stat().st_mtime >= after_ts - 2:
                candidates.append((p.stat().st_mtime, p))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


def find_latest_session_mp4(session: str) -> Path | None:
    """Prefer clip folder video; else newest under continuity session / output."""
    sess = ckpt_root() / session
    if sess.exists():
        vids = list(sess.rglob("*.mp4"))
        if vids:
            vids.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            return vids[0]
    root = output_root()
    if not root.exists():
        return None
    vids = [p for p in root.rglob("*.mp4") if session in str(p)]
    if not vids:
        return None
    vids.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return vids[0]


def concat_master(session_mp4s: list[Path], out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not session_mp4s:
        raise RuntimeError("Nenhum MP4 para concat")
    if len(session_mp4s) == 1:
        shutil.copy2(session_mp4s[0], out_path)
        return out_path
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg não está no PATH")
    list_file = out_path.parent / "_concat_list.txt"
    lines = []
    for p in session_mp4s:
        lines.append(f"file '{p.resolve().as_posix()}'")
    list_file.write_text("\n".join(lines), encoding="utf-8")
    cmd = [
        ffmpeg,
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_file),
        "-c",
        "copy",
        str(out_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        # re-encode fallback
        cmd = [
            ffmpeg,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            str(out_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr[-500:] if proc.stderr else "ffmpeg concat failed")
    return out_path


class ContinuityRunner:
    def __init__(
        self,
        project: dict[str, Any],
        *,
        on_progress: ProgressFn | None = None,
        wait_review: ReviewWaitFn | None = None,
    ) -> None:
        self.project = project
        self.on_progress = on_progress
        self.wait_review = wait_review
        self.client = ComfyClient()
        pack = MODELS_NSFW if project.get("model_pack") == "nsfw" else MODELS_SFW
        # Comfy on Windows expects nested diffusion model paths with '\'
        self.unet = str(pack["unet"]).replace("/", "\\")
        self.clip = pack["clip"]
        self.vae_v = pack["vae_v"]
        self.vae_a = pack["vae_a"]
        self.width = int(project.get("width") or DEFAULT_WIDTH)
        self.height = int(project.get("height") or DEFAULT_HEIGHT)
        self.steps = int(project.get("steps") or DEFAULT_STEPS)
        self.overlap = DEFAULT_OVERLAP
        self.slug = project["slug"]
        self.review_dir = DELIVERABLES_DIR / self.slug
        self.review_dir.mkdir(parents=True, exist_ok=True)

    async def _progress(self, msg: str, pct: float, extra: dict | None = None) -> None:
        if self.on_progress:
            await self.on_progress(msg, pct, extra)

    def timeline_new(self, session: str, prompt_text: str, duration: float) -> str:
        return json.dumps(
            {
                "version": 1,
                "items": [],
                "prompt_blocks": [],
                "resolution": {
                    "aspect": "custom",
                    "resolution": "custom",
                    "input_scaling": "Fit and pad",
                    "custom_width": self.width,
                    "custom_height": self.height,
                    "custom_mode": "fixed",
                },
                "continuity": {
                    "version": 3,
                    "capture": True,
                    "session": session,
                    "overlap_frames": self.overlap,
                    "output_mode": "full",
                    "source_kind": "checkpoint",
                    "source_id": "",
                    "source_video_id": "",
                    "use_references": False,
                    "continuation_prompt": "",
                    "idea": "",
                },
                "builder_state": {
                    "version": 1,
                    "mode": "T2VA",
                    "prompt_mode": "simple",
                    "simple_prompt": prompt_text,
                    "duration": int(round(duration)),
                },
            },
            ensure_ascii=False,
        )

    def timeline_continue(
        self, session: str, source_id: str, continuation_prompt: str, duration: float
    ) -> str:
        return json.dumps(
            {
                "version": 1,
                "items": [],
                "prompt_blocks": [],
                "resolution": {
                    "aspect": "custom",
                    "resolution": "custom",
                    "input_scaling": "Fit and pad",
                    "custom_width": self.width,
                    "custom_height": self.height,
                    "custom_mode": "fixed",
                },
                "continuity": {
                    "version": 3,
                    "capture": True,
                    "session": session,
                    "overlap_frames": self.overlap,
                    "output_mode": "full",
                    "source_kind": "checkpoint",
                    "source_id": source_id,
                    "source_video_id": "",
                    "use_references": False,
                    "continuation_prompt": continuation_prompt,
                    "idea": continuation_prompt,
                },
                "builder_state": {
                    "version": 1,
                    "mode": "T2VA",
                    "prompt_mode": "simple",
                    "simple_prompt": continuation_prompt,
                    "duration": int(round(duration)),
                },
            },
            ensure_ascii=False,
        )

    def build_prompt(
        self,
        *,
        director_prompt: str,
        timeline_data: str,
        filename_prefix: str,
        seed: int,
        duration: float,
    ) -> dict:
        return {
            "1": {
                "class_type": "UNETLoader",
                "inputs": {"unet_name": self.unet, "weight_dtype": "default"},
            },
            "2": {
                "class_type": "CLIPLoader",
                "inputs": {"clip_name": self.clip, "type": "minimax", "device": "default"},
            },
            "3": {"class_type": "VAELoader", "inputs": {"vae_name": self.vae_v}},
            "4": {"class_type": "VAELoader", "inputs": {"vae_name": self.vae_a}},
            "5": {
                "class_type": "MiniMaxH3Director",
                "inputs": {
                    "mode": "T2VA",
                    "prompt": director_prompt,
                    "width": self.width,
                    "height": self.height,
                    "duration": float(duration),
                    "ref_image_size": "match",
                    "timeline_data": timeline_data,
                    "builder_state": "",
                    "frame_rate": 24.0,
                    "fl2va_model": ["1", 0],
                },
            },
            "6": {
                "class_type": "MiniMaxH3DirectorGuide",
                "inputs": {
                    "clip": ["2", 0],
                    "vae": ["3", 0],
                    "guide": ["5", 0],
                    "audio_vae": ["4", 0],
                },
            },
            "7": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
            "8": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
            "9": {
                "class_type": "BasicScheduler",
                "inputs": {
                    "model": ["5", 5],
                    "scheduler": "simple",
                    "steps": self.steps,
                    "denoise": 1.0,
                },
            },
            "10": {
                "class_type": "BasicGuider",
                "inputs": {"model": ["5", 5], "conditioning": ["6", 0]},
            },
            "11": {
                "class_type": "SamplerCustomAdvanced",
                "inputs": {
                    "noise": ["7", 0],
                    "guider": ["10", 0],
                    "sampler": ["8", 0],
                    "sigmas": ["9", 0],
                    "latent_image": ["6", 1],
                },
            },
            "12": {
                "class_type": "DaSiWaH3ContinuityAppend",
                "inputs": {"sampled": ["11", 0], "context": ["6", 2]},
            },
            "13": {"class_type": "VAEDecode", "inputs": {"samples": ["12", 0], "vae": ["3", 0]}},
            "14": {
                "class_type": "VAEDecodeAudio",
                "inputs": {"samples": ["12", 0], "vae": ["4", 0]},
            },
            "15": {
                "class_type": "DaSiWa_EnhancedVideoCombine",
                "inputs": {
                    "images": ["13", 0],
                    "audio": ["14", 0],
                    "frame_rate": 24.0,
                    "codec": "H.264",
                    "container": "MP4",
                    "bit_depth": "8-bit",
                    "quality": 18,
                    "log_level": "Standard",
                    "pingpong": False,
                    "save_metadata": True,
                    "filename_prefix": filename_prefix,
                    "save_output": True,
                    "pass_frames": False,
                    "crop_to_audio": False,
                    "audio_codec": "AAC",
                    "audio_bitrate": "192k",
                    "save_first_frame": False,
                    "save_last_frame": False,
                    "free_memory_if_needed": True,
                },
            },
            "16": {
                "class_type": "DaSiWaH3ContinuityPublish",
                "inputs": {"filename": ["15", 1], "ticket": ["12", 1]},
            },
        }

    async def run_take(self, take: dict) -> Path:
        n = take["n"]
        kind = take["kind"]
        session = take["session"]
        prompt_text = take["prompt"]
        dur = take_duration(take)
        label = f"t{n:02d}_{kind}"

        if kind == "new":
            tl = self.timeline_new(session, prompt_text, dur)
        elif kind == "continue":
            source_id = latest_ready_clip(session)
            tl = self.timeline_continue(session, source_id, prompt_text, dur)
        else:
            raise ValueError(kind)

        graph = self.build_prompt(
            director_prompt=prompt_text,
            timeline_data=tl,
            filename_prefix=take["prefix"],
            seed=int(take["seed"]),
            duration=dur,
        )
        t0 = time.time()
        await self._progress(f"Enfileirando {label}…", 0.1, {"take": n})
        prompt_id = await self.client.queue_prompt(graph, f"promptera-{self.slug}-{n}")
        await self._progress(f"Gerando {label}…", 0.2, {"take": n, "prompt_id": prompt_id})
        await self.client.wait_prompt(prompt_id, label=label, on_progress=None)
        mp4 = find_output_mp4(take["prefix"], t0) or find_latest_session_mp4(session)
        if not mp4:
            raise RuntimeError(f"MP4 não encontrado após {label}")
        return mp4

    async def run_all(self) -> dict[str, Any]:
        takes = list(self.project.get("takes") or [])
        if isinstance(takes, str):
            takes = json.loads(takes)
        state = db.get_runner_state(self.project["id"])
        done = set(state.get("completed") or [])
        total = len(takes)
        review_mode = self.project.get("review_mode") == "com_revisao"
        session_last: dict[str, Path] = {}

        await self.client.system_stats()

        i = 0
        while i < len(takes):
            take = takes[i]
            n = int(take["n"])
            if n in done:
                i += 1
                continue
            pct = (len(done) / max(1, total)) * 100
            await self._progress(
                f"Take {n}/{total}",
                pct,
                {"take": n, "total": total},
            )
            t0 = time.time()
            mp4 = await self.run_take(take)
            elapsed = time.time() - t0
            from ..cost import record_take_duration

            record_take_duration(elapsed)

            session_last[take["session"]] = mp4
            full_path, current_path = prepare_review_clips(
                full_src=mp4,
                review_dir=self.review_dir,
                n=n,
                take_seconds=take_duration(take),
            )

            if review_mode and self.wait_review:
                db.update_project(
                    self.project["id"],
                    status="awaiting_review",
                    review_take=n,
                    review_full_path=str(full_path),
                    review_current_path=str(current_path),
                )
                decision = await self.wait_review(
                    {
                        "project_id": self.project["id"],
                        "take": n,
                        "total": total,
                        "full_path": str(full_path),
                        "current_path": str(current_path),
                        "title": self.project.get("title"),
                    }
                )
                if decision == "reject":
                    quarantine_latest_ready(ckpt_root() / take["session"])
                    # bump seed
                    take["seed"] = int(take.get("seed") or 2000) + 17
                    takes[i] = take
                    db.update_project(self.project["id"], takes=takes, status="generating")
                    continue  # redo same take
                db.update_project(
                    self.project["id"],
                    status="generating",
                    review_take=None,
                    review_full_path=None,
                    review_current_path=None,
                )

            done.add(n)
            state["completed"] = sorted(done)
            state["last_ok"] = {"n": n, "ts": time.time(), "mp4": str(mp4)}
            db.save_runner_state(self.project["id"], state)
            i += 1

        # concat last of each session in first-seen order
        order: list[str] = []
        for t in takes:
            s = t["session"]
            if s not in order:
                order.append(s)
        mp4s: list[Path] = []
        for s in order:
            p = session_last.get(s) or find_latest_session_mp4(s)
            if p:
                mp4s.append(p)
        master = self.review_dir / "master.mp4"
        if mp4s:
            concat_master(mp4s, master)
        await self._progress("Concluído", 100.0, {"master": str(master)})
        return {"master": str(master), "completed": sorted(done), "sessions": order}
