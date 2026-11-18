---
name: comfyui-h3-continuity
description: >-
  Sets up and runs ComfyUI MiniMax H3 video+audio generation with DaSiWa Continuity
  (MythicAlchemy-style sessions, NEW vs CONTINUE takes, API queue runners, roteiro MD→JSON).
  Includes anti sheet-leak character identity: prefer I2VA scene plates, refs only on NEW,
  use_references false on CONTINUE. Before every generation queue, ask if the user wants
  take-by-take validation UI (approve/reject) or unattended run. Use when the user mentions
  MiniMax H3, Continuity, MythicAlchemy, ComfyUI H3 takes, character sheet, REF2VA,
  roteiro de takes, NSFW 10Eros/heretic, or wants to share/replicate this video pipeline. Not LTX.
---

# ComfyUI MiniMax H3 + Continuity

Portable production flow: **roteiro `.md` → takes `.json` → API runner → concat finais**.
Stack is **MiniMax H3** + **DaSiWa Continuity**, not LTX.

**First-time install:** follow [SETUP.md](SETUP.md) end-to-end (ComfyUI, DaSiWa clone, models, workflows).

## Bundle contents (send this whole folder)

```
comfyui-h3-continuity/
  SKILL.md
  SETUP.md
  reference.md
  examples.md
  character-identity.md   # anti sheet-leak / I2VA plate rules
  take-validation.md      # ask validate vs unattended; local video approve UI
  deliverables.md         # one folder per video under deliverables/<slug>/
  scripts/h3_continuity_runner.py
  scripts/take_validate.py
  workflows/
    DaSiWa_MiniMaxH3_MythicAlchemy_C-MMH3-33.json   # UI MythicAlchemy full
    workflow_mythic_alchemy_C-MMH3-33.json          # same (alt copy)
    minimax_h3_t2v.json / minimax_h3_i2v.json       # stock H3 UI
    h3_continuity_t2va_api.json                     # API graph we queue
    timeline_new.example.json / timeline_continue.example.json
    H3_Continuity_Segments_example.json
  templates/   # sample roteiros + takes.json
```

## When to use

- Install / explain this pipeline for another machine
- Author a Continuity roteiro (SFW or NSFW)
- Build/run an unattended take queue
- Load MythicAlchemy / Continuity workflows in ComfyUI
- Concat block finals into one master MP4

## Prerequisites

1. Working **ComfyUI** (git install + venv) — see [SETUP.md](SETUP.md)
2. Custom node: **ComfyUI-DaSiWa-Nodes** (`git clone https://github.com/darksidewalker/ComfyUI-DaSiWa-Nodes.git`)
3. MiniMax H3 models (see [SETUP.md](SETUP.md) / [reference.md](reference.md))
4. API on `http://127.0.0.1:8188`
5. Launch flags: `--listen 127.0.0.1 --port 8188 --disable-pinned-memory`

**VRAM:** ~12 GB comfortable · **8 GB** possible but tight/slow · **32 GB system RAM** OK for offload.

## Workflows — which file to open

| Goal | File |
|---|---|
| Full MythicAlchemy UI (manual) | `workflows/DaSiWa_MiniMaxH3_MythicAlchemy_C-MMH3-33.json` |
| Unattended Continuity queue | `scripts/h3_continuity_runner.py` (+ `h3_continuity_t2va_api.json` as graph reference) |
| Hand-edit Continuity timeline | `timeline_new.example.json` / `timeline_continue.example.json` |
| Stock H3 without Continuity | `minimax_h3_t2v.json` / `minimax_h3_i2v.json` |

## Production workflow

Copy and track:

```
- [ ] 1. Pick SFW vs NSFW model set
- [ ] 2. Ask: take validation UI vs run unattended  ← see take-validation.md
- [ ] 3. Choose deliverables/<slug>/ (one folder per video)  ← see deliverables.md
- [ ] 4. Write roteiro .md (blocks + NEW/CONTINUE)
- [ ] 5. Emit takes.json
- [ ] 6. Configure + run Continuity runner (`--validate` only if user asked)
- [ ] 7. Concat last MP4 of each Continuity session → deliverables/<slug>/master.mp4
```

### 1) Model set

| Uso | UNET | CLIP |
|---|---|---|
| SFW / religioso / geral | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` |
| NSFW | `MINIMAXH3/10Eros_Max_SingularityV2_PRISM2_PikaFlex_0.85_int8HQ.safetensors` | `minimaxH3_qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors` |

VAE (both): `minimax_h3_video_vae_fp16.safetensors` + `minimax_h3_audio_vae_fp32.safetensors`

### 2) Roteiro rules (learned)

- **Continuity** = same shot, same session, CONTINUE from latest ready checkpoint
- **Hard cut / new scene** = NEW take + **new session name**
- Keep Continuity blocks **short** (≤3–4 takes) unless overnight — Full timeline slows as it grows
- **1 action per take** — do not stack pose changes (match the beat to the take length)
- **Take duration (variable):** default **5 s**; per take may be **2–15 s** (DaSiWa Continuity Duration = new seconds). Put `"duration": 3` (etc.) on that take in `takes.json` and mark seconds in the roteiro. Shorter for a glance/gag; longer only if one clear action still fits. Prompt timestamps must match (`00:00–00:03` on a 3 s take).
- **Sparse speech**: few `<d>[Portuguese] …</d>` lines; most takes = ambience + breath/motion only
- NSFW: lock anatomy on every NEW and CONTINUE (`clear male penis / female vagina`, negatives for swapped/fused genitals); prefer side/¾ angles on the man
- Defaults: 5s (override per take) · 544×992 · 24 fps · euler · 8 steps · overlap **22** · `output_mode: full`

### 2b) Character identity (CRITICAL — anti sheet-leak)

Full detail: [character-identity.md](character-identity.md).

**Default for new productions with a fixed hero:**

1. Sheet is only a **design source** — do **not** feed multi-panel studio sheets into every take.
2. Make a **scene plate** (hero already in the location) → block **NEW = I2VA** from that plate (FL2VA unet).
3. **CONTINUE**: Continuity latent only — `use_references: false`, **empty** timeline `items` (no re-inject sheet).
4. New location → new scene plate + new session; do not REF2VA-paste the gray/white sheet.
5. Per block: fixed **spatial map** (front/back, left/right). Extras never inherit hero face/outfit.
6. If NEW shows sheet/void/identity swap → **stop**; remake NEW. Never CONTINUE on a bad anchor.

**Avoid as default:** REF2VA with full character sheet + `use_references: true` on every continue (caused sheet-on-screen / hero↔villain swaps in prior runs).

### 3) takes.json schema

```json
[
  {
    "n": 1,
    "kind": "new",
    "session": "block_A_name",
    "seed": 2001,
    "duration": 5,
    "prefix": "video/project/A_t01",
    "prompt": "full prompt text..."
  },
  {
    "n": 2,
    "kind": "continue",
    "session": "block_A_name",
    "seed": 2001,
    "duration": 3,
    "prefix": "video/project/A_t02",
    "prompt": "Same shot, same subject. Continue one action. No dialogue."
  }
]
```

`duration` optional (seconds, **2–15**). Missing → job default (usually 5).

### 4) Runner

Use [scripts/h3_continuity_runner.py](scripts/h3_continuity_runner.py):

1. Edit `CONFIG` at top (paths, UNET/CLIP, takes path, state path)
2. Start ComfyUI first
3. Launch unattended:

```powershell
$py = "C:\path\to\Comfyui\venv\Scripts\python.exe"
$script = "C:\path\to\h3_continuity_runner.py"
Start-Process -FilePath $py -ArgumentList '-u',"`"$script`"" -WorkingDirectory "C:\path\to\project" -WindowStyle Hidden -RedirectStandardOutput ".\download_logs\runner_out.txt" -RedirectStandardError ".\download_logs\runner_err.txt"
```

Resume-safe via state JSON (`completed` take numbers). Do not start two runners on the same session.

### 5) Master edit

Continuity **Full** outputs are **cumulative** inside a session. For the film, concat **only the last MP4 of each session** (plus any standalone NEW insert sessions).

```text
A_last.mp4 + B_last.mp4 + C_last.mp4 → master.mp4
```

ffmpeg concat demuxer; re-encode if DTS warnings appear.

## Agent behavior

When asked to run this pipeline:

1. **Before generating:** ask whether they want **take-by-take validation** or **unattended** — full rules in [take-validation.md](take-validation.md). Do not skip this unless they already said which mode.
2. **Deliverables:** one folder per video — `deliverables/<slug>/` for master + review/current takes; never flat in `deliverables/` root — see [deliverables.md](deliverables.md)
3. Follow [character-identity.md](character-identity.md) by default for any cast/hero job
4. Prefer **I2VA scene plate + Continuity** over REF2VA sheet spam unless the user insists
5. Read [reference.md](reference.md) for graph/node details if debugging API errors
6. Prefer editing CONFIG in the template runner over inventing a new graph
7. Never mix NSFW weights into SFW/religious jobs (and vice versa) unless the user asks
8. Estimate wall time: ~6–12+ min/take; Continuity continues grow slower in long blocks
9. After a crash/reboot: report completed takes from state + outputs; **ask before resuming**
10. On sheet-leak / identity swap mid-queue: stop runner, explain, propose plate+I2VA fix before continuing
11. Validation is **Python runner + local HTTP page** (poll Comfy `/history`). No Comfy webhook.

## Share this skill

Copy the folder `comfyui-h3-continuity/` into the other person's:

- Project: `.cursor/skills/comfyui-h3-continuity/`
- Or personal: `~/.cursor/skills/comfyui-h3-continuity/`

They still need ComfyUI + DaSiWa nodes + model files locally.

## Extra

- Install from zero: [SETUP.md](SETUP.md)
- Hardware / model paths / node graph: [reference.md](reference.md)
- Character identity / anti sheet-leak: [character-identity.md](character-identity.md)
- Take validation UI / ask before generate: [take-validation.md](take-validation.md)
- Deliverables one folder per video: [deliverables.md](deliverables.md)
- Roteiro patterns: [examples.md](examples.md)
- Ready roteiros + JSON: [templates/](templates/)
- ComfyUI + API workflows: [workflows/](workflows/)
