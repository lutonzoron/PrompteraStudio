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

## Privacy

- API keys and the DB stay under `data/` (Git-ignored)
- Do not commit `.env`, `studio.db`, or deliverable videos
- NSFW: covers are not generated automatically

## License

Personal / local use. Third-party workflows (DaSiWa, MiniMax) follow their original authors’ licenses.
