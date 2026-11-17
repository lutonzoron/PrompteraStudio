# Promptera Studio

Local studio for **MiniMax H3 + DaSiWa Continuity** video: AI story packs and takes, a global queue, sync with external runners, take-by-take review, and concatenated masters that do not restack Continuity Full outputs.

UI: [http://127.0.0.1:8790](http://127.0.0.1:8790)

![Promptera Studio](frontend/public/logo-promptera.png)

## What it does

- Project library (SFW/NSFW) with filters, cover art, and status (**Queued** / **Generating** / **Ready**)
- Floating queue: **live job** (tied to what Comfy is running) + draggable **queued** list
- Calibrated ETA (min/take, current take, estimated finish time, energy cost)
- Continuity Full: master = last take of the session (does not re-concatenate t01+t02+…)
- Inbox import (`data/inbox/`) + external runners (state JSON)
- Onboarding: LLM, ComfyUI, DaSiWa, models, ffmpeg, electricity rate (R$/kWh)

## Requirements

| Item | Notes |
|------|--------|
| Python 3.10+ | FastAPI backend |
| Node.js 18+ | frontend build |
| ComfyUI + [ComfyUI-DaSiWa-Nodes](https://github.com/darksidewalker/ComfyUI-DaSiWa-Nodes) | Continuity H3 |
| MiniMax H3 models | SFW required at onboarding; NSFW optional |
| ffmpeg | on `PATH` |
| AI API | OpenAI / compatible / Ollama / Anthropic |

GPU: ~12 GB VRAM comfortable (e.g. RTX 3060). 8 GB possible, slower.

## Install

```powershell
git clone https://github.com/lutonzoron/PrompteraStudio.git
cd PrompteraStudio

python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

cd frontend
npm install
npm run build
cd ..

python run.py
# or: start.bat
```

Open http://127.0.0.1:8790 and complete **Config / Onboarding**.

### Network / LAN

```powershell
$env:PROMPTERA_HOST="0.0.0.0"
$env:PROMPTERA_PORT="8790"
python run.py
```

## Quick flow

1. Configure ComfyUI (+ an AI key if you generate scripts **inside** the app)
2. **New story** in the app **or** ask any AI (Cursor / Claude / Copilot) to write a pack under `data/inbox/<slug>/`
3. Agent spec: **[AI_STORY_INBOX.md](AI_STORY_INBOX.md)** · [AGENTS.md](AGENTS.md)
4. **Inbox** UI → **Approve** the pack (it does not auto-import) → enqueue
5. Master at `data/deliverables/<slug>/master.mp4`

### Continuity defaults

- 544×992 · 24 fps · euler · 8 steps · overlap 22 · `output_mode: full`
- Take length 2–15 s (default 5) · short blocks (≤3–4 takes)

## Layout

```text
app/           # FastAPI, LLM, Continuity, queue, external sync, ETA
frontend/      # React + Vite
bundled/       # workflows + style seeds
data/          # SQLite, deliverables, inbox (not versioned)
scripts/       # import/sync utilities
run.py         # serves on :8790
```

## Development

```powershell
# terminal A — API
python run.py

# terminal B — UI hot reload
cd frontend
npm run dev
```

Vite: http://127.0.0.1:5179 (proxies `/api` → 8790).

## H3 models and dependency checks

In **Settings → ComfyUI**, use **Baixar H3 SFW faltantes** or **Baixar H3 NSFW faltantes**
to download the missing model, text encoder and shared audio/video VAEs. Individual
downloads and destination paths are shown in the same section. Restart ComfyUI after
installing models or nodes, then refresh the dependency check.

Each model has a **Link de download** field for a direct HTTPS file URL (on Hugging
Face, use `/resolve/main/...`, not `/blob/main/...`). Save the link before downloading.
The exact `10Eros_Max_SingularityV2_PRISM2_PikaFlex_0.85_int8HQ` file has no bundled
download URL; supply its source there. The NSFW text encoder has a default source:
https://huggingface.co/ethanfel/Qwen3-VL-32B-Ultra-Heretic-H3-ComfyUI-INT8-ConvRot
It is saved using the filename required by the existing workflow.

For Hugging Face files requiring authentication, accept the repository terms and set
`HF_TOKEN` in the environment before starting Promptera. Incomplete files and obvious
non-safetensors responses are rejected. Downloads do not verify cryptographic hashes.

The live check inspects ComfyUI's loaded node schemas and model lists before enqueuing
and before submitting each render. Rejections include diagnostics and suggested fixes;
execution failures such as insufficient VRAM still require a render attempt.

## Activity logs

The **Logs** menu shows timestamped actions, queue events, take generation and review,
errors, and new console output from ComfyUI started by Promptera. Each video's page
also shows its own logs. Entries are stored in the local SQLite database and survive
restarts; collection begins when this version starts and does not recreate past events.
The viewer refreshes every two seconds, supports loading earlier entries, following the
latest lines, and downloading the displayed text. Dates use the browser's local time.

## Privacy

- API keys and the DB stay under `data/` (Git-ignored)
- Do not commit `.env`, `studio.db`, or deliverable videos
- NSFW: covers are not generated automatically

## License

Personal / local use. Third-party workflows (DaSiWa, MiniMax) follow their original authors’ licenses.
