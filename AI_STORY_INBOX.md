# AI Story Inbox — how to write stories for Promptera Studio

**Audience:** Cursor, Claude, Copilot, ChatGPT, Gemini, or any coding agent that should author a story pack for this app.

**Goal:** drop files into `data/inbox/` so Promptera imports them as a draft project (no OpenAI key required inside the app).

Read this file before generating a story. Do **not** invent another folder layout.

---

## 1. Drop folder (required layout)

Create **one folder per story**:

```text
data/inbox/<slug>/
  takes.json     # REQUIRED — Continuity take list
  meta.json      # optional but recommended
  roteiro.md     # optional — human-readable script (Markdown)
```

Also accepted:

- Flat file: `data/inbox/<slug>_takes.json` or `data/inbox/<slug>.takes.json`
- Alt names inside the pack: `story.md` instead of `roteiro.md`

The app **detects** new packs (~every 5s) and shows them in **Inbox**, but does **not**
import until a human clicks **Aprovar** (or **Aprovar todos**). Rejected packs go to
`data/inbox/_failed/`; approved packs move to `data/inbox/_processed/`.

`<slug>` = lowercase snake_case or kebab-case, ASCII preferred  
Examples: `milkshake_htf`, `vila_lele_01`, `shorts_mystery_30s`

---

## 2. `meta.json` (optional)

```json
{
  "title": "Short human title",
  "slug": "my_story_slug",
  "brief": "One-line pitch",
  "synopsis": "Optional longer synopsis",
  "model_pack": "sfw",
  "review_mode": "automatico",
  "max_duration_sec": 60,
  "seed_base": 2000,
  "enqueue": false,
  "style_id": null
}
```

| Field | Values | Notes |
|-------|--------|--------|
| `model_pack` | `sfw` \| `nsfw` | NSFW uses uncensor models; omit → guessed from prompts |
| `review_mode` | `automatico` \| `com_revisao` | Take-by-take UI vs unattended |
| `max_duration_sec` | number | Soft cap on sum of take durations |
| `enqueue` | bool | Reserved; usually leave `false` (user enqueues in UI) |

---

## 3. `takes.json` (required schema)

Must be a **JSON array** of takes (or `{ "takes": [ ... ] }`).

Each take:

```json
{
  "n": 1,
  "kind": "new",
  "session": "my_story_v1",
  "seed": 2001,
  "duration": 5,
  "prefix": "video/my_story_slug/t01",
  "title": "Optional short label",
  "prompt": "Full Continuity prompt for this take…"
}
```

### Field rules

| Field | Rule |
|-------|------|
| `n` | 1-based integer, unique, sequential |
| `kind` | `new` = start Continuity session · `continue` = extend previous take in **same** `session` |
| `session` | Stable id for a Continuity block. Same session for NEW + its CONTINUEs |
| `seed` | Integer; keep stable inside a session unless redoing a take |
| `duration` | **2–15** seconds (default **5**) |
| `prefix` | `video/<slug>/tNN` (zero-padded). Comfy writes under `output/video/<slug>/` |
| `prompt` | Self-contained MiniMax H3 Continuity prompt (see §5) |

### Continuity structure

1. First take of a block: `"kind": "new"`
2. Following takes in that block: `"kind": "continue"` + **same** `session`
3. New scene / cut / camera reset → new `session` + another `"kind": "new"`
4. Prefer short blocks: **≤ 3–4 continues** per session (VRAM / quality)

Example skeleton (one session, 4 takes):

```json
[
  {
    "n": 1,
    "kind": "new",
    "session": "kitchen_v1",
    "seed": 9101,
    "duration": 5,
    "prefix": "video/demo_kitchen/t01",
    "prompt": "CONTINUITY LOCK: … ONE action: …"
  },
  {
    "n": 2,
    "kind": "continue",
    "session": "kitchen_v1",
    "seed": 9101,
    "duration": 5,
    "prefix": "video/demo_kitchen/t02",
    "prompt": "CONTINUITY LOCK: same shot… ONE action: …"
  },
  {
    "n": 3,
    "kind": "continue",
    "session": "kitchen_v1",
    "seed": 9101,
    "duration": 5,
    "prefix": "video/demo_kitchen/t03",
    "prompt": "…"
  },
  {
    "n": 4,
    "kind": "continue",
    "session": "kitchen_v1",
    "seed": 9101,
    "duration": 5,
    "prefix": "video/demo_kitchen/t04",
    "prompt": "…"
  }
]
```

---

## 4. `roteiro.md` (optional Markdown script)

Human-readable plan. Promptera stores it on the project; it is **not** sent to Comfy as-is. Still useful for review.

Suggested structure:

```markdown
# Title

**Slug:** my_story_slug  
**Pack:** sfw  
**Target length:** ~30s (6×5s)

## Logline
One sentence.

## Style
Camera, look, audio rules (no dialogue / locked-off / etc.).

## Block A — session `kitchen_v1`
### Take 1 — NEW (5s)
Action…

### Take 2 — CONTINUE (5s)
Action…

## Block B — session `street_v1`
### Take 3 — NEW (5s)
…
```

---

## 5. Prompt writing rules (MiniMax H3 Continuity)

These rules matter more than fancy prose:

1. **One action per take** — single beat, no montage inside one take  
2. **CONTINUITY LOCK** on continues — same characters, set, camera; call out what stays fixed  
3. **Spatial anchors** — LEFT / RIGHT / CENTER so characters don’t drift  
4. **Match duration** — if `duration: 5`, don’t describe 20 seconds of plot  
5. **Audio** — say if there is speech, SFX only, or silence; avoid unwanted dialogue tags if mute  
6. **No sheet leak** — don’t dump a full character bible into every continue; lock identity briefly  
7. **SFW vs NSFW** — set `model_pack` correctly; NSFW prompts may be explicit; SFW must stay safe  
8. **Defaults** (app / skill): ~544×992 or project size, 24 fps, 8 steps, overlap 22, `output_mode: full`

Master export: Continuity **Full** means each take file already contains 1…N. The app master uses the **last** Full of the session — do **not** ask the user to concat every take file.

---

## 6. Agent checklist (copy/paste)

```text
[ ] Ask user: SFW or NSFW? auto review or take-by-take?
[ ] Pick slug + title + max duration
[ ] Plan sessions (NEW/CONTINUE), ≤4 continues each
[ ] Write takes.json with n, kind, session, seed, duration, prefix, prompt
[ ] Optional meta.json + roteiro.md
[ ] Write pack under data/inbox/<slug>/
[ ] Tell user: open Promptera → Inbox → Aprovar → enqueue when ready
```

---

## 7. After approval

1. User opens **Inbox** → **Aprovar** (or rejects)  
2. Story appears as **Rascunho** (draft) in Studio  
3. User opens project → **Enfileirar geração**  
4. Render queue shows progress; master lands in `data/deliverables/<slug>/master.mp4`

UI: Inbox badge shows pending count; per-pack **Aprovar** / **Rejeitar**.

---

## 8. Minimal valid pack (copy and edit)

`data/inbox/demo_wave/meta.json`:

```json
{
  "title": "Demo Wave",
  "slug": "demo_wave",
  "brief": "Character waves once at camera",
  "model_pack": "sfw",
  "review_mode": "automatico",
  "max_duration_sec": 15
}
```

`data/inbox/demo_wave/takes.json`:

```json
[
  {
    "n": 1,
    "kind": "new",
    "session": "demo_wave_v1",
    "seed": 2001,
    "duration": 5,
    "prefix": "video/demo_wave/t01",
    "prompt": "CONTINUITY LOCK: cute stylized character, locked-off medium shot, soft daylight.\n\nONE action: the character raises one hand and waves once at camera, then holds a smile.\nSound: soft room tone only. No speech. No music."
  },
  {
    "n": 2,
    "kind": "continue",
    "session": "demo_wave_v1",
    "seed": 2001,
    "duration": 5,
    "prefix": "video/demo_wave/t02",
    "prompt": "CONTINUITY LOCK: same character, same camera, same lighting.\n\nONE action: the character lowers the hand slowly and nods once.\nSound: soft room tone. No speech."
  }
]
```

---

## Related files

- [CURSOR_INBOX.md](CURSOR_INBOX.md) — short Cursor-oriented pointer  
- [README.md](README.md) — install & overview  
- App inbox code: `app/inbox/service.py`
