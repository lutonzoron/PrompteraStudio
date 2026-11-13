# Agent instructions (Cursor / Claude / Copilot / etc.)

When the user asks you to **write a story**, **roteiro**, **takes**, or **import into Promptera**:

1. Read **[AI_STORY_INBOX.md](AI_STORY_INBOX.md)** end-to-end — it is the Continuity skill rules for this repo  
2. Emit a pack under `data/inbox/<slug>/` with at least `takes.json`  
3. Prefer also `meta.json` + `roteiro.md`  
4. Tell the user to open Promptera → **Inbox → Aprovar** → enqueue  

### Non-negotiable (same as H3 Continuity skill)

- Take **`prompt` fields = English** (locks, spatial, ONE action, camera, SFX)  
- Spoken lines only as `<d>[Portuguese] …</d>` — sparse; most takes mute  
- Do **not** mix Portuguese action into prompts  
- `roteiro.md` / titles may be Portuguese for humans  
- 1 action per take · ≤3–4 takes per session · NEW session on hard cut  
- CONTINUITY LOCK + spatial map; anti sheet-leak (no studio sheet dump on continues)

Do not invent a different import format. The inbox schema in `AI_STORY_INBOX.md` is the source of truth.
