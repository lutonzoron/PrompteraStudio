# AI Story Inbox — how to write stories for Promptera Studio

**Audience:** Cursor, Claude, Copilot, ChatGPT, Gemini, or any coding agent that should author a story pack for this app.

**Goal:** drop files into `data/inbox/` so Promptera imports them as a draft project (no OpenAI key required inside the app).

Read this file before generating a story. Do **not** invent another folder layout.

These Continuity / prompt rules match the **MiniMax H3 + DaSiWa Continuity** skill. Follow them exactly.

---

## 1. Drop folder (required layout)

### Confirm video dimensions before authoring (mandatory)

Before writing any Inbox Markdown/script, `takes.json`, or pack, ask the user to
**confirm the video format and pixel dimensions**, then **wait for an explicit answer**.
Do not silently use the app default or infer the format from the story topic.
An explicit format/dimension choice already supplied by the user for this pack counts
as confirmation; do not ask again. If custom dimensions are ambiguous, clarify them.

Suggested question: **“Qual formato você confirma para este vídeo: celular vertical
9:16 (576×1024), horizontal 16:9 (1024×576), quadrado 1:1 (768×768), ou retrato
para feed 4:5 (768×960)?”**

After confirmation, include `meta.json` with numeric `width` and `height`, and record
the confirmed format and resolution in the `roteiro.md`/`story.md` header. Compose
all takes for that framing and use the same dimensions throughout the project.
This requirement applies to new agent-authored packs; legacy packs without dimensions
remain importable using the application's defaults.

Create **one folder per story**:

```text
data/inbox/<slug>/
  takes.json     # REQUIRED — Continuity take list
  meta.json      # REQUIRED for new agent-authored packs (confirmed width/height)
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

## 2. `meta.json` (required for new agent-authored packs)

```json
{
  "title": "Short human title",
  "slug": "my_story_slug",
  "brief": "One-line pitch",
  "synopsis": "Optional longer synopsis",
  "model_pack": "sfw",
  "review_mode": "automatico",
  "max_duration_sec": 60,
  "width": 576,
  "height": 1024,
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

`title` / `brief` / `synopsis` may be Portuguese (human-facing). Everything inside each take `prompt` follows §5 Language.

`width` and `height` are the confirmed pixel dimensions. `meta.json` is required for
new agent-authored packs to carry this choice. Example dimensions are illustrative;
never copy them without user confirmation.

### Footage category and CCTV clock

Optional metadata fields supported by the importer:

- `category`: `"general"` or `"footage"`. Footage includes Strange Footages and surveillance stories.
- `cctv_timestamp_enabled`: legacy field; use `false`. Never apply timestamps automatically.
- `cctv_timestamp_start`: ISO local display time, for example `"2026-11-12T19:08:12"`.

For every new Footage pack, choose a **fictional** start date/time consistent with the scene's
lighting, write it explicitly in the Markdown header and store the same value in metadata.
The timestamp is added **only when the user clicks the manual post-production button**;
the generated source may already contain a clock despite negative prompts. Inspect it first
to avoid duplicate clocks. Render our clock at low resolution and blend a softened, pixelated
overlay so it matches inexpensive surveillance footage rather than sharp modern subtitles.
The clock advances during playback and rolls over correctly at midnight. Do not describe
the chosen timestamp as evidence that the scene actually occurred. The original master is
preserved; a manually requested timestamped export becomes the displayed version.

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
| `duration` | **2–15** seconds (default **5**). DaSiWa Continuity Duration = new seconds for that take |
| `prefix` | `video/<slug>/tNN` (zero-padded). Comfy writes under `output/video/<slug>/` |
| `prompt` | Self-contained MiniMax H3 Continuity prompt (see §5). **English** except dialogue tags |

### Continuity structure (skill)

1. **Continuity** = same shot, same session, CONTINUE from latest ready checkpoint  
2. First take of a block: `"kind": "new"`  
3. Following takes: `"kind": "continue"` + **same** `session`  
4. **Hard cut / new scene / camera reset** → NEW take + **new session name**  
5. Prefer **short** Continuity blocks when the scene allows (3–4 takes is a performance guideline, not a scene limit). A continuous conversation/scene may use as many takes as needed. **Never insert a hard cut every third take** merely to meet a count; the Full timeline gets slower as it grows, but preserve the requested scene continuity.  
6. **1 action per take** — do not stack pose changes; match the beat to the take length  
7. Prompt timestamps must match duration (`00:00.000–00:03.000` on a 3 s take)

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
    "prompt": "CONTINUITY LOCK: …\n\nONE action: …"
  },
  {
    "n": 2,
    "kind": "continue",
    "session": "kitchen_v1",
    "seed": 9101,
    "duration": 5,
    "prefix": "video/demo_kitchen/t02",
    "prompt": "CONTINUITY LOCK: same camera…\nContinue ONE action: …"
  }
]
```

---

## 4. `roteiro.md` (optional Markdown script)

Human-readable plan. Promptera stores it on the project; it is **not** sent to Comfy as-is.

- May be written in **Portuguese** (or English) for humans  
- Mark seconds per take; note NEW vs CONTINUE and session ids  
- Do **not** treat Portuguese action lines in the roteiro as a license to put Portuguese into `takes.json` prompts

Suggested structure:

```markdown
# Title

**Slug:** my_story_slug  
**Pack:** sfw  
**Formato confirmado:** celular vertical 9:16, 576×1024 px
**Target length:** ~30s (6×5s)

## Logline
One sentence.

## Style
Camera, look, audio rules (no dialogue / locked-off / etc.).

## Block A — session `kitchen_v1`
### Take 1 — NEW (5s)
Action… (can be PT here; the takes.json prompt must still be EN)

### Take 2 — CONTINUE (5s)
Action…

## Block B — session `street_v1`
### Take 3 — NEW (5s)
…
```

---

## 5. Prompt writing rules (MiniMax H3 Continuity — skill)

These rules matter more than fancy prose. **Match the skill exactly.**

### 5.1 Language (mandatory)

| Layer | Language |
|-------|----------|
| Take `prompt` sent to Comfy (CONTINUITY LOCK, CAST LOCK, Spatial, ONE action, camera, lighting, SFX, negatives) | **English only** |
| Spoken dialogue / lip sync | **Portuguese** only inside `<d>[Portuguese] …</d>` |
| Character proper names | Keep as-is (e.g. Lelé, Tito) |
| `roteiro.md`, `meta.json` title/brief | Portuguese OK (human UI) |

**Do not** write `ONE action:` / Spatial / soundscape in Portuguese.  
**Do not** mix PT action into an English lock (hybrid prompts are out of spec).

**Sparse speech:** few `<d>[Portuguese] …</d>` lines; most takes = ambience + breath/motion only. Mute takes: say `No dialogue` / `No speech` and omit `<d>` tags.

For narrative conversations, include the exchanges needed to tell the requested story; do not turn a dialogue-driven chapter into mostly silent gestures. Keep each line short enough for its take. For Strange Footages, the established default remains ambience only.

### 5.2 Continuity / duration / audio

1. **One action per take** — single beat, no montage inside one take  
2. **CONTINUITY LOCK** on every take — same characters, set, camera; call out what stays fixed  
3. **Spatial anchors** — LEFT / RIGHT / CENTER / front / back so characters don’t drift  
4. **Match duration** — if `duration: 5`, don’t describe 20 seconds of plot; timestamps must match  
5. **Audio** — say speech vs SFX-only vs silence; avoid unwanted dialogue tags if mute  
6. **Dimensions:** use the user's confirmed `width`/`height`, never an assumed default. Other defaults: 24 fps, euler, 8 steps, overlap **22**, `output_mode: full`

Use **take-specific audio**, not a shared sound list for an entire scene. Repeating knocks/footsteps/hinges in every silent take can repeat those actions visually too. Carry the final pose and prop state forward: for a door exchange, one tap then lowered hand/paw, offscreen reply with the door closed, invitation, latch/open once, then enter through the already open door. A character heard from inside must not appear at a window; keep the plate's window opaque/closed when the character design should remain unseen.

### 5.3 Character identity (anti sheet-leak)

**Scene plate supported by the runner:** a NEW take may include optional
`"first_frame": "story_assets/my_story/scene_01.png"`. The path is relative to
`data/` (or an absolute image path inside `data/`). The image must exist as PNG,
JPEG or WebP. The importer preserves this field; the runner uploads the plate to
ComfyUI input and starts that NEW in **I2VA**, using image slot 0. The plate must
already show the characters in their actual scene and the confirmed framing.
Never use a multipanel character sheet as the starting frame. CONTINUE takes must
omit `first_frame`: they use the latest ready checkpoint, with no image reinjection.
Ordinary NEW takes without this optional field retain the existing T2VA behavior.

Treat studio character sheets as a known failure mode (sheet paste / void / identity swap).

**Default for productions with a fixed hero:**

1. Sheet is only a **design source** — do **not** dump a full multi-panel bible into every continue  
2. Prefer a **scene plate** (hero already in the location); NEW anchors from that plate  
3. CONTINUE = Continuity latent only — no sheet re-inject; lock identity briefly in text  
4. New location → new session (+ new plate when using I2VA); do not paste gray/white sheet  
5. Per block: fixed **spatial map**. Extras never inherit hero face/outfit  
6. If NEW shows sheet/void/identity swap → **stop**; remake NEW. Never CONTINUE on a bad anchor  

**Lock snippet (put on every take):**

```text
CONTINUITY LOCK: Same camera angle, same screen direction, same who-is-in-front.
Named hero keeps exact face/outfit from the established plate.
Extras never inherit the hero face or outfit.
No character sheet, no studio backdrop, no white/gray void, no cutout collage.
ONE action only.
```

### 5.4 NSFW (when `model_pack: "nsfw"`)

Lock anatomy on every NEW and CONTINUE (`clear male penis / female vagina`, negatives for swapped/fused genitals). Prefer side/¾ angles on the man. SFW packs must stay safe.

### 5.5 NEW vs CONTINUE prompt skeletons

**NEW**

```text
CONTINUITY LOCK: Same hero as the first-frame plate. No character sheet, no studio void, no cutout.
Spatial: <who left/right/front/back — fixed>.

integrated_multimodal_description:
[Shot 1] <style>, <setting>, <mood>, SFW|explicit adult.
00:00.000–00:05.000 Same person as the input frame, fully in the scene. <ONE action in English>. <camera>. [optional one short <d>[Portuguese] …</d>]

overall_soundscape:
<ambience in English>. No music.
non_diegetic_music: N/A
```

**CONTINUE (latent only — no sheet re-inject)**

```text
CONTINUITY LOCK: same camera, same screen direction, same front/back. Same hero. No sheet, no void.
Continue <ONE action in English>. No dialogue. <sound only in English>.
```

Shorter simple-prompt form (also valid):

```text
CONTINUITY LOCK: cute stylized character, locked-off medium shot, soft daylight.

ONE action: the character raises one hand and waves once at camera, then holds a smile.
Sound: soft room tone only. No speech. No music.
```

### 5.6 Master export

Continuity **Full** means each take file already contains 1…N. The app master uses the **last** Full of each session — do **not** concat every intermediate take file.

---

## 6. Agent checklist (copy/paste)

```text
[ ] Ask user: SFW or NSFW? auto review or take-by-take?
[ ] Ask and wait for explicit video format/dimension confirmation before writing the script or pack (unless already explicitly supplied for this pack)
[ ] Save confirmed width/height in meta.json and format/resolution in the Markdown header
[ ] Pick slug + title + max duration
[ ] Plan sessions (NEW/CONTINUE), ≤3–4 takes each
[ ] Write takes.json with n, kind, session, seed, duration, prefix, prompt
[ ] Prompts in ENGLISH; dialogue only as <d>[Portuguese] …</d> (sparse)
[ ] Spatial map + CONTINUITY LOCK on every take; 1 action per take
[ ] Timestamps match duration; no Portuguese action lines in prompts
[ ] Required meta.json with confirmed dimensions; optional roteiro.md (roteiro may be PT)
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

When the user explicitly requested approval and enqueueing, the agent should perform those actions for the intended packs and verify one active job per project, rather than delegating the already authorized steps back to the user. Do not approve unrelated Inbox items. Preserve active generations; content import does not authorize interruption or priority preemption. A successfully validated/queued pack is not yet a visually verified render.

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
  "max_duration_sec": 15,
  "width": 576,
  "height": 1024
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
    "prompt": "CONTINUITY LOCK: cute stylized character, locked-off medium shot, soft daylight. No character sheet, no studio void.\n\nSpatial: character CENTER.\n\nONE action: the character raises one hand and waves once at camera, then holds a smile.\nSound: soft room tone only. No speech. No music."
  },
  {
    "n": 2,
    "kind": "continue",
    "session": "demo_wave_v1",
    "seed": 2001,
    "duration": 5,
    "prefix": "video/demo_wave/t02",
    "prompt": "CONTINUITY LOCK: same character, same camera, same lighting. No sheet, no void.\n\nContinue ONE action: the character lowers the hand slowly and nods once.\nSound: soft room tone. No dialogue."
  }
]
```

Example with sparse Portuguese dialogue (only the spoken line is PT):

```text
… She whispers with lip sync <d>[Portuguese] quem te deixou aqui?</d>. Soft wind. Clear short line.
```

---

## Related files

- [AGENTS.md](AGENTS.md) — short agent entrypoint  
- [CURSOR_INBOX.md](CURSOR_INBOX.md) — short Cursor-oriented pointer  
- [README.md](README.md) — install & overview  
- App inbox code: `app/inbox/service.py`
